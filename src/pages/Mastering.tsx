import { useState } from 'react';
import { useStudio } from '../ui/studio';
import { renderMix, dbToGain } from '../audio/render';
import { integratedLufs, truePeak } from '../audio/loudness';
import { peakOf } from '../audio/analysis';
import { PlayButton, Slider, fmtDb } from '../ui/components';
import type { PCM } from '../audio/pcm';
import type { MasterSettings } from '../store/project';

const PRESETS: Record<string, { target: number; m: Partial<MasterSettings> }> = {
  'Streaming (−14 LUFS, −1 dBTP)': { target: -14, m: { limiter: { on: true, ceilingDb: -1 }, comp: { on: true, thresholdDb: -16, ratio: 2, attackMs: 25, releaseMs: 200 } } },
  'Demo (−12 LUFS)': { target: -12, m: { limiter: { on: true, ceilingDb: -1 }, comp: { on: true, thresholdDb: -18, ratio: 3, attackMs: 15, releaseMs: 150 } } },
  'High-quality WAV (−16 LUFS, dynamic)': { target: -16, m: { limiter: { on: true, ceilingDb: -1.5 }, comp: { on: true, thresholdDb: -12, ratio: 1.5, attackMs: 30, releaseMs: 250 } } },
};

export interface Measure { lufs: number; tp: number; peak: number; }
export const measure = (p: PCM): Measure => ({ lufs: integratedLufs(p), tp: truePeak(p), peak: peakOf(p) });

export default function Mastering() {
  const st = useStudio(); const m = st.project.master;
  const set = (patch: Partial<MasterSettings>) => st.setProject((p) => ({ ...p, master: { ...p.master, ...patch } }));
  const [before, setBefore] = useState<Measure | null>(null); const [after, setAfter] = useState<Measure | null>(null);
  const [busy, setBusy] = useState<string | null>(null); const [last, setLast] = useState<PCM | null>(null);
  const analyse = async () => {
    setBusy('Rendering unmastered mix'); const raw = await renderMix(st.project.tracks, st.pcms, m, { bypassMaster: true }); setBefore(measure(raw));
    setBusy('Rendering mastered mix'); const out = await renderMix(st.project.tracks, st.pcms, m); setAfter(measure(out)); setLast(out); setBusy(null);
  };
  const applyPreset = async (name: string) => {
    const pr = PRESETS[name]; const next = { ...m, ...pr.m, gainDb: 0 } as MasterSettings;
    setBusy('Measuring loudness for gain match');
    // Two-pass: measure with 0 dB gain, then set gain toward target (limiter may still reduce level slightly).
    const first = measure(await renderMix(st.project.tracks, st.pcms, next));
    let gain = isFinite(first.lufs) ? pr.target - first.lufs : 0;
    gain = Math.max(-12, Math.min(12, gain));
    const second = measure(await renderMix(st.project.tracks, st.pcms, { ...next, gainDb: gain }));
    if (isFinite(second.lufs)) gain = Math.max(-12, Math.min(14, gain + (pr.target - second.lufs) * 0.8));
    set({ ...next, gainDb: Math.round(gain * 10) / 10 }); setBusy(null);
  };
  const Row = ({ k, a, b }: { k: string; a?: number; b?: number }) => <tr><td>{k}</td><td>{a === undefined ? '—' : fmtDb(a)}</td><td>{b === undefined ? '—' : fmtDb(b)}</td></tr>;
  return (
    <div>
      <h2>Mastering Suite</h2>
      <p className="sub">Meters are computed from rendered samples: integrated loudness (BS.1770 K-weighted, gated), 4× oversampled true-peak estimate, and sample peak.</p>
      {busy && <div className="notice info">{busy}…</div>}
      <div className="card"><div className="row">{Object.keys(PRESETS).map((k) => <button key={k} className="btn" disabled={!!busy || !st.project.tracks.length} onClick={() => applyPreset(k)}>{k}</button>)}</div></div>
      <div className="card"><div className="grid">
        <Slider label="Output gain" unit=" dB" min={-12} max={14} step={0.1} value={m.gainDb} onChange={(v) => set({ gainDb: v })} />
        <Slider label="EQ low" unit=" dB" min={-6} max={6} step={0.5} value={m.eq.low} onChange={(v) => set({ eq: { ...m.eq, low: v } })} />
        <Slider label="EQ mid" unit=" dB" min={-6} max={6} step={0.5} value={m.eq.mid} onChange={(v) => set({ eq: { ...m.eq, mid: v } })} />
        <Slider label="EQ high" unit=" dB" min={-6} max={6} step={0.5} value={m.eq.high} onChange={(v) => set({ eq: { ...m.eq, high: v } })} />
        <Slider label="Stereo width" min={0} max={1.6} step={0.05} value={m.width} onChange={(v) => set({ width: v })} />
        <Slider label="Reverb decay (mix bus)" unit=" s" min={0.3} max={5} step={0.1} value={m.reverbDecay} onChange={(v) => set({ reverbDecay: v })} />
        <label className="field"><span><input type="checkbox" checked={m.comp.on} onChange={(e) => set({ comp: { ...m.comp, on: e.target.checked } })} /> Bus compressor</span></label>
        <Slider label="Comp threshold" unit=" dB" min={-40} max={0} value={m.comp.thresholdDb} onChange={(v) => set({ comp: { ...m.comp, thresholdDb: v } })} />
        <Slider label="Comp ratio" min={1} max={10} step={0.1} value={m.comp.ratio} onChange={(v) => set({ comp: { ...m.comp, ratio: v } })} />
        <label className="field"><span><input type="checkbox" checked={m.limiter.on} onChange={(e) => set({ limiter: { ...m.limiter, on: e.target.checked } })} /> Look-ahead limiter</span></label>
        <Slider label="Limiter ceiling" unit=" dBFS" min={-6} max={0} step={0.1} value={m.limiter.ceilingDb} onChange={(v) => set({ limiter: { ...m.limiter, ceilingDb: v } })} />
      </div></div>
      <div className="card">
        <div className="row"><button className="btn primary" disabled={!!busy || !st.project.tracks.length} onClick={analyse}>Render & measure</button><PlayButton pcm={last ?? undefined} label="master" text="Play mastered" /></div>
        <table style={{ marginTop: 10 }}><thead><tr><th></th><th>Before master</th><th>After master</th></tr></thead><tbody>
          <tr><td>Integrated loudness</td><td>{before ? `${before.lufs.toFixed(1)} LUFS` : '—'}</td><td>{after ? `${after.lufs.toFixed(1)} LUFS` : '—'}</td></tr>
          <Row k="True peak (est.)" a={before ? 20 * Math.log10(before.tp) : undefined} b={after ? 20 * Math.log10(after.tp) : undefined} />
          <Row k="Sample peak" a={before ? 20 * Math.log10(before.peak) : undefined} b={after ? 20 * Math.log10(after.peak) : undefined} />
        </tbody></table>
        {after && after.tp > dbToGain(m.limiter.ceilingDb) * 1.02 && <div className="notice">True-peak estimate exceeds the ceiling (inter-sample overs). Lower the ceiling by ~0.5 dB.</div>}
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>These tools apply real processing; they don't replace a mastering engineer's judgement.</p>
      </div>
    </div>
  );
}
