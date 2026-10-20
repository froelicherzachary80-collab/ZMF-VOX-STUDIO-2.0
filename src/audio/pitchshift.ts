/**
 * Granular dual-tap delay-line pitch shifter with a per-sample ratio curve.
 * Real signal processing: reads the input at `ratio` speed through two
 * crossfaded grains. Formants move with pitch (no formant preservation).
 */
export function pitchShiftCurve(x: Float32Array, sr: number, ratioAt: (i: number) => number, grainMs = 40): Float32Array {
  const G = Math.max(64, Math.round((grainMs / 1000) * sr));
  const out = new Float32Array(x.length);
  let phase = 0; // 0..1 position inside grain cycle
  for (let i = 0; i < x.length; i++) {
    const r = ratioAt(i);
    phase += (1 - r) / G;
    phase -= Math.floor(phase);
    let acc = 0;
    for (let tap = 0; tap < 2; tap++) {
      const p = (phase + tap * 0.5) % 1;
      const delay = p * G;
      const w = Math.sin(Math.PI * p);           // sin^2 crossfade sums to 1 for two taps
      const pos = i - delay - 1;
      const k = Math.floor(pos), f = pos - k;
      const a = k >= 0 && k < x.length ? x[k] : 0;
      const b = k + 1 >= 0 && k + 1 < x.length ? x[k + 1] : 0;
      acc += (a + (b - a) * f) * w * w;
    }
    out[i] = acc;
  }
  return out;
}

export const semis = (s: number) => Math.pow(2, s / 12);

export function pitchShift(x: Float32Array, sr: number, semitones: number): Float32Array {
  if (Math.abs(semitones) < 1e-3) return x.slice();
  const r = semis(semitones);
  return pitchShiftCurve(x, sr, () => r);
}
