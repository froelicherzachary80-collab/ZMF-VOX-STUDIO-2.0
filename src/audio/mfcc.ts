import { fft, hann } from './fft';
import { resample } from './pcm';
import { melFilterbank } from '../ai/rmvpeMath';

/** Mean MFCC (c1..c19) over energetic frames — a coarse timbre fingerprint, NOT speaker verification. */
export function meanMfcc(x: Float32Array, sr: number): Float32Array {
  const y = sr === 16000 ? x : resample(x, sr, 16000);
  const N = 512, H = 256, nM = 40, nC = 20, bins = N / 2 + 1, w = hann(N), fb = melFilterbank(16000, N, nM, 60, 7600);
  const re = new Float32Array(N), im = new Float32Array(N), lm = new Float32Array(nM), acc = new Float64Array(nC - 1);
  const energies: number[] = [];
  for (let s = 0; s + N <= y.length; s += H) { let e = 0; for (let i = 0; i < N; i++) e += y[s + i] ** 2; energies.push(e); }
  const thr = [...energies].sort((a, b) => a - b)[Math.floor(energies.length * 0.5)] ?? 0;
  let n = 0;
  for (let s = 0, fi = 0; s + N <= y.length; s += H, fi++) {
    if (energies[fi] < thr || energies[fi] < 1e-6) continue;
    for (let i = 0; i < N; i++) { re[i] = y[s + i] * w[i]; im[i] = 0; } fft(re, im);
    for (let m = 0; m < nM; m++) { let a = 0; for (let k = 0; k < bins; k++) a += fb[m * bins + k] * (re[k] ** 2 + im[k] ** 2); lm[m] = Math.log(a + 1e-10); }
    for (let c = 1; c < nC; c++) { let a = 0; for (let m = 0; m < nM; m++) a += lm[m] * Math.cos((Math.PI * c * (m + 0.5)) / nM); acc[c - 1] += a; }
    n++;
  }
  return Float32Array.from(acc, (v) => (n ? v / n : 0));
}

export const cosine = (a: Float32Array, b: Float32Array) => { let s = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; x += a[i] ** 2; y += b[i] ** 2; } return s / Math.sqrt(x * y || 1); };

/** How much closer (in MFCC-mean cosine) the converted vocal is to the target than the source was. */
export function voiceMatch(source: Float32Array, converted: Float32Array, sr: number, target: Float32Array) {
  const s = meanMfcc(source, sr), c = meanMfcc(converted, sr);
  return { sourceToTarget: cosine(s, target), convertedToTarget: cosine(c, target) };
}
