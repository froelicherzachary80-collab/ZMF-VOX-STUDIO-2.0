import type { PCM } from '../audio/pcm';
import { pcmLength, resample, slicePCM, toMono } from '../audio/pcm';
import { yin } from '../audio/pitch';
import { fft, hann } from '../audio/fft';
import { humanVoice, type HumanVoiceSettings } from '../audio/humanvoice';
import { RvcEngine, type RvcParams } from './rvc';
import { loadModelBytes, listModels } from '../store/models';
import type { Singer } from '../store/singers';
import { loadBank } from './bank';
import { voiceMatch } from '../audio/mfcc';

export interface CoverSettings extends Omit<RvcParams, 'backend'> {
  voiceBlend: number;            // 0..1 wet amount of converted voice vs original vocal
  consonantProtection: number;   // 0..1 original vocal blended back in unvoiced frames
  expressionPreservation: number;// 0..1 match original loudness envelope
  humanVoice: HumanVoiceSettings;
  previewSeconds: number | null; // null = whole song
  previewStart: number;
}

export interface CoverResult { dry: PCM; processed: PCM; source: PCM; backend: string; seconds: number; measured: { spectralDiff: number; pitchCorrelation: number }; match?: { sourceToTarget: number; convertedToTarget: number }; features: { f0: string; index: string; speakerId: number } }

let cached: { key: string; engine: RvcEngine } | null = null;

export async function getEngine(singer: Singer, backend: 'webgpu' | 'wasm'): Promise<RvcEngine> {
  if (singer.capability !== 'neural-rvc' || !singer.voiceModelId || !singer.contentModelId)
    throw new Error(`"${singer.name}" is an analysis-only profile. Neural conversion needs an imported RVC ONNX voice model + content encoder (Model Manager).`);
  const key = `${singer.voiceModelId}|${singer.contentModelId}|${singer.rmvpeModelId ?? ''}|${singer.featureBankId ?? ''}|${singer.speakerId ?? 0}|${backend}`;
  if (cached?.key === key) return cached.engine;
  if (cached) { await cached.engine.release(); cached = null; } // keep only one model set in memory
  const models = await listModels();
  const vm = models.find((m) => m.id === singer.voiceModelId), cm = models.find((m) => m.id === singer.contentModelId);
  if (!vm || !cm) throw new Error('Linked model files are missing from local storage.');
  const rm = singer.rmvpeModelId ? models.find((m) => m.id === singer.rmvpeModelId) : undefined;
  const bank = singer.featureBankId ? await loadBank(singer.featureBankId) : undefined;
  const engine = new RvcEngine({
    voiceModel: await loadModelBytes(vm), contentModel: await loadModelBytes(cm), modelSampleRate: singer.modelSampleRate ?? vm.sampleRate ?? 40000,
    speakerId: singer.speakerId ?? 0, rmvpeModel: rm ? await loadModelBytes(rm) : undefined, bank,
  });
  await engine.load(backend);
  cached = { key, engine };
  return engine;
}

export async function releaseEngine() { if (cached) { await cached.engine.release(); cached = null; } }

function envelope(x: Float32Array, win: number): Float32Array {
  const n = Math.ceil(x.length / win), e = new Float32Array(n);
  for (let k = 0; k < n; k++) { let s = 0; const a = k * win, b = Math.min(x.length, a + win); for (let i = a; i < b; i++) s += x[i] * x[i]; e[k] = Math.sqrt(s / Math.max(1, b - a)); }
  return e;
}

/** Latency alignment: cross-correlate 10 ms energy envelopes within ±200 ms. */
export function alignOffset(ref: Float32Array, y: Float32Array, sr: number): number {
  const win = Math.round(sr / 100), a = envelope(ref, win), b = envelope(y, win);
  let best = 0, bestLag = 0;
  for (let lag = -20; lag <= 20; lag++) {
    let s = 0; for (let i = 0; i < a.length; i++) { const j = i + lag; if (j >= 0 && j < b.length) s += a[i] * b[j]; }
    if (s > best) { best = s; bestLag = lag; }
  }
  return bestLag * win;
}

export async function runCover(vocal: PCM, singer: Singer, s: CoverSettings, backend: 'webgpu' | 'wasm', onStage: (stage: string, f: number) => void, signal?: AbortSignal): Promise<CoverResult> {
  const t0 = performance.now();
  const src = s.previewSeconds ? slicePCM(vocal, s.previewStart, s.previewStart + s.previewSeconds) : vocal;
  const sr = src.sampleRate, mono = toMono(src);
  onStage('Loading voice model', 0);
  const engine = await getEngine(singer, backend);
  onStage(`Model ready (${engine.backendUsed})`, 0.05);
  const y = await engine.convert(mono, sr, { ...s, backend }, (p) => onStage(`${p.stage} ${p.chunk}/${p.chunks}`, 0.05 + 0.8 * p.fraction), signal);
  onStage('Resampling & alignment', 0.86);
  let conv = resample(y, singer.modelSampleRate ?? 40000, sr);
  const off = alignOffset(mono, conv, sr);
  const aligned = new Float32Array(mono.length);
  for (let i = 0; i < aligned.length; i++) { const j = i + off; aligned[i] = j >= 0 && j < conv.length ? conv[j] : 0; }
  conv = aligned;

  onStage('Expression & consonant preservation', 0.9);
  const win = Math.round(sr / 100);
  if (s.expressionPreservation > 0) {
    const eo = envelope(mono, win), ec = envelope(conv, win);
    for (let i = 0; i < conv.length; i++) { const k = Math.floor(i / win); const g = ec[k] > 1e-5 ? Math.min(4, eo[k] / ec[k]) : 1; conv[i] *= 1 + (g - 1) * s.expressionPreservation; }
  }
  const dryOut = new Float32Array(conv);
  if (s.consonantProtection > 0) {
    const tr = yin(mono, sr, { hop: win });
    for (let i = 0; i < conv.length; i++) { const k = Math.min(tr.f0.length - 1, Math.floor(i / win)); if (k >= 0 && tr.f0[k] === 0) conv[i] = conv[i] * (1 - s.consonantProtection) + mono[i] * s.consonantProtection; }
  }
  for (let i = 0; i < conv.length; i++) conv[i] = conv[i] * s.voiceBlend + mono[i] * (1 - s.voiceBlend);
  onStage('HUMANVOICE post-processing', 0.95);
  const processed = humanVoice({ sampleRate: sr, channels: [conv] }, s.humanVoice);

  // Evidence that conversion happened: spectral difference and pitch agreement vs. source
  const measured = measureConversion(mono, dryOut, sr);
  const match = singer.timbreFingerprint ? voiceMatch(mono, dryOut, sr, Float32Array.from(singer.timbreFingerprint)) : undefined;
  const features = {
    f0: s.f0Method === 'rmvpe' && engine.hasRmvpe ? 'RMVPE' : s.f0Method === 'rmvpe' ? 'YIN (RMVPE model not linked)' : 'YIN',
    index: engine.bankInfo && s.indexRate > 0 ? `${engine.bankInfo.count} vectors @ ${Math.round(s.indexRate * 100)}%` : 'off', speakerId: singer.speakerId ?? 0,
  };
  onStage('Done', 1);
  return { match, features, dry: { sampleRate: sr, channels: [dryOut] }, processed, source: { sampleRate: sr, channels: [mono] }, backend: engine.backendUsed, seconds: (performance.now() - t0) / 1000, measured };
}

export function measureConversion(a: Float32Array, b: Float32Array, sr: number) {
  const ta = yin(a, sr, { hop: Math.round(sr / 100) }), tb = yin(b, sr, { hop: Math.round(sr / 100) });
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < Math.min(ta.f0.length, tb.f0.length); i++) if (ta.f0[i] > 0 && tb.f0[i] > 0) { xs.push(Math.log2(ta.f0[i])); ys.push(Math.log2(tb.f0[i])); }
  const mean = (v: number[]) => v.reduce((p, c) => p + c, 0) / Math.max(1, v.length);
  const mx = mean(xs), my = mean(ys); let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return { pitchCorrelation: xs.length > 10 ? num / Math.sqrt(dx * dy || 1) : NaN, spectralDiff: logSpectralDistance(a, b) };
}

/** Mean log-spectral distance (dB) between two signals over 1024-pt Hann frames with energy. */
export function logSpectralDistance(a: Float32Array, b: Float32Array): number {
  const N = 1024, w = hann(N), ra = new Float32Array(N), ia = new Float32Array(N), rb = new Float32Array(N), ib = new Float32Array(N);
  let tot = 0, frames = 0;
  for (let s = 0; s + N <= Math.min(a.length, b.length); s += N * 2) {
    let ea = 0;
    for (let i = 0; i < N; i++) { ra[i] = a[s + i] * w[i]; rb[i] = b[s + i] * w[i]; ia[i] = ib[i] = 0; ea += ra[i] ** 2; }
    if (ea < 1e-4) continue;
    fft(ra, ia); fft(rb, ib);
    let d = 0;
    for (let k = 2; k < N / 2; k++) { const x = 10 * Math.log10(ra[k] ** 2 + ia[k] ** 2 + 1e-10), y = 10 * Math.log10(rb[k] ** 2 + ib[k] ** 2 + 1e-10); d += (x - y) ** 2; }
    tot += Math.sqrt(d / (N / 2 - 2)); frames++;
  }
  return frames ? tot / frames : NaN;
}

export const pcmSeconds = (p: PCM) => pcmLength(p) / p.sampleRate;
