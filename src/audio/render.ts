import type { PCM } from './pcm';
import { pcmLength, resamplePCM, toStereo } from './pcm';
import type { MasterSettings, Track } from '../store/project';
import { deEss, limit } from './fx';

export const dbToGain = (d: number) => Math.pow(10, d / 20);

/** Mid/side stereo width (0 = mono, 1 = unchanged, 2 = wide). */
export function stereoWidth(p: PCM, width: number): PCM {
  if (width === 1 || p.channels.length < 2) return p;
  const [L, R] = p.channels, n = L.length, a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const m = (L[i] + R[i]) / 2, s = ((L[i] - R[i]) / 2) * width; a[i] = m + s; b[i] = m - s; }
  return { sampleRate: p.sampleRate, channels: [a, b] };
}

function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.round(seconds * ctx.sampleRate), b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c); let seed = 1234 + c * 999;
    for (let i = 0; i < len; i++) { seed = (seed * 16807) % 2147483647; d[i] = ((seed / 2147483647) * 2 - 1) * Math.pow(1 - i / len, 3); }
  }
  return b;
}

const toAudioBuffer = (ctx: BaseAudioContext, p: PCM) => {
  const b = ctx.createBuffer(p.channels.length, pcmLength(p), p.sampleRate);
  p.channels.forEach((c, i) => b.copyToChannel(c, i));
  return b;
};

/** Non-destructive offline mixdown of all tracks through Web Audio nodes + JS limiter. */
export async function renderMix(tracks: Track[], pcms: Map<string, PCM>, master: MasterSettings, opts: { sampleRate?: number; start?: number; end?: number; bypassMaster?: boolean } = {}): Promise<PCM> {
  const sr = opts.sampleRate ?? 44100;
  const anySolo = tracks.some((t) => t.solo);
  const live = tracks.filter((t) => !t.mute && (!anySolo || t.solo) && pcms.has(t.assetId));
  const start = opts.start ?? 0;
  const end = opts.end ?? Math.max(1, ...live.map((t) => t.offset + pcmLength(pcms.get(t.assetId)!) / pcms.get(t.assetId)!.sampleRate));
  const len = Math.max(1, Math.round((end - start) * sr));
  const ctx = new OfflineAudioContext(2, len, sr);

  const masterIn = ctx.createGain();
  const reverb = ctx.createConvolver(); reverb.buffer = impulse(ctx, master.reverbDecay);
  const revBus = ctx.createGain(); revBus.connect(reverb); reverb.connect(masterIn);

  for (const t of live) {
    let p = pcms.get(t.assetId)!;
    if (p.sampleRate !== sr) p = resamplePCM(p, sr);
    p = toStereo(p);
    if (t.deEss > 0) p = { sampleRate: sr, channels: p.channels.map((c) => deEss(c, sr, -30, t.deEss)) };
    p = stereoWidth(p, t.width);
    const src = ctx.createBufferSource(); src.buffer = toAudioBuffer(ctx, p);
    const g = ctx.createGain(); g.gain.value = dbToGain(t.gainDb);
    for (const a of t.automation) { const at = a.t - start; if (at >= 0) g.gain.linearRampToValueAtTime(dbToGain(t.gainDb + a.gainDb), at); }
    const lo = ctx.createBiquadFilter(); lo.type = 'lowshelf'; lo.frequency.value = 200; lo.gain.value = t.eq.low;
    const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = t.eq.midFreq; mid.Q.value = 1; mid.gain.value = t.eq.mid;
    const hi = ctx.createBiquadFilter(); hi.type = 'highshelf'; hi.frequency.value = 6000; hi.gain.value = t.eq.high;
    src.connect(g).connect(lo).connect(mid).connect(hi);
    let node: AudioNode = hi;
    if (t.comp.on) { const c = ctx.createDynamicsCompressor(); c.threshold.value = t.comp.thresholdDb; c.ratio.value = t.comp.ratio; c.attack.value = 0.005; c.release.value = 0.15; node.connect(c); node = c; }
    const pan = ctx.createStereoPanner(); pan.pan.value = t.pan; node.connect(pan);
    pan.connect(masterIn);
    if (t.reverb > 0) { const s = ctx.createGain(); s.gain.value = t.reverb; pan.connect(s).connect(revBus); }
    if (t.delay.mix > 0) {
      const d = ctx.createDelay(2); d.delayTime.value = t.delay.timeMs / 1000;
      const fb = ctx.createGain(); fb.gain.value = Math.min(0.9, t.delay.feedback);
      const wet = ctx.createGain(); wet.gain.value = t.delay.mix;
      pan.connect(d); d.connect(fb).connect(d); d.connect(wet).connect(masterIn);
    }
    const when = t.offset - start;
    if (when >= 0) src.start(when); else src.start(0, -when);
  }

  let out: AudioNode = masterIn;
  if (!opts.bypassMaster) {
    const lo = ctx.createBiquadFilter(); lo.type = 'lowshelf'; lo.frequency.value = 120; lo.gain.value = master.eq.low;
    const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1500; mid.Q.value = 0.7; mid.gain.value = master.eq.mid;
    const hi = ctx.createBiquadFilter(); hi.type = 'highshelf'; hi.frequency.value = 8000; hi.gain.value = master.eq.high;
    out.connect(lo).connect(mid).connect(hi); out = hi;
    if (master.comp.on) {
      const c = ctx.createDynamicsCompressor(); c.threshold.value = master.comp.thresholdDb; c.ratio.value = master.comp.ratio;
      c.attack.value = master.comp.attackMs / 1000; c.release.value = master.comp.releaseMs / 1000; c.knee.value = 6; out.connect(c); out = c;
    }
    const mg = ctx.createGain(); mg.gain.value = dbToGain(master.gainDb); out.connect(mg); out = mg;
  }
  out.connect(ctx.destination);
  const buf = await ctx.startRendering();
  let res: PCM = { sampleRate: sr, channels: [buf.getChannelData(0).slice(), buf.getChannelData(1).slice()] };
  if (!opts.bypassMaster) {
    res = stereoWidth(res, master.width);
    if (master.limiter.on) res = { sampleRate: sr, channels: limit(res.channels, sr, master.limiter.ceilingDb) };
  }
  return res;
}

export function pcmToAudioBuffer(ctx: BaseAudioContext, p: PCM) { return toAudioBuffer(ctx, p); }
