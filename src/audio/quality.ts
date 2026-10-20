import type { PCM } from './pcm';
import { toMono } from './pcm';
import { yin } from './pitch';

export interface QualityReport {
  seconds: number; clippingPct: number; peakDb: number; noiseFloorDb: number; snrDb: number; dcOffset: number; voicedPct: number;
  verdicts: { level: 'ok' | 'warn' | 'bad'; text: string }[];
}

/** Measurable recording-quality checks for voice reference / training material. */
export function checkQuality(p: PCM): QualityReport {
  const x = toMono(p), sr = p.sampleRate, n = x.length;
  let clip = 0, peak = 0, dc = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(x[i]); if (a >= 0.99) clip++; if (a > peak) peak = a; dc += x[i]; }
  const win = Math.round(sr * 0.03), rms: number[] = [];
  for (let s = 0; s + win <= n; s += win) { let e = 0; for (let i = s; i < s + win; i++) e += x[i] * x[i]; rms.push(10 * Math.log10(e / win + 1e-12)); }
  rms.sort((a, b) => a - b);
  const q = (f: number) => rms[Math.floor(f * (rms.length - 1))] ?? -120;
  const floor = q(0.1), loud = q(0.9);
  const tr = yin(x, sr, { hop: Math.round(sr / 50) }); let v = 0; for (const f of tr.f0) if (f > 0) v++;
  const r: QualityReport = { seconds: n / sr, clippingPct: (100 * clip) / Math.max(1, n), peakDb: 20 * Math.log10(peak || 1e-9), noiseFloorDb: floor, snrDb: loud - floor, dcOffset: dc / Math.max(1, n), voicedPct: (100 * v) / Math.max(1, tr.f0.length), verdicts: [] };
  const add = (level: 'ok' | 'warn' | 'bad', text: string) => r.verdicts.push({ level, text });
  if (r.clippingPct > 0.1) add('bad', `Clipping on ${r.clippingPct.toFixed(2)}% of samples — re-record with lower input gain.`);
  else if (r.peakDb > -0.5) add('warn', 'Peaks touch 0 dBFS; leave some headroom.'); else add('ok', 'No clipping.');
  if (r.peakDb < -24) add('warn', 'Very quiet recording; move closer to the mic.');
  if (r.snrDb < 20) add('bad', `Low dynamic range / noisy room (≈${r.snrDb.toFixed(0)} dB between loud and quiet passages).`);
  else if (r.snrDb < 35) add('warn', `Moderate background noise (≈${r.snrDb.toFixed(0)} dB SNR estimate).`); else add('ok', `Clean background (≈${r.snrDb.toFixed(0)} dB SNR estimate).`);
  if (r.noiseFloorDb > -45) add('warn', `Noise floor ${r.noiseFloorDb.toFixed(0)} dBFS — try a quieter room.`);
  if (Math.abs(r.dcOffset) > 0.01) add('warn', 'DC offset detected (high-pass filter recommended).');
  if (r.voicedPct < 30) add('warn', `Only ${r.voicedPct.toFixed(0)}% of frames are sung/voiced; add more singing.`);
  return r;
}

export function materialAdvice(totalSeconds: number) {
  return [
    { use: 'Voice analysis profile', need: 30, ok: totalSeconds >= 30 },
    { use: 'Feature index for an existing RVC model', need: 60, ok: totalSeconds >= 60 },
    { use: 'Training a new RVC model (on a PC/Colab)', need: 600, ok: totalSeconds >= 600 },
  ];
}
