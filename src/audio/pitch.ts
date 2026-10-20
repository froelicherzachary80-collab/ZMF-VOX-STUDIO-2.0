/** YIN fundamental-frequency tracker (de Cheveigné & Kawahara 2002). */
export interface F0Track { f0: Float32Array; voicing: Float32Array; hop: number; sampleRate: number; }

export function yin(x: Float32Array, sr: number, opts: { hop?: number; fmin?: number; fmax?: number; threshold?: number } = {}): F0Track {
  const hop = opts.hop ?? Math.round(sr / 100);
  const fmin = opts.fmin ?? 65, fmax = opts.fmax ?? 1100, th = opts.threshold ?? 0.15;
  const maxTau = Math.ceil(sr / fmin), minTau = Math.floor(sr / fmax);
  const W = maxTau;
  const frames = Math.max(0, Math.floor((x.length - W - maxTau) / hop) + 1);
  const f0 = new Float32Array(frames), voicing = new Float32Array(frames);
  const d = new Float32Array(maxTau + 1);
  for (let f = 0; f < frames; f++) {
    const s = f * hop;
    let energy = 0;
    for (let i = 0; i < W; i++) energy += x[s + i] * x[s + i];
    if (energy / W < 1e-7) continue;
    d[0] = 1; let run = 0;
    for (let tau = 1; tau <= maxTau; tau++) {
      let acc = 0;
      for (let i = 0; i < W; i++) { const v = x[s + i] - x[s + i + tau]; acc += v * v; }
      run += acc;
      d[tau] = run > 0 ? (acc * tau) / run : 1;
    }
    let tau = -1;
    for (let t = minTau; t < maxTau; t++) {
      if (d[t] < th) { while (t + 1 < maxTau && d[t + 1] < d[t]) t++; tau = t; break; }
    }
    if (tau < 0) continue;
    const a = d[tau - 1], b = d[tau], c = d[tau + 1] ?? b;
    const den = a - 2 * b + c;
    const refined = den !== 0 ? tau + (0.5 * (a - c)) / den : tau;
    f0[f] = sr / refined; voicing[f] = 1 - b;
  }
  return { f0, voicing, hop, sampleRate: sr };
}

export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);
export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const midiName = (m: number) => `${NAMES[((Math.round(m) % 12) + 12) % 12]}${Math.floor(Math.round(m) / 12) - 1}`;

/** Median filter + octave-jump repair on an f0 track (in place copy). */
export function smoothF0(f0: Float32Array, k = 5): Float32Array {
  const out = f0.slice(), h = k >> 1;
  for (let i = 0; i < f0.length; i++) {
    if (!f0[i]) continue;
    const win: number[] = [];
    for (let j = i - h; j <= i + h; j++) if (f0[j] > 0) win.push(f0[j]);
    win.sort((a, b) => a - b);
    const med = win[win.length >> 1];
    let v = f0[i];
    const r = v / med;
    if (r > 1.8 && r < 2.2) v /= 2; else if (r < 0.56 && r > 0.45) v *= 2;
    out[i] = v;
  }
  return out;
}

export interface Note { id: string; start: number; end: number; midi: number; detectedMidi: number; gainDb: number; vibrato: number; }

/** Segment a voiced f0 track into editable note suggestions (seconds). */
export function segmentNotes(t: F0Track, minDur = 0.08): Note[] {
  const fps = t.sampleRate / t.hop;
  const notes: Note[] = [];
  let cur: number[] = [], start = -1;
  const flush = (end: number) => {
    if (start >= 0 && cur.length / fps >= minDur) {
      const s = cur.slice().sort((a, b) => a - b), med = s[s.length >> 1];
      notes.push({ id: `n${notes.length}-${start}`, start: start / fps, end: end / fps, midi: Math.round(med * 100) / 100, detectedMidi: med, gainDb: 0, vibrato: 1 });
    }
    cur = []; start = -1;
  };
  for (let i = 0; i < t.f0.length; i++) {
    if (t.f0[i] > 0) {
      const m = hzToMidi(t.f0[i]);
      if (cur.length) {
        const s = cur.slice(-8).sort((a, b) => a - b), med = s[s.length >> 1];
        if (Math.abs(m - med) > 0.8 && cur.length > 4) { flush(i); }
      }
      if (start < 0) start = i;
      cur.push(m);
    } else flush(i);
  }
  flush(t.f0.length);
  return notes.map((n) => ({ ...n, midi: Math.round(n.detectedMidi) }));
}
