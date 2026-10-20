/** Plain, transferable PCM container used across the whole app (no AudioBuffer dependency). */
export interface PCM {
  sampleRate: number;
  channels: Float32Array[];
}

export const pcmLength = (p: PCM) => (p.channels[0]?.length ?? 0);
export const pcmDuration = (p: PCM) => pcmLength(p) / p.sampleRate;

export function toMono(p: PCM): Float32Array {
  if (p.channels.length === 1) return p.channels[0];
  const n = pcmLength(p);
  const out = new Float32Array(n);
  const k = 1 / p.channels.length;
  for (const ch of p.channels) for (let i = 0; i < n; i++) out[i] += ch[i] * k;
  return out;
}

export function toStereo(p: PCM): PCM {
  if (p.channels.length >= 2) return { sampleRate: p.sampleRate, channels: [p.channels[0], p.channels[1]] };
  return { sampleRate: p.sampleRate, channels: [p.channels[0], p.channels[0].slice()] };
}

export function slicePCM(p: PCM, startSec: number, endSec: number): PCM {
  const a = Math.max(0, Math.floor(startSec * p.sampleRate));
  const b = Math.min(pcmLength(p), Math.floor(endSec * p.sampleRate));
  return { sampleRate: p.sampleRate, channels: p.channels.map((c) => c.slice(a, Math.max(a, b))) };
}

/** Windowed-sinc-free linear-phase resampler: cubic (Catmull-Rom) interpolation with a
 *  simple pre-filter when downsampling. Adequate for analysis/model input. */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x.slice();
  let src = x;
  if (to < from) src = lowpass(x, (0.45 * to) / from);
  const ratio = from / to;
  const n = Math.floor(x.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i * ratio;
    const k = Math.floor(t);
    const f = t - k;
    const p0 = src[Math.max(0, k - 1)] ?? 0, p1 = src[k] ?? 0, p2 = src[k + 1] ?? p1, p3 = src[k + 2] ?? p2;
    out[i] = p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
  }
  return out;
}

/** Windowed-sinc FIR low-pass; cutoff is normalized to the sample rate (0..0.5). */
export function lowpass(x: Float32Array, cutoff: number, taps = 63): Float32Array {
  const h = new Float32Array(taps);
  const m = (taps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const t = i - m;
    const sinc = t === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * t) / (Math.PI * t);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    h[i] = sinc * w;
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let acc = 0;
    for (let j = 0; j < taps; j++) {
      const idx = i + j - m;
      if (idx >= 0 && idx < x.length) acc += x[idx] * h[j];
    }
    out[i] = acc;
  }
  return out;
}

export function resamplePCM(p: PCM, to: number): PCM {
  return { sampleRate: to, channels: p.channels.map((c) => resample(c, p.sampleRate, to)) };
}

/** Sum PCMs with gains into a stereo buffer at the first buffer's sample rate. */
export function mixPCM(parts: { pcm: PCM; gain: number }[]): PCM {
  const sr = parts[0].pcm.sampleRate;
  const st = parts.map((p) => ({ g: p.gain, s: toStereo(p.pcm.sampleRate === sr ? p.pcm : resamplePCM(p.pcm, sr)) }));
  const n = Math.max(...st.map((p) => pcmLength(p.s)));
  const L = new Float32Array(n), R = new Float32Array(n);
  for (const { g, s } of st) {
    const [a, b] = s.channels;
    for (let i = 0; i < a.length; i++) { L[i] += a[i] * g; R[i] += b[i] * g; }
  }
  return { sampleRate: sr, channels: [L, R] };
}
