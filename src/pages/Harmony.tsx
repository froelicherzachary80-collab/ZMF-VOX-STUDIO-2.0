import { useEffect, useState } from 'react';
import { useStudio } from '../ui/studio';
import { pitchShift } from '../audio/pitchshift';
import { all, put } from '../store/db';
import { Slider } from '../ui/components';
import type { PCM } from '../audio/pcm';

interface Layer { interval: number; pan: number; gainDb: number; humanizeMs: number; chorus: boolean; }
interface HarmonyPreset { name: string; layers: Layer[]; }
const BUILTIN: HarmonyPreset[] = [
  { name: 'Double (tight)', layers: [{ interval: 0, pan: -0.6, gainDb: -6, humanizeMs: 18, chorus: true }, { interval: 0, pan: 0.6, gainDb: -6, humanizeMs: 25, chorus: true }] },
  { name: 'Third + fifth', layers: [{ interval: 4, pan: -0.5, gainDb: -9, humanizeMs: 12, chorus: false }, { interval: 7, pan: 0.5, gainDb: -10, humanizeMs: 15, chorus: false }] },
  { name: 'Octave layers', layers: [{ interval: 12, pan: -0.3, gainDb: -14, humanizeMs: 8, chorus: false }, { interval: -12, pan: 0.3, gainDb: -12, humanizeMs: 8, chorus: false }] },
];

function makeLayer(src: PCM, l: Layer): PCM {
  const sr = src.sampleRate, mono = src.channels[0];
  let y = pitchShift(mono, sr, l.interval);
  if (l.chorus) { // two detuned copies (±8 cents) → real chorus/doubling
    const a = pitchShift(mono, sr, l.interval + 0.08), b = pitchShift(mono, sr, l.interval - 0.08);
    const d = Math.round(0.012 * sr); const o = new Float32Array(y.length);
    for (let i = 0; i < o.length; i++) o[i] = 0.5 * y[i] + 0.25 * a[i] + 0.25 * (b[i - d] ?? 0);
    y = o;
  }
  const shift = Math.round(((Math.random() * 2 - 1) * l.humanizeMs * sr) / 1000);
  const out = new Float32Array(y.length);
  for (let i = 0; i < out.length; i++) out[i] = y[i - shift] ?? 0;
  return { sampleRate: sr, channels: [out] };
}

export default function Harmony() {
  const st = useStudio();
  const srcTracks = st.project.tracks.filter((t) => t.kind === 'converted' || t.kind === 'vocal');
  const [srcId, setSrcId] = useState(srcTracks[0]?.id ?? '');
  const [layers, setLayers] = useState<Layer[]>(BUILTIN[1].layers); const [presets, setPresets] = useState<HarmonyPreset[]>(BUILTIN);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { all<HarmonyPreset>('presets').then((p) => setPresets([...BUILTIN, ...p.filter((x: any) => x.layers)])); }, []);
  const src = srcTracks.find((t) => t.id === srcId);
  const generate = async () => {
    const pcm = src && st.pcms.get(src.assetId); if (!pcm || !src) return;
    for (let i = 0; i < layers.length; i++) {
      setBusy(`Rendering layer ${i + 1}/${layers.length}`); await new Promise((r) => setTimeout(r, 20));
      const l = layers[i]; const out = makeLayer(pcm, l);
      const t = await st.addTrack(out, `Harmony ${i + 1} (${l.interval >= 0 ? '+' : ''}${l.interval} st)`, 'harmony', 'algorithmic harmony (DSP pitch shift, not neural)');
      st.updateTrack(t.id, { pan: l.pan, gainDb: l.gainDb, offset: src.offset });
    }
    setBusy(null);
  };
  const upd = (i: number, p: Partial<Layer>) => setLayers((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  return (
    <div>
      <h2>Harmony Studio</h2>
      <div className="notice info">Harmonies here are <b>algorithmic</b> — real pitch-shifted copies of your vocal with humanized timing — not neural generative singing. For a neural harmony, transpose in Cover Studio and render again.</div>
      <div className="card">
        <div className="row"><select value={srcId} onChange={(e) => setSrcId(e.target.value)} style={{ maxWidth: 260 }}>{srcTracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <select onChange={(e) => { const p = presets.find((x) => x.name === e.target.value); if (p) setLayers(p.layers.map((l) => ({ ...l }))); }} style={{ maxWidth: 200 }}><option>Load preset…</option>{presets.map((p) => <option key={p.name}>{p.name}</option>)}</select>
          <button className="btn small" onClick={async () => { const name = prompt('Preset name'); if (name) { await put('presets', `harmony:${name}`, { name, layers }); setPresets((p) => [...p, { name, layers }]); } }}>Save preset</button></div>
      </div>
      {layers.map((l, i) => <div className="card" key={i}>
        <div className="row" style={{ justifyContent: 'space-between' }}><h3>Layer {i + 1}</h3><button className="btn small danger" onClick={() => setLayers(layers.filter((_, k) => k !== i))}>Remove</button></div>
        <div className="grid">
          <label className="field">Interval<select value={l.interval} onChange={(e) => upd(i, { interval: +e.target.value })}>{[-12, -7, -5, -4, -3, 0, 3, 4, 5, 7, 9, 12].map((v) => <option key={v} value={v}>{v > 0 ? '+' : ''}{v} st{v === 0 ? ' (double)' : Math.abs(v) === 12 ? ' (octave)' : ''}</option>)}</select></label>
          <Slider label="Pan" min={-1} max={1} step={0.05} value={l.pan} onChange={(v) => upd(i, { pan: v })} />
          <Slider label="Gain" unit=" dB" min={-30} max={0} step={0.5} value={l.gainDb} onChange={(v) => upd(i, { gainDb: v })} />
          <Slider label="Humanize timing" unit=" ms" min={0} max={40} value={l.humanizeMs} onChange={(v) => upd(i, { humanizeMs: v })} />
          <label className="field"><span><input type="checkbox" checked={l.chorus} onChange={(e) => upd(i, { chorus: e.target.checked })} /> Chorus (detuned doubles)</span></label>
        </div>
      </div>)}
      <div className="card">
        <div className="row"><button className="btn" onClick={() => setLayers([...layers, { interval: 3, pan: 0, gainDb: -10, humanizeMs: 10, chorus: false }])}>+ Layer</button><button className="btn primary" disabled={!src || !!busy || !layers.length} onClick={generate}>{busy ?? 'Generate harmony tracks'}</button></div></div>
    </div>
  );
}
