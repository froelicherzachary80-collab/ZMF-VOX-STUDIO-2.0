/** RMVPE front-end/back-end math (matches RVC infer/lib/rmvpe.py). Model itself is imported ONNX. */
import { fft, hann } from '../audio/fft';

const hzToMelHtk = (f: number) => 2595 * Math.log10(1 + f / 700);
const melToHzHtk = (m: number) => 700 * (Math.pow(10, m / 2595) - 1);

/** librosa.filters.mel(sr, n_fft, n_mels, fmin, fmax, htk=True, norm='slaney'), row-major [nMels, nFft/2+1]. */
export function melFilterbank(sr: number, nFft: number, nMels: number, fmin: number, fmax: number): Float32Array {
  const bins = nFft / 2 + 1, W = new Float32Array(nMels * bins);
  const mmin = hzToMelHtk(fmin), mmax = hzToMelHtk(fmax);
  const hz = Array.from({ length: nMels + 2 }, (_, i) => melToHzHtk(mmin + ((mmax - mmin) * i) / (nMels + 1)));
  for (let m = 0; m < nMels; m++) {
    const enorm = 2 / (hz[m + 2] - hz[m]);
    for (let k = 0; k < bins; k++) {
      const f = (k * sr) / nFft;
      const lower = (f - hz[m]) / (hz[m + 1] - hz[m]), upper = (hz[m + 2] - f) / (hz[m + 2] - hz[m + 1]);
      W[m * bins + k] = Math.max(0, Math.min(lower, upper)) * enorm;
    }
  }
  return W;
}

let FB: Float32Array | null = null;
/** log-mel [128, frames] (16 kHz, n_fft=win=1024, hop 160, centre reflect-pad, clamp 1e-5), padded to a multiple of 32 frames. */
export function rmvpeMel(x16: Float32Array): { mel: Float32Array; frames: number; padded: number } {
  const N = 1024, H = 160, nM = 128, bins = N / 2 + 1, w = hann(N);
  FB ??= melFilterbank(16000, N, nM, 30, 8000);
  const frames = Math.floor(x16.length / H) + 1, padded = 32 * Math.floor((frames - 1) / 32 + 1);
  const at = (i: number) => { const n = x16.length; if (n < 2) return 0; while (i < 0 || i >= n) i = i < 0 ? -i : 2 * (n - 1) - i; return x16[i]; };
  const mel = new Float32Array(nM * padded), re = new Float32Array(N), im = new Float32Array(N), mag = new Float32Array(bins);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < N; i++) { re[i] = at(f * H + i - N / 2) * w[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < bins; k++) mag[k] = Math.hypot(re[k], im[k]);
    for (let m = 0; m < nM; m++) { let s = 0; for (let k = 0; k < bins; k++) s += FB[m * bins + k] * mag[k]; mel[m * padded + f] = Math.log(Math.max(1e-5, s)); }
  }
  for (let f = frames; f < padded; f++) { const src = 2 * (frames - 1) - f; for (let m = 0; m < nM; m++) mel[m * padded + f] = mel[m * padded + Math.max(0, src)]; } // reflect pad
  return { mel, frames, padded };
}

/** to_local_average_cents + cents→Hz with threshold (salience [frames, 360]). */
export function decodeSalience(sal: Float32Array, frames: number, thred = 0.03): Float32Array {
  const f0 = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let c = 0, mx = -Infinity; for (let b = 0; b < 360; b++) { const v = sal[f * 360 + b]; if (v > mx) { mx = v; c = b; } }
    if (mx <= thred) continue;
    let num = 0, den = 0;
    for (let b = c - 4; b <= c + 4; b++) { if (b < 0 || b >= 360) continue; const v = sal[f * 360 + b]; num += v * (20 * b + 1997.3794084376191); den += v; }
    const hz = 10 * Math.pow(2, num / den / 1200); f0[f] = hz > 10.0001 ? hz : 0;
  }
  return f0;
}
