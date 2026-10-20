import { fft, hann } from './fft';
import type { PCM } from './pcm';
import { toStereo } from './pcm';

/**
 * DSP center-channel extraction (NOT a neural model).
 * Per STFT bin, estimates how "centered" (L≈R, in phase) the content is and builds a soft
 * mask. Lead vocals are typically panned center, so this produces a vocal-leaning stem and
 * a residual instrumental. Quality is far below Demucs-class neural separation; reported as such.
 */
export async function centerSeparate(p: PCM, opts: { strength?: number; lowCutHz?: number; highCutHz?: number; onProgress?: (f: number) => void; signal?: AbortSignal } = {}): Promise<{ vocal: PCM; instrumental: PCM; method: string }> {
  const st = toStereo(p);
  const [L, R] = st.channels;
  const sr = p.sampleRate, N = 2048, H = N / 4, w = hann(N);
  const strength = opts.strength ?? 2, lo = opts.lowCutHz ?? 120, hi = opts.highCutHz ?? 8000;
  const n = L.length;
  const vL = new Float32Array(n + N), vR = new Float32Array(n + N), norm = new Float32Array(n + N);
  const lr = new Float32Array(N), li = new Float32Array(N), rr = new Float32Array(N), ri = new Float32Array(N);
  const mono = L === R || p.channels.length === 1;
  let frames = 0; const total = Math.ceil(n / H);
  for (let s = -N + H; s < n; s += H) {
    for (let i = 0; i < N; i++) {
      const idx = s + i;
      lr[i] = idx >= 0 && idx < n ? L[idx] * w[i] : 0; li[i] = 0;
      rr[i] = idx >= 0 && idx < n ? R[idx] * w[i] : 0; ri[i] = 0;
    }
    fft(lr, li); fft(rr, ri);
    for (let k = 0; k <= N / 2; k++) {
      const f = (k * sr) / N;
      let m = 0;
      if (f >= lo && f <= hi) {
        if (mono) m = 0.5;
        else {
          const dr = lr[k] - rr[k], di = li[k] - ri[k];
          const sumMag = Math.hypot(lr[k] + rr[k], li[k] + ri[k]) + 1e-9;
          const diff = Math.hypot(dr, di);
          const sim = Math.max(0, 1 - diff / sumMag); // 1 = identical L/R
          m = Math.pow(sim, strength);
        }
      }
      lr[k] *= m; li[k] *= m; rr[k] *= m; ri[k] *= m;
      if (k > 0 && k < N / 2) { lr[N - k] = lr[k]; li[N - k] = -li[k]; rr[N - k] = rr[k]; ri[N - k] = -ri[k]; }
    }
    fft(lr, li, true); fft(rr, ri, true);
    for (let i = 0; i < N; i++) {
      const idx = s + i; if (idx < 0 || idx >= n) continue;
      vL[idx] += lr[i] * w[i]; vR[idx] += rr[i] * w[i]; norm[idx] += w[i] * w[i];
    }
    if (++frames % 200 === 0) {
      opts.onProgress?.(frames / total);
      await new Promise((r) => setTimeout(r));
      if (opts.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    }
  }
  const VL = new Float32Array(n), VR = new Float32Array(n), IL = new Float32Array(n), IR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const g = norm[i] > 1e-6 ? 1 / norm[i] : 0;
    VL[i] = vL[i] * g; VR[i] = vR[i] * g; IL[i] = L[i] - VL[i]; IR[i] = R[i] - VR[i];
  }
  opts.onProgress?.(1);
  return {
    vocal: { sampleRate: sr, channels: [VL, VR] },
    instrumental: { sampleRate: sr, channels: [IL, IR] },
    method: mono ? 'DSP band-split (mono source – very weak separation)' : 'DSP center-channel spectral mask',
  };
}
