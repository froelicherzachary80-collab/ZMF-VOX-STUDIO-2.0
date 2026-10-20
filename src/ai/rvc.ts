/**
 * RVC (Retrieval-based Voice Conversion) ONNX inference adapter.
 *
 * Pipeline (matches RVC's official `onnx_inference.py` export contract):
 *   vocal PCM -> 16 kHz mono -> content encoder (ContentVec/HuBERT ONNX, 50 fps)
 *   -> frame-repeat x2 to 100 fps -> F0 (YIN, hop 160 @16k = 100 fps) + coarse mel bins
 *   -> RVC generator ONNX (phone, phone_lengths, pitch, pitchf, ds, rnd) -> waveform @ model SR
 *   -> overlap-add crossfade between chunks.
 *
 * Model weights are NOT bundled. The user imports models they are permitted to use.
 */
import type * as ORT from 'onnxruntime-web';
import { yin, smoothF0 } from '../audio/pitch';
import { resample } from '../audio/pcm';
import { coarsePitch, overlapAdd, shapeF0 } from './rvcMath';
import { protectBlend, retrieveBlend, type FeatureBank } from './featureIndex';
import { decodeSalience, rmvpeMel } from './rmvpeMath';

export interface RvcModelSpec {
  contentModel: ArrayBuffer;   // ContentVec / HuBERT ONNX (input [1,1,N] @16 kHz)
  voiceModel: ArrayBuffer;     // RVC v1/v2 generator ONNX
  modelSampleRate: number;     // 32000 | 40000 | 48000 (from training config)
  speakerId?: number;
  rmvpeModel?: ArrayBuffer;    // optional RMVPE ONNX (mel [1,128,T] -> salience [1,T,360])
  bank?: FeatureBank;          // target-singer feature index
}

export interface RvcParams {
  transpose: number;           // semitones
  f0Min: number; f0Max: number;
  octaveCorrection: boolean;
  pitchCorrection: number; vibrato: number; stability: number;
  indexRate: number;           // 0..1 retrieval blend (needs a feature bank)
  protect: number;             // 0..0.5 RVC protect for unvoiced frames (0.5 = off)
  f0Method: 'yin' | 'rmvpe';
  chunkSeconds: number;
  crossfadeSeconds: number;
  backend: 'webgpu' | 'wasm';
}

export interface RvcProgress { stage: string; chunk: number; chunks: number; fraction: number; }

let ortPromise: Promise<typeof ORT> | null = null;
export async function loadOrt(): Promise<typeof ORT> {
  if (!ortPromise) ortPromise = import('onnxruntime-web/webgpu').then((m: any) => {
    const ort = (m.default ?? m) as typeof ORT;
    // Single-threaded fallback unless the page is cross-origin isolated (COOP/COEP).
    ort.env.wasm.numThreads = (globalThis as any).crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    ort.env.wasm.wasmPaths = new URL('./ort/', document.baseURI).href;
    return ort;
  });
  return ortPromise;
}

export class RvcEngine {
  private content?: ORT.InferenceSession;
  private voice?: ORT.InferenceSession;
  private rmvpe?: ORT.InferenceSession;
  backendUsed: string = 'none';
  constructor(private spec: RvcModelSpec) {}

  async load(backend: 'webgpu' | 'wasm'): Promise<string> {
    const ort = await loadOrt();
    const tryEp = async (eps: string[]) => {
      this.content = await ort.InferenceSession.create(new Uint8Array(this.spec.contentModel), { executionProviders: eps });
      this.voice = await ort.InferenceSession.create(new Uint8Array(this.spec.voiceModel), { executionProviders: eps });
      if (this.spec.rmvpeModel) this.rmvpe = await ort.InferenceSession.create(new Uint8Array(this.spec.rmvpeModel), { executionProviders: eps });
      return eps[0];
    };
    if (backend === 'webgpu' && 'gpu' in navigator) {
      try { this.backendUsed = await tryEp(['webgpu']); return this.backendUsed; }
      catch (e) { console.warn('WebGPU session failed, falling back to WASM', e); }
    }
    this.backendUsed = await tryEp(['wasm']);
    return this.backendUsed;
  }

  describe() {
    return {
      contentInputs: this.content?.inputNames, contentOutputs: this.content?.outputNames,
      voiceInputs: this.voice?.inputNames, voiceOutputs: this.voice?.outputNames,
    };
  }

  async release() { await this.content?.release(); await this.voice?.release(); await this.rmvpe?.release(); this.content = this.voice = this.rmvpe = undefined; }

  get hasRmvpe() { return !!this.rmvpe; }
  get bankInfo() { return this.spec.bank ? { count: this.spec.bank.count, dim: this.spec.bank.dim } : null; }

  /** Content features for arbitrary 16 kHz audio (used to build a singer's feature bank). */
  async extractFeatures(x16: Float32Array): Promise<{ data: Float32Array; frames: number; dim: number }> {
    return this.contentFeatures(await loadOrt(), x16);
  }

  private async rmvpeF0(ort: typeof ORT, x16: Float32Array): Promise<Float32Array> {
    const s = this.rmvpe!, { mel, frames, padded } = rmvpeMel(x16);
    const r = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', mel, [1, 128, padded]) });
    return decodeSalience(r[s.outputNames[0]].data as Float32Array, frames);
  }

  private async contentFeatures(ort: typeof ORT, x16: Float32Array): Promise<{ data: Float32Array; frames: number; dim: number }> {
    const s = this.content!;
    const feeds: Record<string, ORT.Tensor> = { [s.inputNames[0]]: new ort.Tensor('float32', x16, [1, 1, x16.length]) };
    const r = await s.run(feeds);
    const t = r[s.outputNames[0]];
    const dims = t.dims as number[];
    const data = t.data as Float32Array;
    const frames = dims[1], dim = dims[2];
    return { data, frames, dim };
  }

  /** Convert one chunk; returns audio at model sample rate. */
  async convertChunk(x16: Float32Array, p: RvcParams): Promise<Float32Array> {
    const ort = await loadOrt();
    const feat = await this.contentFeatures(ort, x16);
    const T = feat.frames * 2; // RVC repeats 50 fps features to 100 fps
    const orig = feat.data;
    const used = this.spec.bank && p.indexRate > 0 ? retrieveBlend(orig.slice(), feat.frames, this.spec.bank, p.indexRate) : orig;
    const up = (src: Float32Array) => { const o = new Float32Array(T * feat.dim); for (let t = 0; t < T; t++) o.set(src.subarray((t >> 1) * feat.dim, ((t >> 1) + 1) * feat.dim), t * feat.dim); return o; };
    let phone = up(used);

    const raw = p.f0Method === 'rmvpe' && this.rmvpe ? await this.rmvpeF0(ort, x16) : yin(x16, 16000, { hop: 160, fmin: p.f0Min, fmax: p.f0Max }).f0;
    const f0 = shapeF0(smoothF0(raw), { correction: p.pitchCorrection, vibrato: p.vibrato, stability: p.stability });
    const pitchf = new Float32Array(T);
    const k = Math.pow(2, p.transpose / 12);
    for (let i = 0; i < T; i++) {
      let v = (f0[Math.min(f0.length - 1, i)] ?? 0) * k;
      if (p.octaveCorrection && v > 0) { while (v > p.f0Max) v /= 2; while (v < p.f0Min) v *= 2; }
      pitchf[i] = v;
    }
    if (used !== orig) phone = protectBlend(phone, up(orig), pitchf, feat.dim, p.protect);
    const pitch = coarsePitch(pitchf);
    const rnd = new Float32Array(192 * T);
    for (let i = 0; i < rnd.length; i += 2) { // Box–Muller
      const u = Math.random() || 1e-9, v = Math.random();
      const r = Math.sqrt(-2 * Math.log(u)); rnd[i] = r * Math.cos(2 * Math.PI * v); if (i + 1 < rnd.length) rnd[i + 1] = r * Math.sin(2 * Math.PI * v);
    }
    const s = this.voice!;
    const names = s.inputNames;
    const pick = (cands: string[], idx: number) => names.find((n) => cands.includes(n)) ?? names[idx];
    const feeds: Record<string, ORT.Tensor> = {
      [pick(['phone', 'feats', 'hubert'], 0)]: new ort.Tensor('float32', phone, [1, T, feat.dim]),
      [pick(['phone_lengths', 'p_len', 'hubert_length'], 1)]: new ort.Tensor('int64', BigInt64Array.from([BigInt(T)]), [1]),
      [pick(['pitch'], 2)]: new ort.Tensor('int64', pitch, [1, T]),
      [pick(['pitchf', 'nsff0'], 3)]: new ort.Tensor('float32', pitchf, [1, T]),
      [pick(['ds', 'sid'], 4)]: new ort.Tensor('int64', BigInt64Array.from([BigInt(this.spec.speakerId ?? 0)]), [1]),
      [pick(['rnd'], 5)]: new ort.Tensor('float32', rnd, [1, 192, T]),
    };
    const out = await s.run(feeds);
    const audio = out[s.outputNames[0]].data as Float32Array;
    return Float32Array.from(audio);
  }

  /** Chunked conversion with overlap-add. Input mono at `sr`; output mono at model SR. */
  async convert(mono: Float32Array, sr: number, p: RvcParams, onProgress?: (pr: RvcProgress) => void, signal?: AbortSignal): Promise<Float32Array> {
    const x16 = resample(mono, sr, 16000);
    const chunk = Math.round(p.chunkSeconds * 16000), fade16 = Math.round(p.crossfadeSeconds * 16000);
    const hop = chunk - fade16;
    const outs: Float32Array[] = [], hops: number[] = [];
    const ratio = this.spec.modelSampleRate / 16000;
    const chunks = Math.max(1, Math.ceil((x16.length - fade16) / hop));
    for (let c = 0; c < chunks; c++) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      onProgress?.({ stage: 'Neural conversion', chunk: c + 1, chunks, fraction: c / chunks });
      const seg = x16.slice(c * hop, Math.min(x16.length, c * hop + chunk));
      const padded = new Float32Array(Math.max(seg.length, 16000 * 0.5)); padded.set(seg);
      let y = await this.convertChunk(padded, p);
      y = y.subarray(0, Math.round(seg.length * ratio));
      outs.push(y); hops.push(Math.round(hop * ratio));
      await new Promise((r) => setTimeout(r));
    }
    onProgress?.({ stage: 'Overlap-add', chunk: chunks, chunks, fraction: 1 });
    return overlapAdd(outs, hops, Math.round(fade16 * ratio));
  }
}
