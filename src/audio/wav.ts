import type { PCM } from './pcm';

/** 16-bit or 32-bit-float RIFF/WAVE encoder. */
export function encodeWav(p: PCM, bitDepth: 16 | 32 = 16, comment?: string): Blob {
  const nch = p.channels.length, n = p.channels[0].length;
  const bps = bitDepth / 8;
  const dataLen = n * nch * bps;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, bitDepth === 32 ? 3 : 1, true);
  v.setUint16(22, nch, true); v.setUint32(24, p.sampleRate, true);
  v.setUint32(28, p.sampleRate * nch * bps, true); v.setUint16(32, nch * bps, true); v.setUint16(34, bitDepth, true);
  str(36, 'data'); v.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      const s = Math.max(-1, Math.min(1, p.channels[c][i]));
      if (bitDepth === 32) { v.setFloat32(o, s, true); o += 4; }
      else { v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
    }
  }
  if (!comment) return new Blob([buf], { type: 'audio/wav' });
  // RIFF LIST/INFO ICMT chunk (used to label synthetic content); patch RIFF size.
  const txt = new TextEncoder().encode(comment + '\0'); const pad = txt.length & 1;
  const info = new Uint8Array(12 + 8 + txt.length + pad); const iv = new DataView(info.buffer);
  info.set([76, 73, 83, 84]); iv.setUint32(4, 4 + 8 + txt.length + pad, true); info.set([73, 78, 70, 79], 8);
  info.set([73, 67, 77, 84], 12); iv.setUint32(16, txt.length, true); info.set(txt, 20);
  v.setUint32(4, 36 + dataLen + info.length, true);
  return new Blob([buf, info], { type: 'audio/wav' });
}

/** Minimal PCM/float WAV parser (used by tests and as a decoder fallback). */
export function decodeWav(ab: ArrayBuffer): PCM {
  const v = new DataView(ab);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a RIFF/WAVE file');
  let o = 12, fmt = 1, nch = 1, sr = 44100, bits = 16;
  while (o + 8 <= v.byteLength) {
    const id = tag(o), len = v.getUint32(o + 4, true);
    if (id === 'fmt ') {
      fmt = v.getUint16(o + 8, true); nch = v.getUint16(o + 10, true);
      sr = v.getUint32(o + 12, true); bits = v.getUint16(o + 22, true);
      if (fmt === 0xfffe) fmt = v.getUint16(o + 32, true);
    } else if (id === 'data') {
      const bps = bits / 8, n = Math.floor(Math.min(len, v.byteLength - o - 8) / (bps * nch));
      const ch = Array.from({ length: nch }, () => new Float32Array(n));
      let p = o + 8;
      for (let i = 0; i < n; i++) for (let c = 0; c < nch; c++) {
        let s: number;
        if (fmt === 3 && bits === 32) s = v.getFloat32(p, true);
        else if (bits === 16) s = v.getInt16(p, true) / 32768;
        else if (bits === 24) { const b = v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16); s = b / 8388608; }
        else if (bits === 32) s = v.getInt32(p, true) / 2147483648;
        else s = (v.getUint8(p) - 128) / 128;
        ch[c][i] = s; p += bps;
      }
      return { sampleRate: sr, channels: ch };
    }
    o += 8 + len + (len & 1);
  }
  throw new Error('WAV has no data chunk');
}
