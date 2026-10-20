import { fft, hann } from './fft';
import type { PCM } from './pcm';
import { pcmLength, resample, toMono } from './pcm';

export interface AudioStats {
  duration: number; sampleRate: number; channels: number;
  peak: number; peakDb: number; rmsDb: number;
  bpm: number | null; bpmConfidence: number;
  key: string | null; keyConfidence: number; keyAlternative: string | null;
}

export const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

export function peakOf(p: PCM): number {
  let m = 0;
  for (const c of p.channels) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > m) m = a; }
  return m;
}

export function rmsOf(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

/** Peak envelope for drawing: min/max per bucket, computed from actual samples. */
export function waveformPeaks(x: Float32Array, buckets: number): { min: Float32Array; max: Float32Array } {
  const min = new Float32Array(buckets), max = new Float32Array(buckets);
  const step = x.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const a = Math.floor(b * step), e = Math.min(x.length, Math.floor((b + 1) * step));
    let lo = 0, hi = 0;
    for (let i = a; i < e; i++) { const v = x[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    min[b] = lo; max[b] = hi;
  }
  return { min, max };
}

/** Tempo via spectral-flux onset envelope + autocorrelation over 60–200 BPM. */
export function estimateBpm(mono: Float32Array, sr: number): { bpm: number | null; confidence: number } {
  const x = sr > 22050 ? resample(mono.subarray(0, Math.min(mono.length, sr * 90)), sr, 22050) : mono;
  const fs = sr > 22050 ? 22050 : sr;
  const N = 1024, H = 256, w = hann(N);
  const frames = Math.floor((x.length - N) / H);
  if (frames < 64) return { bpm: null, confidence: 0 };
  const env = new Float32Array(frames);
  let prev = new Float32Array(N / 2);
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < N; i++) { re[i] = x[f * H + i] * w[i]; im[i] = 0; }
    fft(re, im);
    let flux = 0;
    const mag = new Float32Array(N / 2);
    for (let k = 0; k < N / 2; k++) { mag[k] = Math.log1p(100 * Math.hypot(re[k], im[k])); const d = mag[k] - prev[k]; if (d > 0) flux += d; }
    env[f] = flux; prev = mag;
  }
  const mean = env.reduce((a, b) => a + b, 0) / frames;
  for (let i = 0; i < frames; i++) env[i] = Math.max(0, env[i] - mean);
  const fps = fs / H;
  let best = 0, bestLag = 0, total = 0, count = 0;
  const minLag = Math.floor((fps * 60) / 200), maxLag = Math.ceil((fps * 60) / 60);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < frames; i++) s += env[i] * env[i + lag];
    s /= frames - lag;
    // mild prior centred on 120 BPM to resolve octave ambiguity
    const bpm = (60 * fps) / lag;
    const weighted = s * Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    total += weighted; count++;
    if (weighted > best) { best = weighted; bestLag = lag; }
  }
  if (!bestLag || total <= 0) return { bpm: null, confidence: 0 };
  const confidence = Math.min(1, best / (total / count) / 4);
  return { bpm: Math.round(((60 * fps) / bestLag) * 10) / 10, confidence };
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export function chromagram(mono: Float32Array, sr: number): Float32Array {
  const fs = 11025;
  const x = resample(mono.subarray(0, Math.min(mono.length, sr * 120)), sr, fs);
  const N = 4096, H = 2048, w = hann(N);
  const chroma = new Float32Array(12);
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let s = 0; s + N <= x.length; s += H) {
    for (let i = 0; i < N; i++) { re[i] = x[s + i] * w[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const f = (k * fs) / N;
      if (f < 55 || f > 2000) continue;
      const midi = 69 + 12 * Math.log2(f / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += Math.hypot(re[k], im[k]);
    }
  }
  return chroma;
}

function corr(a: ArrayLike<number>, b: number[]): number {
  const n = 12; let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, dbb = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; dbb += (b[i] - mb) ** 2; }
  return num / Math.sqrt(da * dbb || 1);
}

/** Krumhansl–Schmuckler key estimate; returns best and runner-up with a margin-based confidence. */
export function estimateKey(chroma: Float32Array): { key: string | null; confidence: number; alternative: string | null } {
  const scores: { k: string; r: number }[] = [];
  for (let t = 0; t < 12; t++) {
    const rot = Array.from({ length: 12 }, (_, i) => chroma[(i + t) % 12]);
    scores.push({ k: `${NOTE_NAMES[t]} major`, r: corr(rot, MAJOR) });
    scores.push({ k: `${NOTE_NAMES[t]} minor`, r: corr(rot, MINOR) });
  }
  scores.sort((a, b) => b.r - a.r);
  if (!isFinite(scores[0].r)) return { key: null, confidence: 0, alternative: null };
  return { key: scores[0].k, alternative: scores[1].k, confidence: Math.max(0, Math.min(1, (scores[0].r - scores[1].r) * 5 + 0.2 * scores[0].r)) };
}

export function analyze(p: PCM): AudioStats {
  const mono = toMono(p);
  const peak = peakOf(p);
  const t = estimateBpm(mono, p.sampleRate);
  const k = estimateKey(chromagram(mono, p.sampleRate));
  return {
    duration: pcmLength(p) / p.sampleRate, sampleRate: p.sampleRate, channels: p.channels.length,
    peak, peakDb: db(peak), rmsDb: db(rmsOf(mono)),
    bpm: t.bpm, bpmConfidence: t.confidence,
    key: k.key, keyConfidence: k.confidence, keyAlternative: k.alternative,
  };
}
