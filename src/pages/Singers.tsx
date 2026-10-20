import { useEffect, useState } from 'react';
import { deleteSinger, listSingers, saveSinger, type Singer } from '../store/singers';
import { uid } from '../store/db';
import { listModels, type ModelRecord } from '../store/models';
import { listProjects, type Project } from '../store/project';
import { ModelLinker } from './VoiceLab';
import VoiceUpgrades from './VoiceUpgrades';
import { download, Slider } from '../ui/components';
import { HV_PRESETS } from '../audio/humanvoice';

export default function Singers({ go }: { go: (r: string) => void }) {
  const [list, setList] = useState<Singer[]>([]); const [edit, setEdit] = useState<Singer | null>(null);
  const [models, setModels] = useState<ModelRecord[]>([]); const [projects, setProjects] = useState<Project[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => { listSingers().then(setList); listModels().then(setModels); listProjects().then(setProjects); };
  useEffect(refresh, []);
  const memGB = (navigator as any).deviceMemory as number | undefined;
  const exportOne = (s: Singer) => download(new Blob([JSON.stringify({ format: 'zmf-singer', version: 1, singer: { ...s, sampleAssetIds: [] }, note: 'Model weights are not embedded; re-link models after import.' }, null, 2)], { type: 'application/json' }), `${s.name}.zmfsinger.json`);
  const importOne = async (f?: File) => {
    if (!f) return;
    try {
      const j = JSON.parse(await f.text()); if (j.format !== 'zmf-singer') throw new Error('Not a ZMF singer file');
      const singers: Singer[] = Array.isArray(j.singers) ? j.singers : [j.singer];
      if (!confirm('Confirm: you own these voices or have permission from the voice owners to use them.')) return;
      for (const s of singers) await saveSinger({ ...s, id: uid(), permissionConfirmed: true, capability: models.some((m) => m.id === s.voiceModelId) && models.some((m) => m.id === s.contentModelId) ? 'neural-rvc' : 'analysis-only' });
      refresh();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div>
      <h2>My AI Singers</h2>
      <p className="sub">Profiles are stored on this device. Models loaded at once: {memGB ? (memGB >= 6 ? 2 : 1) : 1} (based on {memGB ? `${memGB} GB reported memory` : 'unknown memory — iOS does not report it'}).</p>
      {err && <div className="notice bad">{err}</div>}
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn primary" onClick={() => go('lab')}>+ New singer</button>
        <label className="btn">Import profile…<input hidden type="file" accept=".json,application/json" onChange={(e) => importOne(e.target.files?.[0])} /></label>
        <button className="btn" disabled={!list.length} onClick={() => download(new Blob([JSON.stringify({ format: 'zmf-singer', version: 1, singers: list.map((s) => ({ ...s, sampleAssetIds: [] })) })], { type: 'application/json' }), 'zmf-singers-backup.json')}>Backup all</button>
      </div>
      {!list.length && <div className="notice info">No singers yet. ZMF does not ship celebrity or third-party voice clones.</div>}
      <div className="grid">
        {list.map((s) => {
          const vm = models.find((m) => m.id === s.voiceModelId);
          return (
            <div className="card" key={s.id}>
              <div className="row">{s.avatar ? <img className="avatar" src={s.avatar} /> : <div className="avatar">{s.name[0]}</div>}<div><b>{s.name}</b><br /><small style={{ color: 'var(--muted)' }}>{s.voiceType} · {s.rangeLow}–{s.rangeHigh}</small></div></div>
              <p style={{ fontSize: 13 }}>{s.description}</p>
              <span className={`tag ${s.capability === 'neural-rvc' ? 'ok' : 'warn'}`}>{s.capability === 'neural-rvc' ? `RVC ONNX · ${s.modelSampleRate} Hz` : 'analysis-only'}</span> {s.featureBankInfo && <span className="tag ok">index {s.featureBankInfo.vectors}</span>} {s.rmvpeModelId && <span className="tag ok">RMVPE</span>} {s.syntheticLabel && <span className="tag v">labelled synthetic</span>}
              {vm && <p style={{ fontSize: 12, color: 'var(--muted)' }}>Model: {vm.name} ({(vm.size / 1e6).toFixed(0)} MB, {vm.license})</p>}
              {s.recentProjects.length > 0 && <p style={{ fontSize: 12, color: 'var(--muted)' }}>Recent: {s.recentProjects.map((id) => projects.find((p) => p.id === id)?.name).filter(Boolean).join(', ') || '—'}</p>}
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn small" onClick={() => setEdit(s)}>Edit / upgrade</button>
                <button className="btn small" onClick={async () => { await saveSinger({ ...s, id: uid(), name: `${s.name} copy`, createdAt: Date.now(), recentProjects: [] }); refresh(); }}>Duplicate</button>
                <button className="btn small" onClick={() => exportOne(s)}>Export</button>
                <button className="btn small danger" onClick={async () => { if (confirm(`Delete ${s.name}?`)) { await deleteSinger(s.id); refresh(); } }}>Delete</button>
              </div>
            </div>
          );
        })}
      </div>
      {edit && <div className="fullscreen">
        <div className="row" style={{ justifyContent: 'space-between' }}><h2>Edit {edit.name}</h2><button className="btn" onClick={() => setEdit(null)}>Close</button></div>
        <div className="card"><div className="grid">
          <label className="field">Name<input type="text" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          <label className="field">Description<input type="text" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label>
          <label className="field">Range<div className="row"><input type="text" style={{ width: 70 }} value={edit.rangeLow} onChange={(e) => setEdit({ ...edit, rangeLow: e.target.value })} />–<input type="text" style={{ width: 70 }} value={edit.rangeHigh} onChange={(e) => setEdit({ ...edit, rangeHigh: e.target.value })} /></div></label>
          <Slider label="Default transpose" unit=" st" min={-24} max={24} value={edit.transpose} onChange={(v) => setEdit({ ...edit, transpose: v })} />
          <label className="field">HUMANVOICE preset<select onChange={(e) => setEdit({ ...edit, defaultStyle: e.target.value, humanVoice: { ...HV_PRESETS[e.target.value] } })} value={edit.defaultStyle in HV_PRESETS ? edit.defaultStyle : ''}><option value="">custom</option>{Object.keys(HV_PRESETS).map((k) => <option key={k}>{k}</option>)}</select></label>
        </div></div>
        <div className="card"><h3>Voice model</h3><ModelLinker singer={edit} onChange={setEdit} /><p>Status: <span className={`tag ${edit.capability === 'neural-rvc' ? 'ok' : 'warn'}`}>{edit.capability}</span></p></div>
        <VoiceUpgrades singer={edit} onChange={setEdit} />
        <button className="btn primary" style={{ position: 'sticky', bottom: 8 }} onClick={async () => { await saveSinger(edit); setEdit(null); refresh(); }}>Save singer</button>
      </div>}
    </div>
  );
}
