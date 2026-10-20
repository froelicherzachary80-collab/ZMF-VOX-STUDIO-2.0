import { get, put, del, uid } from '../store/db';
import { kmeans, parseNpy, type FeatureBank } from './featureIndex';
import { loadOrt } from './rvc';
import { loadModelBytes, listModels } from '../store/models';
import type { PCM } from '../audio/pcm';
import { resample, toMono } from '../audio/pcm';

interface StoredBank { dim: number; count: number; data: Blob; }

export async function saveBank(b: FeatureBank): Promise<string> {
  const id = uid(); await put<StoredBank>('assets', `bank:${id}`, { dim: b.dim, count: b.count, data: new Blob([b.data.buffer.slice(0) as ArrayBuffer]) }); return id;
}
export async function loadBank(id: string): Promise<FeatureBank | undefined> {
  const s = await get<StoredBank>('assets', `bank:${id}`); if (!s) return undefined;
  return { dim: s.dim, count: s.count, data: new Float32Array(await s.data.arrayBuffer()) };
}
export const deleteBank = (id: string) => del('assets', `bank:${id}`);

/** Build a feature index from the singer's own reference audio with their content encoder. */
export async function buildBankFromSamples(contentModelId: string, samples: PCM[], k: number, onProgress?: (f: number, msg: string) => void): Promise<{ bank: FeatureBank; sourceFrames: number }> {
  const rec = (await listModels()).find((m) => m.id === contentModelId); if (!rec) throw new Error('Content encoder not found');
  const ort = await loadOrt();
  let session;
  try { session = await ort.InferenceSession.create(new Uint8Array(await loadModelBytes(rec)), { executionProviders: ['webgpu', 'wasm'] }); }
  catch { session = await ort.InferenceSession.create(new Uint8Array(await loadModelBytes(rec)), { executionProviders: ['wasm'] }); }
  const parts: Float32Array[] = []; let dim = 0, frames = 0;
  const chunks = samples.map((s) => resample(toMono(s), s.sampleRate, 16000));
  const total = chunks.reduce((a, c) => a + Math.ceil(c.length / 160000), 0); let done = 0;
  for (const x of chunks) for (let o = 0; o < x.length; o += 160000) {
    const seg = x.slice(o, Math.min(x.length, o + 160000)); if (seg.length < 8000) continue;
    const r = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', seg, [1, 1, seg.length]) });
    const t = r[session.outputNames[0]]; dim = (t.dims as number[])[2]; frames += (t.dims as number[])[1];
    parts.push(Float32Array.from(t.data as Float32Array));
    onProgress?.(++done / total * 0.5, `Encoding reference audio ${done}/${total}`); await new Promise((r) => setTimeout(r));
  }
  await session.release();
  if (!frames) throw new Error('Reference samples too short to build an index (need ≥ 0.5 s each).');
  const all = new Float32Array(frames * dim); let p = 0; for (const a of parts) { all.set(a, p); p += a.length; }
  onProgress?.(0.6, `Clustering ${frames} frames → ${Math.min(k, frames)} vectors (k-means)`); await new Promise((r) => setTimeout(r, 20));
  const bank = kmeans({ dim, count: frames, data: all }, k);
  onProgress?.(1, 'Index ready');
  return { bank, sourceFrames: frames };
}

export async function bankFromNpy(buf: ArrayBuffer, k: number): Promise<{ bank: FeatureBank; sourceFrames: number }> {
  const raw = parseNpy(buf);
  return { bank: raw.count > k ? kmeans(raw, k, 8) : raw, sourceFrames: raw.count };
}
