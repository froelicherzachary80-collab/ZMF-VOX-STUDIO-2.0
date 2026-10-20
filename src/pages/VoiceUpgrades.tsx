import { useEffect, useState } from 'react';
import type { Singer } from '../store/singers';
import { loadPCM, savePCM } from '../store/assets';
import { uid } from '../store/db';
import type { PCM } from '../audio/pcm';
import { toMono } from '../audio/pcm';
import { checkQuality, materialAdvice, type QualityReport } from '../audio/quality';
import { meanMfcc } from '../audio/mfcc';
import { bankFromNpy, buildBankFromSamples, deleteBank, saveBank } from '../ai/bank';
import { sliceForTraining } from '../audio/dataset';
import { encodeWav } from '../audio/wav';
import { zip } from '../store/zip';
import { decodeFile } from '../audio/decode';
import { download, Progress, Slider } from '../ui/components';
import { listModels, type ModelRecord } from '../store/models';

export function QualityBadges({ r }: { r: QualityReport }) {
  return <div style={{ fontSize: 12, marginTop: 4 }}>
    <span className="tag">{r.seconds.toFixed(1)} s</span> <span className="tag">peak {r.peakDb.toFixed(1)} dB</span> <span className="tag">SNR≈{r.snrDb.toFixed(0)} dB</span> <span className="tag">voiced {r.voicedPct.toFixed(0)}%</span>
    {r.verdicts.map((v, i) => <div key={i}><span className={`tag ${v.level}`}>{v.level === 'ok' ? '✓' : v.level === 'warn' ? '!' : '✗'}</span> {v.text}</div>)}
  </div>;
}

/** v0.2 voice-clone upgrades: feature index, RMVPE, speaker ID, quality, fingerprint, dataset export. */
export default function VoiceUpgrades({ singer, onChange }: { singer: Singer; onChange: (s: Singer) => void }) {
  const [samples, setSamples] = useState<PCM[]>([]); const [reports, setReports] = useState<QualityReport[]>([]);
  const [models, setModels] = useState<ModelRecord[]>([]); const [k, setK] = useState(512);
  const [busy, setBusy] = useState<string | null>(null); const [prog, setProg] = useState(0); const [err, setErr] = useState<string | null>(null);
  const [dsSr, setDsSr] = useState(40000);
  useEffect(() => { listModels().then(setModels); }, []);
  useEffect(() => { (async () => {
    const ps = (await Promise.all(singer.sampleAssetIds.map(loadPCM))).filter(Boolean) as PCM[];
    setSamples(ps); setReports(ps.map(checkQuality));
  })(); }, [singer.sampleAssetIds.join()]); // eslint-disable-line
  const total = samples.reduce((a, s) => a + s.channels[0].length / s.sampleRate, 0);
  const wrap = async (label: string, fn: () => Promise<void>) => { setErr(null); setBusy(label); setProg(0); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); } };

  const addSamples = (files: FileList | null) => files && wrap('Adding samples', async () => {
    const ids: string[] = []; for (const f of files) { const p = await decodeFile(f); const id = uid(); await savePCM(id, p); ids.push(id); }
    onChange({ ...singer, sampleAssetIds: [...singer.sampleAssetIds, ...ids] });
  });
  const fingerprint = (ps = samples) => { const all = ps.map((p) => ({ x: toMono(p), sr: p.sampleRate })); if (!all.length) return undefined; const v = all.map((a) => meanMfcc(a.x, a.sr)); return Array.from(v[0], (_, i) => v.reduce((s, x) => s + x[i], 0) / v.length); };
  const build = () => wrap('Building feature index', async () => {
    if (!singer.contentModelId) throw new Error('Link a content encoder first (Voice model section).');
    if (!samples.length) throw new Error('Add reference samples of this singer first.');
    const { bank, sourceFrames } = await buildBankFromSamples(singer.contentModelId, samples, k, (f, m) => { setProg(f); setBusy(m); });
    if (singer.featureBankId) await deleteBank(singer.featureBankId);
    const id = await saveBank(bank);
    onChange({ ...singer, featureBankId: id, featureBankInfo: { vectors: bank.count, sourceFrames, dim: bank.dim, source: 'samples', builtAt: Date.now() }, indexRate: singer.indexRate ?? 0.75, protect: singer.protect ?? 0.33, timbreFingerprint: fingerprint() });
  });
  const importNpy = (f?: File) => f && wrap('Importing RVC feature file', async () => {
    const { bank, sourceFrames } = await bankFromNpy(await f.arrayBuffer(), k);
    if (singer.featureBankId) await deleteBank(singer.featureBankId);
    const id = await saveBank(bank);
    onChange({ ...singer, featureBankId: id, featureBankInfo: { vectors: bank.count, sourceFrames, dim: bank.dim, source: 'npy', builtAt: Date.now() }, indexRate: singer.indexRate ?? 0.75, protect: singer.protect ?? 0.33 });
  });
  const exportDataset = () => wrap('Preparing training dataset', async () => {
    const files: { name: string; data: Uint8Array }[] = []; let n = 0, secs = 0;
    for (const s of samples) for (const c of sliceForTraining(s, dsSr)) { n++; secs += c.length / dsSr; files.push({ name: `${singer.name.replace(/\W+/g, '_')}/clip_${String(n).padStart(4, '0')}.wav`, data: new Uint8Array(await encodeWav({ sampleRate: dsSr, channels: [c] }).arrayBuffer()) }); }
    if (!n) throw new Error('No usable 3–12 s sung phrases found in the samples.');
    const readme = `ZMF VOX STUDIO+ training dataset\nSinger: ${singer.name}\nClips: ${n} (${(secs / 60).toFixed(1)} min), mono 16-bit ${dsSr} Hz, peak-normalised to -1 dBFS, split on silence.\n\nConsent: the creator confirmed they own this voice or have the voice owner's permission (${singer.permissionConfirmed ? 'yes' : 'NO'}).\n\nTrain with RVC WebUI (v2, ${dsSr / 1000}k) on a PC or Colab GPU, then export ONNX and import it into ZMF Model Manager.\nRecommended: 10+ minutes of clean, dry singing for a good model.\n`;
    files.push({ name: `${singer.name.replace(/\W+/g, '_')}/README.txt`, data: new TextEncoder().encode(readme) });
    download(zip(files), `${singer.name.replace(/\W+/g, '_')}_rvc_dataset.zip`);
  });
  const rmvpes = models.filter((m) => m.role === 'f0-rmvpe');
  return (
    <div className="card">
      <h3>Voice clone upgrades <span className="tag v">v0.2</span></h3>
      {err && <div className="notice bad">{err}</div>}
      {busy && <div style={{ margin: '8px 0' }}>{busy}<Progress value={prog} /></div>}

      <h3 style={{ marginTop: 10 }}>1 · Reference material & quality</h3>
      <div className="row"><label className="btn small">Add samples…<input hidden multiple type="file" accept="audio/*" onChange={(e) => addSamples(e.target.files)} /></label><span className="tag">{samples.length} samples · {total.toFixed(0)} s total</span></div>
      <table style={{ marginTop: 6 }}><tbody>{materialAdvice(total).map((a) => <tr key={a.use}><td>{a.use}</td><td>≥ {a.need >= 60 ? `${a.need / 60} min` : `${a.need} s`}</td><td><span className={`tag ${a.ok ? 'ok' : 'warn'}`}>{a.ok ? 'enough' : 'need more'}</span></td></tr>)}</tbody></table>
      {reports.map((r, i) => <details key={i} style={{ marginTop: 4 }}><summary style={{ fontSize: 13 }}>Sample {i + 1}: {r.verdicts.some((v) => v.level === 'bad') ? '✗ issues' : r.verdicts.some((v) => v.level === 'warn') ? '! check' : '✓ good'}</summary><QualityBadges r={r} /></details>)}

      <h3 style={{ marginTop: 14 }}>2 · Target-voice feature index <span className="tag ok">neural, retrieval</span></h3>
      <p style={{ fontSize: 13, color: 'var(--muted)' }}>Like RVC's .index: each frame of the song's content features is blended with its 8 nearest neighbours from <i>this singer's</i> own features, which pulls pronunciation and timbre toward the target. Built on-device with your content encoder; works with an already-trained RVC model. Does not train the model.</p>
      <div className="row">
        <select value={k} onChange={(e) => setK(+e.target.value)} style={{ width: 160 }}>{[256, 512, 1024, 2048].map((v) => <option key={v} value={v}>{v} vectors</option>)}</select>
        <button className="btn primary" disabled={!!busy || !samples.length} onClick={build}>Build from samples</button>
        <label className="btn">Import RVC total_fea.npy…<input hidden type="file" accept=".npy" onChange={(e) => importNpy(e.target.files?.[0])} /></label>
        {singer.featureBankId && <button className="btn small danger" onClick={async () => { await deleteBank(singer.featureBankId!); onChange({ ...singer, featureBankId: undefined, featureBankInfo: undefined }); }}>Remove index</button>}
      </div>
      {singer.featureBankInfo ? <p><span className="tag ok">index: {singer.featureBankInfo.vectors} × {singer.featureBankInfo.dim} from {singer.featureBankInfo.sourceFrames} frames ({singer.featureBankInfo.source})</span></p> : <p><span className="tag warn">no index</span></p>}
      <div className="grid">
        <Slider label="Default index rate" min={0} max={1} step={0.05} value={singer.indexRate ?? 0.75} onChange={(v) => onChange({ ...singer, indexRate: v })} disabled={!singer.featureBankId} />
        <Slider label="Default protect" min={0} max={0.5} step={0.01} value={singer.protect ?? 0.33} onChange={(v) => onChange({ ...singer, protect: v })} disabled={!singer.featureBankId} />
      </div>

      <h3 style={{ marginTop: 14 }}>3 · Pitch extractor & speaker</h3>
      <div className="grid">
        <label className="field">RMVPE model (optional)<select value={singer.rmvpeModelId ?? ''} onChange={(e) => onChange({ ...singer, rmvpeModelId: e.target.value || undefined, f0Method: e.target.value ? 'rmvpe' : 'yin' })}><option value="">— none (use YIN) —</option>{rmvpes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label className="field">Speaker ID (multi-speaker models)<input type="number" min={0} value={singer.speakerId ?? 0} onChange={(e) => onChange({ ...singer, speakerId: Math.max(0, parseInt(e.target.value) || 0) })} /></label>
      </div>
      {!rmvpes.length && <p style={{ fontSize: 12, color: 'var(--muted)' }}>Import an <code>rmvpe.onnx</code> in Model Manager (role "RMVPE pitch") for steadier pitch on breathy or noisy vocals. Adapter not yet validated with a real RMVPE file — check "Test load" first.</p>}

      <h3 style={{ marginTop: 14 }}>4 · Timbre fingerprint</h3>
      <div className="row"><button className="btn small" disabled={!samples.length} onClick={() => onChange({ ...singer, timbreFingerprint: fingerprint() })}>{singer.timbreFingerprint ? 'Recompute' : 'Compute'} fingerprint</button><span className={`tag ${singer.timbreFingerprint ? 'ok' : 'warn'}`}>{singer.timbreFingerprint ? 'used for match score after each conversion' : 'none'}</span></div>

      <h3 style={{ marginTop: 14 }}>5 · Train a real model (off-device)</h3>
      <p style={{ fontSize: 13, color: 'var(--muted)' }}>Exports your samples as a clean RVC training set (silence-split 3–12 s clips, normalised, mono). Train with RVC WebUI on a PC or free Colab GPU, export ONNX, import here.</p>
      <div className="row"><select value={dsSr} onChange={(e) => setDsSr(+e.target.value)} style={{ width: 120 }}>{[32000, 40000, 48000].map((r) => <option key={r} value={r}>{r / 1000} kHz</option>)}</select><button className="btn" disabled={!samples.length || !!busy || !singer.permissionConfirmed} onClick={exportDataset}>Export dataset .zip</button></div>
    </div>
  );
}
