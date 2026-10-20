/** Pure helpers for the RVC adapter (unit-tested without ONNX Runtime). */
const F0_MEL_MIN = 1127 * Math.log(1 + 50 / 700);
const F0_MEL_MAX = 1127 * Math.log(1 + 1100 / 700);

/** RVC coarse pitch bins (1..255), exactly as in RVC's ONNX inference. */
export function coarsePitch(f0: Float32Array): BigInt64Array {
  const out = new BigInt64Array(f0.length);
  for (let i = 0; i < f0.length; i++) {
    let m = 1127 * Math.log(1 + f0[i] / 700);
    if (m > 0) m = ((m - F0_MEL_MIN) * 254) / (F0_MEL_MAX - F0_MEL_MIN) + 1;
    m = Math.min(255, Math.max(1, m));
    out[i] = BigInt(Math.round(m));
  }
  return out;
}

/** Equal-power crossfade concatenation of chunk outputs. */
export function overlapAdd(chunks: Float32Array[], hopSamples: number[], fade: number): Float32Array {
  const total = hopSamples.reduce((a, b) => a + b, 0) + (chunks.at(-1)?.length ?? 0) - (hopSamples.at(-1) ?? 0);
  const out = new Float32Array(Math.max(0, total));
  let pos = 0;
  chunks.forEach((c, k) => {
    for (let i = 0; i < c.length && pos + i < out.length; i++) {
      let w = 1;
      if (k > 0 && i < fade) w = Math.sin((Math.PI / 2) * (i / fade));
      if (k < chunks.length - 1 && i >= c.length - fade) w *= Math.cos((Math.PI / 2) * ((i - (c.length - fade)) / fade));
      out[pos + i] += c[i] * w * w ; // power-complementary (sin² + cos² = 1)
    }
    pos += hopSamples[k] ?? 0;
  });
  return out;
}


/** Shapes an f0 contour (Hz, 0 = unvoiced) before it drives the generator:
 *  - correction: 0..1 pull toward nearest semitone of the slow contour (keeps vibrato)
 *  - vibrato: scale of deviation around a ~150 ms moving average (1 = unchanged)
 *  - stability: 0..1 extra smoothing of jitter */
export function shapeF0(f0: Float32Array, o: { correction: number; vibrato: number; stability: number; fps?: number }): Float32Array {
  const fps = o.fps ?? 100, n = f0.length, out = new Float32Array(n);
  const m = new Float32Array(n);
  for (let i = 0; i < n; i++) m[i] = f0[i] > 0 ? 69 + 12 * Math.log2(f0[i] / 440) : 0;
  const avg = (arr: Float32Array, half: number) => {
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) { if (!arr[i]) continue; let s = 0, c = 0; for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) if (arr[j]) { s += arr[j]; c++; } r[i] = s / c; }
    return r;
  };
  const slow = avg(m, Math.round(0.075 * fps));
  const jit = o.stability > 0 ? avg(m, Math.max(1, Math.round(0.02 * fps * (1 + 2 * o.stability)))) : m;
  for (let i = 0; i < n; i++) {
    if (!m[i]) continue;
    const base = slow[i];
    const dev = (o.stability > 0 ? jit[i] * o.stability + m[i] * (1 - o.stability) : m[i]) - base;
    const target = base + (Math.round(base) - base) * o.correction;
    out[i] = 440 * Math.pow(2, (target + dev * o.vibrato - 69) / 12);
  }
  return out;
}
