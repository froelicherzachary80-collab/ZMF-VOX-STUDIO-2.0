/** Pure-TypeScript sample-domain processors (run in workers, Node tests and the browser). */
import { biquad } from './loudness';

export function rbjCoeffs(type: 'lowpass' | 'highpass' | 'peaking' | 'lowshelf' | 'highshelf', f: number, sr: number, q = 0.707, gainDb = 0) {
  const A = Math.pow(10, gainDb / 40), w0 = (2 * Math.PI * f) / sr, c = Math.cos(w0), s = Math.sin(w0), al = s / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'lowpass': b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
    case 'highpass': b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
    case 'peaking': b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; break;
    case 'lowshelf': { const sq = 2 * Math.sqrt(A) * al;
      b0 = A * (A + 1 - (A - 1) * c + sq); b1 = 2 * A * (A - 1 - (A + 1) * c); b2 = A * (A + 1 - (A - 1) * c - sq);
      a0 = A + 1 + (A - 1) * c + sq; a1 = -2 * (A - 1 + (A + 1) * c); a2 = A + 1 + (A - 1) * c - sq; break; }
    case 'highshelf': { const sq = 2 * Math.sqrt(A) * al;
      b0 = A * (A + 1 + (A - 1) * c + sq); b1 = -2 * A * (A - 1 + (A + 1) * c); b2 = A * (A + 1 + (A - 1) * c - sq);
      a0 = A + 1 - (A - 1) * c + sq; a1 = 2 * (A - 1 - (A + 1) * c); a2 = A + 1 - (A - 1) * c - sq; break; }
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0] as const;
}

export const filt = (x: Float32Array, sr: number, type: Parameters<typeof rbjCoeffs>[0], f: number, q = 0.707, g = 0) =>
  biquad(x, ...rbjCoeffs(type, Math.min(f, sr * 0.45), sr, q, g));

/** Feed-forward RMS compressor with soft knee. Returns new array. */
export function compress(x: Float32Array, sr: number, o: { thresholdDb: number; ratio: number; attackMs: number; releaseMs: number; makeupDb?: number; knee?: number }): Float32Array {
  const y = new Float32Array(x.length);
  const at = Math.exp(-1 / ((o.attackMs / 1000) * sr)), rt = Math.exp(-1 / ((o.releaseMs / 1000) * sr));
  const knee = o.knee ?? 6, mk = Math.pow(10, (o.makeupDb ?? 0) / 20);
  let env = 0;
  for (let i = 0; i < x.length; i++) {
    const lv = x[i] * x[i];
    env = lv > env ? at * env + (1 - at) * lv : rt * env + (1 - rt) * lv;
    const ldb = 10 * Math.log10(env + 1e-12), over = ldb - o.thresholdDb;
    let gr = 0;
    if (over > knee / 2) gr = over * (1 - 1 / o.ratio);
    else if (over > -knee / 2) gr = ((over + knee / 2) ** 2 / (2 * knee)) * (1 - 1 / o.ratio);
    y[i] = x[i] * Math.pow(10, -gr / 20) * mk;
  }
  return y;
}

/** Look-ahead brickwall peak limiter, linked across channels. */
export function limit(chs: Float32Array[], sr: number, ceilingDb = -1, releaseMs = 80, lookMs = 3): Float32Array[] {
  const c = Math.pow(10, ceilingDb / 20), n = chs[0].length, la = Math.max(1, Math.round((lookMs / 1000) * sr));
  const rt = Math.exp(-1 / ((releaseMs / 1000) * sr));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) { let m = 0; for (const ch of chs) m = Math.max(m, Math.abs(ch[i])); need[i] = m > c ? c / m : 1; }
  // running min of required gain over look-ahead window (monotonic deque, O(n))
  const gmin = new Float32Array(n), dq = new Int32Array(n); let h = 0, t = 0;
  for (let j = n - 1; j >= 0; j--) {
    while (t > h && need[dq[t - 1]] >= need[j]) t--;
    dq[t++] = j;
    while (dq[h] >= j + la) h++;
    gmin[j] = need[dq[h]];
  }
  const out = chs.map(() => new Float32Array(n));
  let g = 1;
  for (let i = 0; i < n; i++) {
    g = gmin[i] < g ? gmin[i] : rt * g + (1 - rt) * gmin[i];
    if (g > gmin[i]) g = gmin[i];
    for (let k = 0; k < chs.length; k++) out[k][i] = chs[k][i] * g;
  }
  return out;
}

/** Split-band de-esser: compresses only the 5–10 kHz band when it exceeds threshold. */
export function deEss(x: Float32Array, sr: number, thresholdDb = -28, amount = 0.6): Float32Array {
  const hi = filt(x, sr, 'highpass', 5000, 0.7);
  const rest = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) rest[i] = x[i] - hi[i];
  const c = compress(hi, sr, { thresholdDb, ratio: 1 + 7 * amount, attackMs: 1, releaseMs: 60, knee: 4 });
  for (let i = 0; i < x.length; i++) rest[i] += c[i];
  return rest;
}

/** Gentle asymmetric tanh saturation with dry/wet. */
export function saturate(x: Float32Array, drive: number, mix: number): Float32Array {
  const y = new Float32Array(x.length), d = 1 + drive * 6, n = Math.tanh(d);
  for (let i = 0; i < x.length; i++) { const v = Math.tanh(d * x[i] + 0.05 * drive * x[i] * x[i]) / n; y[i] = x[i] * (1 - mix) + v * mix; }
  return y;
}

/** Click repair: detects single-sample discontinuities far above local slope and interpolates. */
export function declick(x: Float32Array, sensitivity = 8): { out: Float32Array; repaired: number } {
  const y = x.slice(); let repaired = 0; let avg = 1e-4;
  for (let i = 2; i < x.length - 2; i++) {
    const d = Math.abs(x[i] - (x[i - 1] + x[i + 1]) / 2);
    avg = 0.999 * avg + 0.001 * d;
    if (d > sensitivity * avg * 4 && d > 0.05) { y[i] = (y[i - 1] + x[i + 1]) / 2; repaired++; }
  }
  return { out: y, repaired };
}

/** Downward expander/noise gate with hysteresis-free smooth gain. */
export function gate(x: Float32Array, sr: number, thresholdDb = -55, rangeDb = 18): Float32Array {
  const y = new Float32Array(x.length), at = Math.exp(-1 / (0.002 * sr)), rt = Math.exp(-1 / (0.12 * sr));
  const floor = Math.pow(10, -rangeDb / 20), th = Math.pow(10, thresholdDb / 20);
  let env = 0, g = 1;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]); env = a > env ? at * env + (1 - at) * a : rt * env + (1 - rt) * a;
    const tg = env >= th ? 1 : Math.max(floor, env / th);
    g = tg > g ? 0.99 * g + 0.01 * tg : 0.9995 * g + 0.0005 * tg;
    y[i] = x[i] * g;
  }
  return y;
}
