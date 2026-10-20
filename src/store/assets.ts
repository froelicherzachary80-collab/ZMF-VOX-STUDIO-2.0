import type { PCM } from '../audio/pcm';
import { del, get, put } from './db';

/** PCM is stored as raw Float32 channel blobs, so reopening needs no re-decode. */
interface StoredPCM { sampleRate: number; channels: Blob[]; }

export async function savePCM(id: string, p: PCM) {
  await put<StoredPCM>('assets', id, { sampleRate: p.sampleRate, channels: p.channels.map((c) => new Blob([c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength) as ArrayBuffer])) });
}
export async function loadPCM(id: string): Promise<PCM | undefined> {
  const s = await get<StoredPCM>('assets', id);
  if (!s) return undefined;
  return { sampleRate: s.sampleRate, channels: await Promise.all(s.channels.map(async (b) => new Float32Array(await b.arrayBuffer()))) };
}
export const deletePCM = (id: string) => del('assets', id);
