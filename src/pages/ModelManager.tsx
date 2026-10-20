import { useEffect, useState } from 'react';
import { listModels, removeModel, storeModel, verifyModel, loadModelBytes, type ModelRecord, type ModelRole } from '../store/models';
import { loadOrt } from '../ai/rvc';

export default function ModelManager() {
  const [list, setList] = useState<ModelRecord[]>([]); const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({}); const [err, setErr] = useState<string | null>(null);
  const [role, setRole] = useState<ModelRole>('rvc-voice'); const [sr, setSr] = useState(40000); const [license, setLicense] = useState('');
  const [perm, setPerm] = useState(false); const [url, setUrl] = useState('');
  const [storage, setStorage] = useState<string>('');
  const refresh = async () => { setList(await listModels()); const e = await navigator.storage?.estimate?.(); if (e) setStorage(`${((e.usage ?? 0) / 1e6).toFixed(0)} MB used of ~${((e.quota ?? 0) / 1e6).toFixed(0)} MB`); };
  useEffect(() => { refresh(); navigator.storage?.persist?.(); }, []);
  const store = async (buf: ArrayBuffer, name: string, source: 'imported' | 'downloaded') => {
    if (!perm) throw new Error('Confirm you have the right to use this model (license / voice owner permission).');
    await storeModel(buf, { name, role, sampleRate: role === 'rvc-voice' ? sr : 16000, license: license || 'unspecified', source, permissionConfirmed: true });
    await refresh();
  };
  const importFile = async (f?: File) => { if (!f) return; setErr(null); setBusy(`Importing ${f.name}`); try { await store(await f.arrayBuffer(), f.name, 'imported'); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); } };
  const fetchOnce = async () => {
    setErr(null); setBusy('Downloading model (one time)');
    try { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); await store(await r.arrayBuffer(), url.split('/').pop() || 'model.onnx', 'downloaded'); }
    catch (e) { setErr(`Download failed: ${(e as Error).message}. The host must allow CORS; otherwise download the file and import it.`); } finally { setBusy(null); }
  };
  const testLoad = async (m: ModelRecord) => {
    setMsg((x) => ({ ...x, [m.id]: 'Loading…' }));
    const ort = await loadOrt(); const bytes = new Uint8Array(await loadModelBytes(m));
    for (const ep of ['webgpu', 'wasm']) {
      if (ep === 'webgpu' && !('gpu' in navigator)) continue;
      try {
        const t = performance.now(); const s = await ort.InferenceSession.create(bytes, { executionProviders: [ep] });
        setMsg((x) => ({ ...x, [m.id]: `✓ Loaded on ${ep} in ${((performance.now() - t) / 1000).toFixed(1)}s · inputs: ${s.inputNames.join(', ')} · outputs: ${s.outputNames.join(', ')}` }));
        await s.release(); return;
      } catch (e) { setMsg((x) => ({ ...x, [m.id]: `${ep} failed: ${(e as Error).message}` })); }
    }
  };
  return (
    <div>
      <h2>Model Manager</h2>
      <p className="sub">Models are stored on-device (OPFS or IndexedDB) and work offline. {storage}</p>
      {err && <div className="notice bad">{err}</div>}
      {busy && <div className="notice info">{busy}…</div>}
      <div className="card">
        <h3>Supported model types</h3>
        <table><tbody>
          <tr><td>RVC v1/v2 voice (ONNX)</td><td>Inputs <code>phone [1,T,256|768], phone_lengths, pitch, pitchf, ds, rnd [1,192,T]</code> as produced by RVC's ONNX export. Must match the content encoder's feature dimension (v1 = 256, v2 = 768).</td></tr>
          <tr><td>Content encoder (ONNX)</td><td>ContentVec / HuBERT-base ONNX with input <code>[1,1,N]</code> 16 kHz audio → <code>[1,T,dim]</code> at 50 fps (e.g. <code>vec-768-layer-12.onnx</code>).</td></tr>
          <tr><td>RMVPE (ONNX, optional)</td><td>Input log-mel <code>[1,128,T]</code> (16 kHz, hop 160, T padded to ×32) → salience <code>[1,T,360]</code>, as in RVC's <code>rmvpe.onnx</code>. <span className="tag warn">adapter not yet validated with the real file</span></td></tr>
          <tr><td>Separation</td><td><span className="tag warn">no ONNX adapter yet</span> — built-in DSP separation is used instead.</td></tr>
        </tbody></table>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>No weights are bundled. "Test load" proves the file opens in ONNX Runtime on this device; it does not prove every operator runs on WebGPU — conversion falls back to WASM if a session fails.</p>
      </div>
      <div className="card">
        <h3>Add a model</h3>
        <div className="grid">
          <label className="field">Role<select value={role} onChange={(e) => setRole(e.target.value as ModelRole)}><option value="rvc-voice">RVC voice model</option><option value="content-encoder">Content encoder</option><option value="f0-rmvpe">RMVPE pitch extractor</option></select></label>
          {role === 'rvc-voice' && <label className="field">Sample rate<select value={sr} onChange={(e) => setSr(+e.target.value)}>{[32000, 40000, 48000].map((r) => <option key={r}>{r}</option>)}</select></label>}
          <label className="field">License<input type="text" value={license} placeholder="e.g. MIT, CC-BY-4.0, own voice" onChange={(e) => setLicense(e.target.value)} /></label>
        </div>
        <label style={{ display: 'block', margin: '8px 0' }}><input type="checkbox" checked={perm} onChange={(e) => setPerm(e.target.checked)} /> I have the right to use this model, and any voice it reproduces is mine or used with the owner's permission.</label>
        <div className="row"><label className="btn primary">Import .onnx…<input hidden type="file" accept=".onnx" onChange={(e) => importFile(e.target.files?.[0])} /></label></div>
        <div className="row" style={{ marginTop: 8 }}><input type="text" placeholder="https://… direct .onnx URL (CORS-enabled)" value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1 }} /><button className="btn" disabled={!url} onClick={fetchOnce}>Download once</button></div>
      </div>
      <div className="card">
        <h3>Installed models</h3>
        {!list.length && <p className="sub">None installed.</p>}
        <table><thead><tr><th>Name</th><th>Role</th><th>Size</th><th>Storage</th><th></th></tr></thead><tbody>
          {list.map((m) => <tr key={m.id}><td>{m.name}<br /><small style={{ color: 'var(--muted)' }}>{m.license} · sha256 {m.sha256.slice(0, 12)}… {msg[m.id] && <><br />{msg[m.id]}</>}</small></td><td>{m.role}{m.sampleRate ? ` · ${m.sampleRate}` : ''}</td><td>{(m.size / 1e6).toFixed(1)} MB</td><td><span className="tag ok">{m.storedIn}</span></td>
            <td><div className="row"><button className="btn small" onClick={() => testLoad(m)}>Test load</button><button className="btn small" onClick={async () => { setMsg((x) => ({ ...x, [m.id]: 'Verifying…' })); const ok = await verifyModel(m); setMsg((x) => ({ ...x, [m.id]: ok ? '✓ integrity OK (SHA-256 matches)' : '✗ integrity mismatch — re-import' })); }}>Verify</button><button className="btn small danger" onClick={async () => { if (confirm('Remove model?')) { await removeModel(m); refresh(); } }}>Remove</button></div></td></tr>)}
        </tbody></table>
      </div>
    </div>
  );
}
