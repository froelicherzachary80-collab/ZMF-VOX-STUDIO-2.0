import type { PCM } from './pcm';

/** Direct-form-I biquad over a Float32Array (returns new array). */
export function biquad(x: Float32Array, b0: number, b1: number, b2: number, a1: number, a2: number): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/** ITU-R BS.1770-4 K-weighting coefficients for an arbitrary sample rate. */
function kWeight(x: Float32Array, fs: number): Float32Array {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const s1 = biquad(x, (Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  f0 = 38.13547087602444; Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  return biquad(s1, 1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
}

/** Integrated loudness (LUFS) with absolute (-70) and relative (-10 LU) gating. */
export function integratedLufs(p: PCM): number {
  const fs = p.sampleRate;
  const w = p.channels.slice(0, 2).map((c) => kWeight(c, fs));
  const block = Math.round(0.4 * fs), hop = Math.round(0.1 * fs);
  const ms: number[] = [];
  for (let s = 0; s + block <= w[0].length; s += hop) {
    let sum = 0;
    for (const c of w) { let a = 0; for (let i = s; i < s + block; i++) a += c[i] * c[i]; sum += a / block; }
    ms.push(sum);
  }
  if (!ms.length) return -Infinity;
  const L = (z: number) => -0.691 + 10 * Math.log10(z);
  const abs = ms.filter((z) => L(z) > -70);
  if (!abs.length) return -Infinity;
  const rel = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter((z) => L(z) > rel);
  return L(gated.reduce((a, b) => a + b, 0) / gated.length);
}

/** True-peak estimate via 4x oversampling with a windowed-sinc interpolator (BS.1770 Annex 2 style). */
export function truePeak(p: PCM): number {
  const taps = 12; let m = 0;
  for (const c of p.channels) {
    for (let i = 0; i < c.length; i++) {
      const a = Math.abs(c[i]); if (a > m) m = a;
      if (a < m * 0.5) continue; // inter-sample overs only matter near existing peaks
      for (let ph = 1; ph < 4; ph++) {
        const t = ph / 4; let acc = 0;
        for (let k = -taps + 1; k <= taps; k++) {
          const idx = i + k; if (idx < 0 || idx >= c.length) continue;
          const d = k - t; const sinc = Math.sin(Math.PI * d) / (Math.PI * d);
          const win = 0.5 + 0.5 * Math.cos((Math.PI * d) / taps);
          acc += c[idx] * sinc * win;
        }
        if (Math.abs(acc) > m) m = Math.abs(acc);
      }
    }
  }
  return m;
}
