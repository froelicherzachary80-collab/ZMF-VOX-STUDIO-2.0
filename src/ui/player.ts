import type { PCM } from '../audio/pcm';
import { pcmToAudioBuffer } from '../audio/render';

type Listener = (s: PlayerState) => void;
export interface PlayerState { label: string | null; playing: boolean; position: number; duration: number; levelL: number; levelR: number; }

/** Single shared playback engine (AudioBufferSource + stereo analysers for live meters). */
class Player {
  private ctx?: AudioContext; private src?: AudioBufferSourceNode; private aL?: AnalyserNode; private aR?: AnalyserNode;
  private startedAt = 0; private offset = 0; private raf = 0; private listeners = new Set<Listener>();
  state: PlayerState = { label: null, playing: false, position: 0, duration: 0, levelL: 0, levelR: 0 };
  private emit() { for (const l of this.listeners) l({ ...this.state }); }
  subscribe(l: Listener) { this.listeners.add(l); l({ ...this.state }); return () => { this.listeners.delete(l); }; }
  context() { if (!this.ctx) { const C = window.AudioContext || (window as any).webkitAudioContext; this.ctx = new C(); } return this.ctx; }

  async play(p: PCM, label: string, from = 0) {
    this.stop();
    const ctx = this.context(); await ctx.resume();
    const buf = pcmToAudioBuffer(ctx, p);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const split = ctx.createChannelSplitter(2);
    this.aL = ctx.createAnalyser(); this.aR = ctx.createAnalyser(); this.aL.fftSize = this.aR.fftSize = 1024;
    src.connect(ctx.destination); src.connect(split); split.connect(this.aL, 0); split.connect(this.aR, buf.numberOfChannels > 1 ? 1 : 0);
    src.onended = () => { if (this.src === src) { this.state.playing = false; cancelAnimationFrame(this.raf); this.emit(); } };
    src.start(0, from); this.src = src; this.startedAt = ctx.currentTime; this.offset = from;
    this.state = { label, playing: true, position: from, duration: buf.duration, levelL: 0, levelR: 0 };
    const tmp = new Float32Array(1024);
    const tick = () => {
      if (!this.state.playing) return;
      const peak = (a: AnalyserNode) => { a.getFloatTimeDomainData(tmp); let m = 0; for (const v of tmp) m = Math.max(m, Math.abs(v)); return m; };
      this.state.position = this.offset + ctx.currentTime - this.startedAt;
      this.state.levelL = peak(this.aL!); this.state.levelR = peak(this.aR!);
      this.emit(); this.raf = requestAnimationFrame(tick);
    };
    tick();
  }
  stop() { try { this.src?.stop(); } catch { /* */ } this.src = undefined; this.state.playing = false; cancelAnimationFrame(this.raf); this.emit(); }
}
export const player = new Player();
