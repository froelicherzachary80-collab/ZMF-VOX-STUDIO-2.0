import type { PCM } from './pcm';
import { decodeWav } from './wav';

/** Local decode via Web Audio (MP3/WAV/AAC/...); falls back to built-in WAV parser. No network. */
export async function decodeFile(file: Blob): Promise<PCM> {
  const ab = await file.arrayBuffer();
  const head = new Uint8Array(ab, 0, Math.min(4, ab.byteLength));
  if (String.fromCharCode(...head) === 'RIFF') { try { return decodeWav(ab); } catch { /* compressed WAV: use browser decoder */ } }
  try {
    const Ctx: typeof AudioContext = (window.AudioContext || (window as any).webkitAudioContext);
    const ctx = new Ctx();
    const buf = await ctx.decodeAudioData(ab.slice(0));
    await ctx.close();
    return { sampleRate: buf.sampleRate, channels: Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i).slice()) };
  } catch (e) {
    try { return decodeWav(ab); } catch { throw new Error(`Could not decode audio: ${(e as Error).message}`); }
  }
}
