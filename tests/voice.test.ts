import { describe, expect, it } from 'vitest';
import { kmeans, parseNpy, protectBlend, retrieveBlend } from '../src/ai/featureIndex';
import { decodeSalience, melFilterbank, rmvpeMel } from '../src/ai/rmvpeMath';
import { meanMfcc, cosine } from '../src/audio/mfcc';
import { checkQuality } from '../src/audio/quality';
import { sliceForTraining } from '../src/audio/dataset';
import { crc32, zip } from '../src/store/zip';

const sr = 16000;
const tone = (f: number, sec: number, a = 0.4, harm = [1]) => Float32Array.from({ length: Math.round(sec * sr) }, (_, i) => harm.reduce((s, h, k) => s + (a / (k + 1)) * h * Math.sin(2 * Math.PI * f * (k + 1) * i / sr), 0));

function npy(data: Float32Array, rows: number, cols: number, dtype = '<f4'): ArrayBuffer {
  let h = `{'descr': '${dtype}', 'fortran_order': False, 'shape': (${rows}, ${cols}), }`;
  while ((10 + h.length + 1) % 64) h += ' '; h += '\n';
  const out = new Uint8Array(10 + h.length + data.byteLength);
  out.set([0x93, ...'NUMPY'.split('').map((c) => c.charCodeAt(0)), 1, 0]); new DataView(out.buffer).setUint16(8, h.length, true);
  out.set(new TextEncoder().encode(h), 10); out.set(new Uint8Array(data.buffer), 10 + h.length); return out.buffer;
}

describe('Feature index', () => {
  it('parses .npy float32 [N, dim]', () => {
    const b = parseNpy(npy(Float32Array.from({ length: 12 }, (_, i) => i), 4, 3));
    expect(b.count).toBe(4); expect(b.dim).toBe(3); expect(b.data[11]).toBe(11);
  });
  it('k-means finds well-separated clusters', () => {
    const d: number[] = []; for (let i = 0; i < 200; i++) { const c = i % 2 ? 10 : -10; d.push(c + Math.sin(i) * 0.1, c + Math.cos(i) * 0.1); }
    const c = kmeans({ dim: 2, count: 200, data: Float32Array.from(d) }, 2);
    const xs = [c.data[0], c.data[2]].sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-10, 0); expect(xs[1]).toBeCloseTo(10, 0);
  });
  it('retrieval pulls features toward the target bank by indexRate', () => {
    const bank = { dim: 2, count: 2, data: Float32Array.from([1, 1, 1.2, 1.2]) };
    const f = Float32Array.from([0, 0]);
    retrieveBlend(f, 1, bank, 1);
    expect(f[0]).toBeGreaterThan(1); expect(f[0]).toBeLessThan(1.2);
    const g = Float32Array.from([0, 0]); retrieveBlend(g, 1, bank, 0.5); expect(g[0]).toBeGreaterThan(0.5); expect(g[0]).toBeLessThan(0.6);
    expect(() => retrieveBlend(new Float32Array(3), 1, bank, 1)).toThrow();
  });
  it('protect keeps original features only in unvoiced frames', () => {
    const r = Float32Array.from([1, 1, 1, 1]), o = Float32Array.from([0, 0, 0, 0]);
    protectBlend(r, o, Float32Array.from([200, 0]), 2, 0.25);
    expect([...r]).toEqual([1, 1, 0.25, 0.25]);
  });
});

describe('RMVPE math', () => {
  it('slaney/htk mel filterbank is non-negative and covers the band', () => {
    const W = melFilterbank(16000, 1024, 128, 30, 8000);
    expect(W.every((v) => v >= 0)).toBe(true);
    for (let m = 0; m < 128; m += 16) expect(W.subarray(m * 513, (m + 1) * 513).some((v) => v > 0)).toBe(true);
  });
  it('mel frames = floor(N/160)+1, padded to ×32', () => {
    const { frames, padded, mel } = rmvpeMel(tone(220, 1));
    expect(frames).toBe(101); expect(padded).toBe(128); expect(mel.length).toBe(128 * 128); expect(mel.every(Number.isFinite)).toBe(true);
  });
  it('decodes salience peaks to Hz using RVC cents mapping', () => {
    const sal = new Float32Array(2 * 360); const bin = 100; sal[bin] = 1; // frame 0 voiced
    const f0 = decodeSalience(sal, 2);
    expect(f0[0]).toBeCloseTo(10 * Math.pow(2, (20 * bin + 1997.3794084376191) / 1200), 3); expect(f0[1]).toBe(0);
  });
});

describe('Timbre & quality', () => {
  it('MFCC fingerprint separates different timbres', () => {
    const a1 = meanMfcc(tone(220, 1, 0.4, [1, 0.8, 0.6, 0.4, 0.3]), sr), a2 = meanMfcc(tone(247, 1, 0.4, [1, 0.8, 0.6, 0.4, 0.3]), sr), b = meanMfcc(tone(220, 1, 0.4, [1]), sr);
    expect(cosine(a1, a2)).toBeGreaterThan(cosine(a1, b));
  });
  it('quality check flags clipping and noise', () => {
    const clipped = tone(220, 2, 1.5).map((v) => Math.max(-1, Math.min(1, v)));
    expect(checkQuality({ sampleRate: sr, channels: [clipped] }).verdicts.some((v) => v.level === 'bad' && /Clipping/.test(v.text))).toBe(true);
    const clean = new Float32Array(sr * 4); const t = tone(220, 1); clean.set(t, sr); clean.set(t, sr * 2.5);
    const r = checkQuality({ sampleRate: sr, channels: [clean] });
    expect(r.verdicts.some((v) => v.level === 'bad')).toBe(false);
  });
});

describe('Dataset export', () => {
  it('slices on silence into 3–12 s normalised clips', () => {
    const x = new Float32Array(sr * 30); x.set(tone(220, 5), 0); x.set(tone(330, 20), sr * 6); // 5 s + 20 s phrases
    const clips = sliceForTraining({ sampleRate: sr, channels: [x] }, 40000);
    expect(clips.length).toBe(3); // 5 s, 12 s, 8 s
    for (const c of clips) { const s = c.length / 40000; expect(s).toBeGreaterThanOrEqual(3); expect(s).toBeLessThanOrEqual(12.01); expect(c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)).toBeCloseTo(0.891, 2); }
  });
  it('zip has valid CRC and structure', async () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const z = new Uint8Array(await zip([{ name: 'a.txt', data: new TextEncoder().encode('hi') }]).arrayBuffer());
    expect(new DataView(z.buffer).getUint32(0, true)).toBe(0x04034b50);
    expect(new DataView(z.buffer).getUint32(z.length - 22, true)).toBe(0x06054b50);
  });
});
