/**
 * RVC-style feature retrieval ("index") without FAISS.
 *
 * RVC improves target-speaker similarity by replacing each content-feature frame with a
 * weighted average of its k nearest neighbours from the *target singer's* own features
 * (weights 1/d², k = 8), blended by `indexRate`. We build that bank on-device from the
 * singer's reference samples (or import RVC's total_fea.npy), compressed with k-means.
 */
export interface FeatureBank { dim: number; count: number; data: Float32Array; }

/** Parse a little-endian float32/float16 .npy array of shape [N, dim]. */
export function parseNpy(buf: ArrayBuffer): FeatureBank {
  const u = new Uint8Array(buf);
  if (u[0] !== 0x93 || String.fromCharCode(...u.subarray(1, 6)) !== 'NUMPY') throw new Error('Not a .npy file');
  const major = u[6], v = new DataView(buf);
  const hlen = major === 1 ? v.getUint16(8, true) : v.getUint32(8, true);
  const hoff = major === 1 ? 10 : 12;
  const header = new TextDecoder().decode(u.subarray(hoff, hoff + hlen));
  const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1];
  if (/'fortran_order':\s*True/.test(header)) throw new Error('Fortran-order .npy not supported');
  const shape = (/'shape':\s*\(([^)]*)\)/.exec(header)?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  if (shape.length !== 2) throw new Error(`Expected a 2-D [N, dim] array, got shape (${shape.join(',')})`);
  const [count, dim] = shape, off = hoff + hlen, n = count * dim;
  let data: Float32Array;
  if (descr === '<f4') data = new Float32Array(buf.slice(off, off + n * 4));
  else if (descr === '<f2') { data = new Float32Array(n); for (let i = 0; i < n; i++) data[i] = halfToFloat(v.getUint16(off + i * 2, true)); }
  else throw new Error(`Unsupported dtype ${descr} (need float32 or float16)`);
  return { dim, count, data };
}

function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}

/** Deterministic k-means (k-means++ seeding with a fixed PRNG). */
export function kmeans(bank: FeatureBank, k: number, iters = 12, seed = 7): FeatureBank {
  const { dim, count, data } = bank;
  if (count <= k) return { dim, count, data: data.slice() };
  let st = seed; const rnd = () => ((st = (st * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const C = new Float32Array(k * dim), d2 = new Float64Array(count).fill(Infinity);
  const dist = (i: number, c: Float32Array, j: number) => { let s = 0; for (let t = 0; t < dim; t++) { const x = data[i * dim + t] - c[j * dim + t]; s += x * x; } return s; };
  C.set(data.subarray(0, dim), 0);
  for (let j = 1; j < k; j++) {
    let tot = 0; for (let i = 0; i < count; i++) { d2[i] = Math.min(d2[i], dist(i, C, j - 1)); tot += d2[i]; }
    let r = rnd() * tot, pick = count - 1; for (let i = 0; i < count; i++) { r -= d2[i]; if (r <= 0) { pick = i; break; } }
    C.set(data.subarray(pick * dim, pick * dim + dim), j * dim);
  }
  const assign = new Int32Array(count);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < count; i++) { let b = 0, bd = Infinity; for (let j = 0; j < k; j++) { const d = dist(i, C, j); if (d < bd) { bd = d; b = j; } } assign[i] = b; }
    const sum = new Float64Array(k * dim), n = new Int32Array(k);
    for (let i = 0; i < count; i++) { n[assign[i]]++; for (let t = 0; t < dim; t++) sum[assign[i] * dim + t] += data[i * dim + t]; }
    for (let j = 0; j < k; j++) if (n[j]) for (let t = 0; t < dim; t++) C[j * dim + t] = sum[j * dim + t] / n[j];
  }
  return { dim, count: k, data: C };
}

/** In-place retrieval blend: feats[f] = indexRate·Σ wᵢ·bank[nnᵢ] + (1−indexRate)·feats[f], wᵢ ∝ 1/dᵢ². */
export function retrieveBlend(feats: Float32Array, frames: number, bank: FeatureBank, indexRate: number, k = 8): Float32Array {
  const dim = bank.dim; if (indexRate <= 0 || !bank.count) return feats;
  if (feats.length !== frames * dim) throw new Error(`Feature bank dim ${dim} does not match content encoder output`);
  const kk = Math.min(k, bank.count), bd = new Float64Array(kk), bi = new Int32Array(kk), acc = new Float64Array(dim);
  for (let f = 0; f < frames; f++) {
    bd.fill(Infinity);
    for (let j = 0; j < bank.count; j++) {
      let s = 0; for (let t = 0; t < dim; t++) { const x = feats[f * dim + t] - bank.data[j * dim + t]; s += x * x; }
      if (s < bd[kk - 1]) { let p = kk - 1; while (p > 0 && bd[p - 1] > s) { bd[p] = bd[p - 1]; bi[p] = bi[p - 1]; p--; } bd[p] = s; bi[p] = j; }
    }
    acc.fill(0); let wsum = 0;
    for (let q = 0; q < kk; q++) { const w = 1 / Math.max(1e-12, bd[q]); wsum += w; for (let t = 0; t < dim; t++) acc[t] += w * bank.data[bi[q] * dim + t]; }
    for (let t = 0; t < dim; t++) feats[f * dim + t] = (acc[t] / wsum) * indexRate + feats[f * dim + t] * (1 - indexRate);
  }
  return feats;
}

/** RVC "protect": in unvoiced frames keep a share of the un-retrieved features (consonant clarity). */
export function protectBlend(retrieved: Float32Array, original: Float32Array, pitchf: Float32Array, dim: number, protect: number): Float32Array {
  if (protect >= 0.5) return retrieved;
  for (let f = 0; f < pitchf.length; f++) if (pitchf[f] <= 0)
    for (let t = 0; t < dim; t++) retrieved[f * dim + t] = retrieved[f * dim + t] * protect + original[f * dim + t] * (1 - protect);
  return retrieved;
}
