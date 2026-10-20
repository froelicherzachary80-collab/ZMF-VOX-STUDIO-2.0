import { useState } from 'react';
import { useStudio } from '../ui/studio';
import { slicePCM } from '../audio/pcm';
import { humanVoice, HV_PRESETS } from '../audio/humanvoice';
import { PlayButton, Slider, Waveform, fmtTime } from '../ui/components';

export default function VocalEditor() {
  const st = useStudio();
  const tracks = st.project.tracks;
  const [id, setId] = useState(tracks.find((t) => t.kind === 'converted')?.id ?? tracks[0]?.id ?? '');
  const t = tracks.find((x) => x.id === id); const pcm = t ? st.pcms.get(t.assetId) : undefined;
  const [sel, setSel] = useState<[number, number] | null>(null); const [gain, setGain] = useState(-3); const [preset, setPreset] = useState('Natural Studio');
  const [busy, setBusy] = useState(false);
  const dur = pcm ? pcm.channels[0].length / pcm.sampleRate : 0;
  const addAuto = () => { if (!t || !sel) return; const pts = t.automation.filter((a) => a.t < sel[0] - 0.05 || a.t > sel[1] + 0.05); const cur = 0; st.updateTrack(t.id, { automation: [...pts, { t: sel[0] - 0.02, gainDb: cur }, { t: sel[0], gainDb: gain }, { t: sel[1], gainDb: gain }, { t: sel[1] + 0.02, gainDb: cur }].sort((a, b) => a.t - b.t) }); };
  const trim = async () => { if (!t || !pcm || !sel) return; await st.replaceAsset(t.id, slicePCM(pcm, sel[0], sel[1]), `${t.provenance ?? ''} + trimmed`); st.updateTrack(t.id, { offset: t.offset + sel[0], automation: [] }); setSel(null); };
  const process = async () => { if (!t || !pcm) return; setBusy(true); await new Promise((r) => setTimeout(r, 20)); await st.replaceAsset(t.id, humanVoice(pcm, HV_PRESETS[preset]), `${t.provenance ?? ''} + HUMANVOICE ${preset}`); setBusy(false); };
  return (
    <div>
      <h2>Vocal Editor</h2>
      <p className="sub">Drag on the waveform to select a phrase. Gain edits are non-destructive automation; trim and HUMANVOICE create a new asset version (the original asset is kept in storage).</p>
      {!tracks.length && <div className="notice info">No tracks yet.</div>}
      <div className="card">
        <select value={id} onChange={(e) => { setId(e.target.value); setSel(null); }}>{tracks.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <div style={{ marginTop: 10 }}><Waveform pcm={pcm} height={140} selection={sel} onSelect={setSel} playLabel="ve" /></div>
        <p style={{ fontSize: 13 }}>{sel ? `Selection ${fmtTime(sel[0])} – ${fmtTime(sel[1])} (${(sel[1] - sel[0]).toFixed(2)}s)` : `Length ${fmtTime(dur)}`}</p>
        <div className="row">
          <PlayButton pcm={pcm && sel ? slicePCM(pcm, sel[0], sel[1]) : pcm} label="ve-sel" text={sel ? 'Preview selection' : 'Play'} />
          <button className="btn" disabled={!sel} onClick={trim}>Trim to selection</button>
          <button className="btn small" onClick={() => setSel(null)}>Clear</button>
        </div>
      </div>
      <div className="card">
        <h3>Volume automation</h3>
        <Slider label="Selection gain" unit=" dB" min={-24} max={12} step={0.5} value={gain} onChange={setGain} />
        <div className="row" style={{ marginTop: 8 }}><button className="btn" disabled={!sel} onClick={addAuto}>Write automation</button><button className="btn small" disabled={!t?.automation.length} onClick={() => t && st.updateTrack(t.id, { automation: [] })}>Clear automation ({t?.automation.length ?? 0} pts)</button></div>
      </div>
      <div className="card">
        <h3>HUMANVOICE processing</h3>
        <div className="row"><select value={preset} onChange={(e) => setPreset(e.target.value)} style={{ maxWidth: 220 }}>{Object.keys(HV_PRESETS).map((k) => <option key={k}>{k}</option>)}</select><button className="btn primary" disabled={!pcm || busy} onClick={process}>{busy ? 'Processing…' : 'Apply to track'}</button></div>
        {t?.provenance && <p><span className="tag v">{t.provenance}</span></p>}
      </div>
    </div>
  );
}
