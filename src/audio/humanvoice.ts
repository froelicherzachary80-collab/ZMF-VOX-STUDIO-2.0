import type { PCM } from './pcm';
import { compress, declick, deEss, filt, gate, saturate } from './fx';

/** HUMANVOICE ENGINE — post-production DSP only (no neural synthesis happens here). */
export interface HumanVoiceSettings {
  naturalDynamics: number;   // 0..1 compression depth (gentle)
  breathPreservation: number;// 0..1: 1 = gate disabled, keeps breaths
  warmth: number;            // dB low-shelf @ 250 Hz
  brightness: number;        // dB high-shelf @ 6 kHz
  air: number;               // dB high-shelf @ 12 kHz
  presence: number;          // dB peak @ 3 kHz
  sibilance: number;         // 0..1 de-ess amount
  saturation: number;        // 0..1 drive
  declick: boolean;
  noiseGateDb: number;       // -90 = off
  lowCutHz: number;
}

export const HV_DEFAULT: HumanVoiceSettings = { naturalDynamics: 0.4, breathPreservation: 0.8, warmth: 1, brightness: 1, air: 1, presence: 0.5, sibilance: 0.4, saturation: 0.1, declick: true, noiseGateDb: -70, lowCutHz: 80 };

export const HV_PRESETS: Record<string, HumanVoiceSettings> = {
  'Natural Studio': HV_DEFAULT,
  'Soft Pop': { ...HV_DEFAULT, naturalDynamics: 0.5, brightness: 2, air: 2.5, sibilance: 0.5, saturation: 0.08 },
  'Emotional Ballad': { ...HV_DEFAULT, naturalDynamics: 0.3, warmth: 2, breathPreservation: 1, air: 2, saturation: 0.05 },
  'Powerful Pop': { ...HV_DEFAULT, naturalDynamics: 0.75, presence: 2.5, brightness: 2, saturation: 0.25, sibilance: 0.6 },
  'Intimate Acoustic': { ...HV_DEFAULT, naturalDynamics: 0.35, warmth: 2.5, brightness: 0, breathPreservation: 1, saturation: 0.05 },
  Indie: { ...HV_DEFAULT, naturalDynamics: 0.5, warmth: 1.5, brightness: -0.5, saturation: 0.3 },
  'R&B': { ...HV_DEFAULT, naturalDynamics: 0.6, warmth: 2, air: 3, sibilance: 0.55, saturation: 0.12 },
  Cinematic: { ...HV_DEFAULT, naturalDynamics: 0.45, warmth: 1.5, air: 2, presence: 1, saturation: 0.1 },
  'Clean Vocal': { ...HV_DEFAULT, naturalDynamics: 0.3, warmth: 0, brightness: 0.5, air: 0.5, saturation: 0, noiseGateDb: -60 },
};

export function humanVoiceChannel(x: Float32Array, sr: number, s: HumanVoiceSettings): Float32Array {
  let y = x;
  if (s.declick) y = declick(y).out;
  if (s.lowCutHz > 20) y = filt(y, sr, 'highpass', s.lowCutHz, 0.707);
  if (s.noiseGateDb > -89) y = gate(y, sr, s.noiseGateDb, 6 + 24 * (1 - s.breathPreservation));
  if (s.warmth) y = filt(y, sr, 'lowshelf', 250, 0.707, s.warmth);
  if (s.presence) y = filt(y, sr, 'peaking', 3000, 1, s.presence);
  if (s.brightness) y = filt(y, sr, 'highshelf', 6000, 0.707, s.brightness);
  if (s.air) y = filt(y, sr, 'highshelf', 12000, 0.707, s.air);
  if (s.sibilance > 0) y = deEss(y, sr, -30, s.sibilance);
  if (s.naturalDynamics > 0) y = compress(y, sr, { thresholdDb: -18 - 10 * s.naturalDynamics, ratio: 1.5 + 3 * s.naturalDynamics, attackMs: 8, releaseMs: 120, makeupDb: 4 * s.naturalDynamics });
  if (s.saturation > 0) y = saturate(y, s.saturation, Math.min(1, s.saturation * 1.5));
  return y;
}

export function humanVoice(p: PCM, s: HumanVoiceSettings): PCM {
  return { sampleRate: p.sampleRate, channels: p.channels.map((c) => humanVoiceChannel(c, p.sampleRate, s)) };
}
