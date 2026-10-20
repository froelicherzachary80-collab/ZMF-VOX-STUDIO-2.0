import { describe, expect, it } from 'vitest';
import { encodeWav, decodeWav } from '../src/audio/wav';
import { yin, segmentNotes, hzToMidi } from '../src/audio/pitch';
import { pitchShift } from '../src/audio/pitchshift';
import { centerSeparate } from '../src/audio/separation';
import { estimateBpm, estimateKey, chromagram, rmsOf, peakOf } from '../src/audio/analysis';
import { integratedLufs, truePeak } from '../src/audio/loudness';
import { limit, compress, saturate } from '../src/audio/fx';
import { resample } from '../src/audio/pcm';
import { coarsePitch, overlapAdd } from '../src/ai/rvcMath';
import { humanVoiceChannel, HV_PRESETS } from '../src/audio/humanvoice';

const sr = 44100;
const sine = (f: number, sec: number, a = 0.5, rate = sr) => Float32Array.from({ length: Math.round(sec * rate) }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / rate));
const median = (a: Float32Array) => { const v = [...a].filter((x) => x > 0).sort((x, y) => x - y); return v[v.length >> 1]; };

describe('WAV', () => {
  it('round-trips 16-bit and float', async () => {
    const x = sine(440, 0.2);
    for (const bits of [16, 32] as const) {
      const b = encodeWav({ sampleRate: sr, channels: [x, x] }, bits);
      const p = decodeWav(await b.arrayBuffer());
      expect(p.sampleRate).toBe(sr); expect(p.channels.length).toBe(2);
      expect(Math.abs(p.channels[1][1000] - x[1000])).toBeLessThan(1e-4);
    }
  });
});

describe('MP3', () => {
  it('encodes real MPEG frames', async () => {
    const { encodeMp3 } = await import('../src/audio/mp3');
    const b = await encodeMp3({ sampleRate: sr, channels: [sine(440, 1), sine(440, 1)] }, 128);
    const u = new Uint8Array(await b.arrayBuffer());
    expect(u.length).toBeGreaterThan(10000);
    const i = u.findIndex((v, k) => v === 0xff && (u[k + 1] & 0xe0) === 0xe0);
    expect(i).toBeGreaterThanOrEqual(0); // frame sync found
  });
});

describe('Pitch', () => {
  it('YIN tracks 220 Hz', () => {
    expect(median(yin(sine(220, 0.5), sr).f0)).toBeCloseTo(220, 0);
  });
  it('segments a two-note phrase', () => {
    const x = new Float32Array([...sine(261.63, 0.4), ...sine(392, 0.4)]);
    const n = segmentNotes(yin(x, sr));
    expect(n.length).toBeGreaterThanOrEqual(2);
    expect(n[0].midi).toBe(60); expect(n.at(-1)!.midi).toBe(67);
  });
  it('pitch shift +12 doubles f0, -7 lowers a fifth', () => {
    expect(median(yin(pitchShift(sine(220, 1), sr, 12), sr).f0)).toBeGreaterThan(430);
    const f = median(yin(pitchShift(sine(440, 1), sr, -7), sr).f0);
    expect(hzToMidi(f)).toBeCloseTo(hzToMidi(440) - 7, 0);
  });
});

describe('Separation (DSP)', () => {
  it('center content goes to vocal stem, side content to instrumental', async () => {
    const c = sine(440, 1, 0.3), side = sine(1500, 1, 0.3);
    const L = c.map((v, i) => v + side[i]), R = c.map((v, i) => v - side[i]);
    const { vocal, instrumental } = await centerSeparate({ sampleRate: sr, channels: [L, R] });
    const corr = (a: Float32Array, b: Float32Array) => { let s = 0, ea = 0, eb = 0; for (let i = 4096; i < a.length - 4096; i++) { s += a[i] * b[i]; ea += a[i] ** 2; eb += b[i] ** 2; } return s / Math.sqrt(ea * eb); };
    expect(corr(vocal.channels[0], c)).toBeGreaterThan(0.9);
    expect(corr(instrumental.channels[0], side)).toBeGreaterThan(0.9);
  });
});

describe('Analysis', () => {
  it('estimates 120 BPM click track', () => {
    const x = new Float32Array(sr * 20);
    for (let b = 0; b < 40; b++) for (let i = 0; i < 400; i++) x[Math.round(b * 0.5 * sr) + i] = Math.sin(i * 0.3) * Math.exp(-i / 80);
    const r = estimateBpm(x, sr);
    expect(r.bpm).not.toBeNull(); expect(Math.abs(r.bpm! - 120)).toBeLessThan(3);
  });
  it('estimates C major from a C-major chord progression', () => {
    const chord = (fs: number[]) => { const o = new Float32Array(sr); for (const f of fs) { const s = sine(f, 1, 0.2); for (let i = 0; i < o.length; i++) o[i] += s[i]; } return o; };
    const x = new Float32Array([...chord([261.63, 329.63, 392]), ...chord([349.23, 440, 523.25]), ...chord([392, 493.88, 587.33]), ...chord([261.63, 329.63, 392])]);
    expect(estimateKey(chromagram(x, sr)).key).toBe('C major');
  });
  it('LUFS of a -20 dBFS 1 kHz stereo sine is about -20', () => {
    const x = sine(1000, 3, 0.1);
    expect(integratedLufs({ sampleRate: 48000, channels: [resample(x, sr, 48000), resample(x, sr, 48000)] })).toBeGreaterThan(-21.5);
    expect(integratedLufs({ sampleRate: 48000, channels: [resample(x, sr, 48000), resample(x, sr, 48000)] })).toBeLessThan(-19);
  });
  it('true peak >= sample peak', () => {
    const x = sine(11025, 0.1, 0.9);
    const p = { sampleRate: sr, channels: [x] };
    expect(truePeak(p)).toBeGreaterThanOrEqual(peakOf(p));
  });
});

describe('FX', () => {
  it('limiter respects ceiling', () => {
    const [y] = limit([sine(100, 1, 1.5)], sr, -1);
    expect(peakOf({ sampleRate: sr, channels: [y] })).toBeLessThanOrEqual(Math.pow(10, -1 / 20) + 1e-6);
  });
  it('compressor reduces loud signal, saturation changes waveform', () => {
    const x = sine(200, 1, 0.9);
    expect(rmsOf(compress(x, sr, { thresholdDb: -20, ratio: 4, attackMs: 5, releaseMs: 50 }))).toBeLessThan(rmsOf(x) * 0.7);
    expect(Math.abs(saturate(x, 0.8, 1)[100] - x[100])).toBeGreaterThan(1e-3);
  });
  it('every HUMANVOICE preset produces finite audio that differs from input', () => {
    const x = sine(300, 0.5, 0.3);
    for (const [, s] of Object.entries(HV_PRESETS)) {
      const y = humanVoiceChannel(x, sr, s);
      expect(y.every(Number.isFinite)).toBe(true);
      expect(y.some((v, i) => Math.abs(v - x[i]) > 1e-3)).toBe(true);
    }
  });
});

describe('RVC adapter helpers', () => {
  it('coarse pitch matches RVC mel binning', () => {
    const c = coarsePitch(Float32Array.from([0, 50, 1100, 220]));
    expect(c[0]).toBe(1n); expect(c[1]).toBe(1n); expect(c[2]).toBe(255n);
    expect(Number(c[3])).toBeGreaterThan(1); expect(Number(c[3])).toBeLessThan(255);
  });
  it('overlap-add keeps unity gain across chunk boundaries', () => {
    const ones = () => new Float32Array(1000).fill(1);
    const y = overlapAdd([ones(), ones(), ones()], [800, 800, 800], 200);
    expect(y.length).toBe(2600);
    for (let i = 0; i < y.length; i++) expect(y[i]).toBeCloseTo(1, 5);
  });
});

describe('Note re-render', async () => {
  const { renderNotes } = await import('../src/audio/noteRender');
  const { shapeF0 } = await import('../src/ai/rvcMath');
  it('moving a note up 2 semitones changes the measured pitch', () => {
    const x = sine(220, 1);
    const notes = segmentNotes(yin(x, sr));
    notes[0].midi += 2;
    const y = renderNotes({ sampleRate: sr, channels: [x] }, notes);
    expect(hzToMidi(median(yin(y.channels[0].subarray(sr * 0.2, sr * 0.8), sr).f0))).toBeCloseTo(hzToMidi(220) + 2, 0);
  });
  it('pitch correction pulls a detuned contour toward the semitone', () => {
    const f = new Float32Array(100).fill(440 * Math.pow(2, 0.3 / 12));
    expect(hzToMidi(shapeF0(f, { correction: 1, vibrato: 1, stability: 0 })[50])).toBeCloseTo(69, 1);
  });
});
