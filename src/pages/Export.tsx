import { useState } from 'react';
import { useStudio } from '../ui/studio';
import { renderMix } from '../audio/render';
import { encodeWav } from '../audio/wav';
import { encodeMp3 } from '../audio/mp3';
import { download, Progress } from '../ui/components';
import type { PCM } from '../audio/pcm';
import { slicePCM } from '../audio/pcm';
import { exportProjectFile } from '../store/projectFile';

export default function ExportStudio() {
  const st = useStudio(); const p = st.project;
  const [busy, setBusy] = useState<string | null>(null); const [prog, setProg] = useState(0); const [err, setErr] = useState<string | null>(null);
  const [kbps, setKbps] = useState(192); const [bits, setBits] = useState<16 | 32>(16); const [seg, setSeg] = useState<[number, number] | null>(null);
  const label = p.syntheticContent ? 'Contains AI-generated (synthetic) vocals – ZMF VOX STUDIO+' : undefined;
  const safe = p.name.replace(/[^\w\- ]+/g, '').trim() || 'export';
  const run = async (what: string, fn: () => Promise<void>) => { setErr(null); setBusy(what); setProg(0); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); } };
  const mix = async () => { const m = await renderMix(p.tracks, st.pcms, p.master); return seg ? slicePCM(m, seg[0], seg[1]) : m; };
  const stem = (kind: string) => { const t = p.tracks.find((x) => x.kind === kind); return t ? st.pcms.get(t.assetId) : undefined; };
  const out = async (pcm: PCM, name: string, fmt: 'wav' | 'mp3') => {
    const blob = fmt === 'wav' ? encodeWav(pcm, bits, label) : await encodeMp3(pcm, kbps, setProg);
    download(blob, `${name}.${fmt}`);
  };
  return (
    <div>
      <h2>Export Studio</h2>
      <p className="sub">Encoding runs locally (WAV writer, LAME MP3). On iPhone the share sheet opens — choose "Save to Files".</p>
      {err && <div className="notice bad">{err}</div>}
      {busy && <div className="card">{busy}<Progress value={prog} /></div>}
      {p.syntheticContent && <div className="notice info">This project contains converted vocals. WAV exports include an INFO comment labelling them as AI-generated.</div>}
      <div className="card"><div className="grid">
        <label className="field">WAV bit depth<select value={bits} onChange={(e) => setBits(+e.target.value as 16 | 32)}><option value={16}>16-bit PCM</option><option value={32}>32-bit float</option></select></label>
        <label className="field">MP3 bitrate<select value={kbps} onChange={(e) => setKbps(+e.target.value)}>{[128, 192, 256, 320].map((k) => <option key={k} value={k}>{k} kbps</option>)}</select></label>
        <label className="field">Segment (optional, seconds)<div className="row"><input type="number" placeholder="start" onChange={(e) => setSeg([+e.target.value || 0, seg?.[1] ?? 30])} style={{ width: 80 }} /><input type="number" placeholder="end" onChange={(e) => setSeg([seg?.[0] ?? 0, +e.target.value || 30])} style={{ width: 80 }} /><button className="btn small" onClick={() => setSeg(null)}>whole</button></div></label>
      </div></div>
      <div className="card"><h3>Mastered mix</h3><div className="row">
        <button className="btn primary" disabled={!p.tracks.length || !!busy} onClick={() => run('Rendering mix → WAV', async () => out(await mix(), `${safe} (mix)`, 'wav'))}>Mix WAV</button>
        <button className="btn primary" disabled={!p.tracks.length || !!busy} onClick={() => run('Rendering mix → MP3', async () => out(await mix(), `${safe} (mix)`, 'mp3'))}>Mix MP3</button>
      </div></div>
      <div className="card"><h3>Stems</h3><div className="row">
        {(['vocal', 'instrumental', 'converted'] as const).map((k) => { const s = stem(k); return <span key={k} className="row"><button className="btn" disabled={!s || !!busy} onClick={() => run(`${k} WAV`, async () => out(s!, `${safe} - ${k === 'converted' ? 'converted vocal' : k}`, 'wav'))}>{k === 'converted' ? 'Converted vocal' : k === 'vocal' ? 'Vocal stem' : 'Instrumental'} WAV</button></span>; })}
      </div></div>
      <div className="card"><h3>Project file (.zmfproj)</h3><p className="sub">Settings, notes and track references. Optionally bundle audio (larger file).</p><div className="row">
        <button className="btn" onClick={() => run('Writing project', async () => download(await exportProjectFile(p, st.pcms, false), `${safe}.zmfproj`))}>Settings only</button>
        <button className="btn" onClick={() => run('Bundling audio', async () => download(await exportProjectFile(p, st.pcms, true), `${safe}.zmfproj`))}>With audio</button>
      </div></div>
    </div>
  );
}
