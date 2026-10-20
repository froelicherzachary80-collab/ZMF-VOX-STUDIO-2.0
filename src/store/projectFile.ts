import type { PCM } from '../audio/pcm';
import { decodeWav, encodeWav } from '../audio/wav';
import type { Project } from './project';

/**
 * Portable project file: a small binary container
 *   "ZMFP" | u32 jsonLength | JSON | (u32 assetIdLen | assetId | u32 wavLen | WAV)*
 * Streaming-friendly (no base64 inflation) and assembled as a Blob of parts to limit memory spikes.
 */
export async function exportProjectFile(p: Project, pcms: Map<string, PCM>, bundleAudio: boolean): Promise<Blob> {
  const enc = new TextEncoder();
  const json = enc.encode(JSON.stringify({ format: 'zmf-project', version: 1, project: p, bundled: bundleAudio }));
  const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
  const parts: BlobPart[] = [enc.encode('ZMFP'), u32(json.length), json];
  if (bundleAudio) for (const t of p.tracks) {
    const pcm = pcms.get(t.assetId); if (!pcm) continue;
    const id = enc.encode(t.assetId); const wav = encodeWav(pcm, 32);
    parts.push(u32(id.length), id, u32(wav.size), wav);
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}

export async function importProjectFile(b: Blob): Promise<{ project: Project; assets: Map<string, PCM> }> {
  const buf = await b.arrayBuffer(); const v = new DataView(buf); const dec = new TextDecoder();
  if (dec.decode(new Uint8Array(buf, 0, 4)) !== 'ZMFP') throw new Error('Not a ZMF project file');
  const jl = v.getUint32(4, true); const meta = JSON.parse(dec.decode(new Uint8Array(buf, 8, jl)));
  const assets = new Map<string, PCM>(); let o = 8 + jl;
  while (o + 4 <= buf.byteLength) {
    const il = v.getUint32(o, true); const id = dec.decode(new Uint8Array(buf, o + 4, il)); o += 4 + il;
    const wl = v.getUint32(o, true); assets.set(id, decodeWav(buf.slice(o + 4, o + 4 + wl))); o += 4 + wl;
  }
  return { project: meta.project, assets };
}
