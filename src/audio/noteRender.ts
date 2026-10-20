import type { PCM } from './pcm';
import type { Note } from './pitch';
import { hzToMidi, yin } from './pitch';
import { pitchShiftCurve } from './pitchshift';

/**
 * Re-renders a vocal from edited notes. For each frame inside a note, the target pitch is
 *   note.midi + (actualMidi - detectedMidi) * vibrato
 * so moving a note transposes it and the vibrato control scales the natural pitch
 * deviation. The per-sample ratio drives a real granular pitch shifter. Note gain is applied
 * with 10 ms fades. Formants shift with pitch (no formant preservation in this DSP path).
 */
export function renderNotes(src: PCM, notes: Note[]): PCM {
  const sr = src.sampleRate;
  const mono = src.channels[0];
  const tr = yin(mono, sr, { hop: Math.round(sr / 100) });
  const fps = sr / tr.hop;
  const ratioFrames = new Float32Array(tr.f0.length).fill(1);
  const gainFrames = new Float32Array(tr.f0.length).fill(1);
  for (const n of notes) {
    const a = Math.floor(n.start * fps), b = Math.min(tr.f0.length, Math.ceil(n.end * fps));
    for (let i = Math.max(0, a); i < b; i++) {
      gainFrames[i] = Math.pow(10, n.gainDb / 20);
      if (tr.f0[i] <= 0) { ratioFrames[i] = Math.pow(2, (n.midi - n.detectedMidi) / 12); continue; }
      const actual = hzToMidi(tr.f0[i]);
      const target = n.midi + (actual - n.detectedMidi) * n.vibrato;
      ratioFrames[i] = Math.pow(2, (target - actual) / 12);
    }
  }
  // smooth frame curves (~30 ms) to avoid zipper noise
  const smooth = (x: Float32Array) => { const y = x.slice(); for (let i = 0; i < x.length; i++) { let s = 0, c = 0; for (let j = i - 1; j <= i + 1; j++) if (j >= 0 && j < x.length) { s += x[j]; c++; } y[i] = s / c; } return y; };
  const R = smooth(ratioFrames), G = smooth(gainFrames);
  const at = (arr: Float32Array, i: number) => { const t = i / tr.hop, k = Math.min(arr.length - 1, Math.floor(t)), f = t - k; return arr[k] + ((arr[Math.min(arr.length - 1, k + 1)] ?? arr[k]) - arr[k]) * f; };
  const needsShift = R.some((r) => Math.abs(r - 1) > 1e-4);
  return {
    sampleRate: sr,
    channels: src.channels.map((c) => {
      const y = needsShift ? pitchShiftCurve(c, sr, (i) => (tr.f0.length ? at(R, i) : 1), 30) : c.slice();
      if (tr.f0.length) for (let i = 0; i < y.length; i++) y[i] *= at(G, i);
      return y;
    }),
  };
}
