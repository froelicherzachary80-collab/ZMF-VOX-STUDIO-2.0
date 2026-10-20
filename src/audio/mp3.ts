import type { PCM } from './pcm';
import { resamplePCM } from './pcm';

/** Real MP3 encoding with LAME (lamejs port), processed in 1152-sample frames. */
export async function encodeMp3(p: PCM, kbps = 192, onProgress?: (f: number) => void): Promise<Blob> {
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const allowed = [32000, 44100, 48000];
  const src = allowed.includes(p.sampleRate) ? p : resamplePCM(p, 44100);
  const nch = Math.min(2, src.channels.length);
  const enc = new Mp3Encoder(nch, src.sampleRate, kbps);
  const toI16 = (f: Float32Array) => {
    const o = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); o[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
    return o;
  };
  const L = toI16(src.channels[0]);
  const R = nch > 1 ? toI16(src.channels[1]) : undefined;
  const parts: BlobPart[] = [];
  const block = 1152 * 32;
  for (let i = 0; i < L.length; i += block) {
    const l = L.subarray(i, i + block);
    const out = R ? enc.encodeBuffer(l, R.subarray(i, i + block)) : enc.encodeBuffer(l);
    if (out.length) parts.push(new Uint8Array(out));
    if (onProgress && (i / block) % 20 === 0) { onProgress(i / L.length); await new Promise((r) => setTimeout(r)); }
  }
  const end = enc.flush();
  if (end.length) parts.push(new Uint8Array(end));
  onProgress?.(1);
  return new Blob(parts, { type: 'audio/mpeg' });
}
