import type { PCM } from './pcm';
import { resample, toMono } from './pcm';

/** Split on silences into 3–12 s clips, peak-normalise to −1 dBFS, resample (RVC training-set prep). */
export function sliceForTraining(p: PCM, targetSr = 40000, minSec = 3, maxSec = 12, silenceDb = -40): Float32Array[] {
  const x = resample(toMono(p), p.sampleRate, targetSr), sr = targetSr, hop = Math.round(sr * 0.02);
  const thr = Math.pow(10, silenceDb / 20); const loud: boolean[] = [];
  for (let s = 0; s < x.length; s += hop) { let m = 0; for (let i = s; i < Math.min(x.length, s + hop); i++) m = Math.max(m, Math.abs(x[i])); loud.push(m > thr); }
  const clips: Float32Array[] = []; let start = -1, lastLoud = -1;
  const emit = (a: number, b: number) => {
    for (let s = a; s < b; s += maxSec * sr) {
      const e = Math.min(b, s + maxSec * sr); if (e - s < minSec * sr) continue;
      const c = x.slice(s, e); let pk = 0; for (const v of c) pk = Math.max(pk, Math.abs(v));
      const g = pk > 0 ? 0.891 / pk : 1; for (let i = 0; i < c.length; i++) c[i] *= g; clips.push(c);
    }
  };
  for (let k = 0; k < loud.length; k++) {
    if (loud[k]) { if (start < 0) start = k; lastLoud = k; }
    else if (start >= 0 && (k - lastLoud) * hop > sr * 0.4) { emit(start * hop, Math.min(x.length, (lastLoud + 1) * hop)); start = -1; }
  }
  if (start >= 0) emit(start * hop, Math.min(x.length, (lastLoud + 1) * hop));
  return clips;
}
