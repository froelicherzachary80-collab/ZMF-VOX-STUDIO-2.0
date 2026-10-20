import { all, del, get, put, uid } from './db';

export type ModelRole = 'rvc-voice' | 'content-encoder' | 'f0-rmvpe' | 'separation';
export interface ModelRecord {
  id: string; name: string; role: ModelRole; size: number; sha256: string;
  sampleRate?: number; license: string; source: 'imported' | 'downloaded'; storedIn: 'opfs' | 'indexeddb';
  addedAt: number; notes?: string; permissionConfirmed: boolean;
}

export async function sha256(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function opfsDir(): Promise<FileSystemDirectoryHandle | null> {
  try { const root = await navigator.storage.getDirectory(); return await root.getDirectoryHandle('models', { create: true }); } catch { return null; }
}

/** Basic ONNX sanity check: a protobuf ModelProto starts with field 1 (ir_version, varint) => 0x08. */
export function looksLikeOnnx(buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf, 0, Math.min(16, buf.byteLength));
  return b.length > 4 && b[0] === 0x08;
}

export async function storeModel(buf: ArrayBuffer, meta: Omit<ModelRecord, 'id' | 'size' | 'sha256' | 'storedIn' | 'addedAt'>): Promise<ModelRecord> {
  if (!looksLikeOnnx(buf)) throw new Error('File does not look like an ONNX model (protobuf header missing). Convert .pth to .onnx with the RVC export tool first.');
  const id = uid();
  const rec: ModelRecord = { ...meta, id, size: buf.byteLength, sha256: await sha256(buf), storedIn: 'indexeddb', addedAt: Date.now() };
  const dir = await opfsDir();
  let wrote = false;
  if (dir) {
    try {
      const fh = await dir.getFileHandle(id, { create: true });
      const w = await (fh as any).createWritable?.();
      if (w) { await w.write(buf); await w.close(); rec.storedIn = 'opfs'; wrote = true; }
    } catch { /* Safari < 17 lacks createWritable on main thread */ }
  }
  if (!wrote) await put('assets', `model:${id}`, new Blob([buf]));
  await put('models', id, rec);
  return rec;
}

export async function loadModelBytes(rec: ModelRecord): Promise<ArrayBuffer> {
  if (rec.storedIn === 'opfs') {
    const dir = await opfsDir(); if (!dir) throw new Error('OPFS unavailable');
    return (await (await dir.getFileHandle(rec.id)).getFile()).arrayBuffer();
  }
  const b = await get<Blob>('assets', `model:${rec.id}`);
  if (!b) throw new Error('Model bytes missing from storage');
  return b.arrayBuffer();
}

export async function verifyModel(rec: ModelRecord): Promise<boolean> { return (await sha256(await loadModelBytes(rec))) === rec.sha256; }
export const listModels = () => all<ModelRecord>('models');
export async function removeModel(rec: ModelRecord) {
  if (rec.storedIn === 'opfs') { const d = await opfsDir(); await d?.removeEntry(rec.id).catch(() => {}); } else await del('assets', `model:${rec.id}`);
  await del('models', rec.id);
}
