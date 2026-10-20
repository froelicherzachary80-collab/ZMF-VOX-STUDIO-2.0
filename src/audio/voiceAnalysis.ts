import type { PCM } from './pcm';
import { toMono } from './pcm';
import { yin, hzToMidi } from './pitch';
import { fft, hann } from './fft';
import { rmsOf } from './analysis';
import type { VoiceAnalysis } from '../store/singers';

/** Voice analysis (capability A): pitch statistics, spectral centroid, loudness. Not a model. */
export function analyzeVoice(samples: PCM[]): VoiceAnalysis {
  const f0s: number[] = []; let cent = 0, centN = 0, rmsAcc = 0, frames = 0, voiced = 0, seconds = 0;
  for (const s of samples) {
    const m = toMono(s), sr = s.sampleRate; seconds += m.length / sr;
    const tr = yin(m, sr, { hop: Math.round(sr / 50) });
    for (const f of tr.f0) { frames++; if (f > 0) { voiced++; f0s.push(f); } }
    rmsAcc += rmsOf(m) * m.length;
    const N = 2048, w = hann(N), re = new Float32Array(N), im = new Float32Array(N);
    for (let p = 0; p + N <= m.length; p += N * 4) {
      let e = 0; for (let i = 0; i < N; i++) { re[i] = m[p + i] * w[i]; im[i] = 0; e += re[i] ** 2; }
      if (e < 1e-3) continue;
      fft(re, im); let num = 0, den = 0;
      for (let k = 1; k < N / 2; k++) { const mag = Math.hypot(re[k], im[k]); num += mag * (k * sr) / N; den += mag; }
      cent += num / den; centN++;
    }
  }
  f0s.sort((a, b) => a - b);
  const q = (p: number) => f0s[Math.floor(p * (f0s.length - 1))] ?? 0;
  const total = samples.reduce((a, s) => a + s.channels[0].length, 0);
  const sc = centN ? cent / centN : 0;
  return {
    medianF0: q(0.5), rangeLowMidi: f0s.length ? hzToMidi(q(0.05)) : 0, rangeHighMidi: f0s.length ? hzToMidi(q(0.95)) : 0,
    spectralCentroid: sc, brightness: Math.min(1, sc / 4000), rmsDb: 20 * Math.log10(rmsAcc / Math.max(1, total) || 1e-9),
    voicedRatio: frames ? voiced / frames : 0, seconds, analyzedAt: Date.now(),
  };
}
