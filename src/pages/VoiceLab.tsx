import { useEffect, useRef, useState } from 'react';
import { decodeFile } from '../audio/decode';
import type { PCM } from '../audio/pcm';
import { analyzeVoice } from '../audio/voiceAnalysis';
import { midiName } from '../audio/pitch';
import { savePCM } from '../store/assets';
import { uid } from '../store/db';
import { listModels, type ModelRecord } from '../store/models';
import { newSinger, saveSinger, type Singer } from '../store/singers';
import { PlayButton, Waveform } from '../ui/components';
import { checkQuality } from '../audio/quality';
import { QualityBadges } from './VoiceUpgrades';
import { meanMfcc } from '../audio/mfcc';
import { toMono } from '../audio/pcm';

export const VOICE_STYLES: { name: string; kind: string }[] = [
  { name: 'Natural', kind: 'DSP preset' }, { name: 'Bright', kind: 'DSP EQ' }, { name: 'Dark', kind: 'DSP EQ' }, { name: 'Soft', kind: 'DSP dynamics' },
  { name: 'Powerful', kind: 'DSP comp+sat' }, { name: 'Airy', kind: 'DSP EQ' }, { name: 'Warm', kind: 'DSP EQ' }, { name: 'Raspy', kind: 'model-dependent — unavailable' },
  { name: 'Intimate', kind: 'DSP preset' }, { name: 'Emotional', kind: 'model-dependent — unavailable' }, { name: 'Neutral', kind: 'DSP flat' }, { name: 'Aggressive', kind: 'DSP sat+comp' },
];

export function ModelLinker({ singer, onChange }: { singer: Singer; onChange: (s: Singer) => void }) {
  const [models, setModels] = useState<ModelRecord[]>([]);
  useEffect(() => { listModels().then(setModels); }, []);
  const voices = models.filter((m) => m.role === 'rvc-voice'), enc = models.filter((m) => m.role === 'content-encoder');
  const link = (patch: Partial<Singer>) => { const s = { ...singer, ...patch }; s.capability = s.voiceModelId && s.contentModelId ? 'neural-rvc' : 'analysis-only'; onChange(s); };
  return (
    <div className="grid">
      <label className="field">RVC voice model (ONNX)<select value={singer.voiceModelId ?? ''} onChange={(e) => { const m = voices.find((v) => v.id === e.target.value); link({ voiceModelId: e.target.value || undefined, modelSampleRate: m?.sampleRate ?? singer.modelSampleRate }); }}><option value="">— none —</option>{voices.map((m) => <option key={m.id} value={m.id}>{m.name} ({(m.size / 1e6).toFixed(0)} MB)</option>)}</select></label>
      <label className="field">Content encoder (ContentVec/HuBERT ONNX)<select value={singer.contentModelId ?? ''} onChange={(e) => link({ contentModelId: e.target.value || undefined })}><option value="">— none —</option>{enc.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <label className="field">Model sample rate<select value={singer.modelSampleRate ?? 40000} onChange={(e) => link({ modelSampleRate: +e.target.value })}>{[32000, 40000, 48000].map((r) => <option key={r} value={r}>{r} Hz</option>)}</select></label>
      {!models.length && <div className="notice info">No models imported yet — use Model Manager.</div>}
    </div>
  );
}

export default function VoiceLab({ go }: { go: (r: string) => void }) {
  const [s, setS] = useState<Singer>(() => newSinger());
  const [samples, setSamples] = useState<{ name: string; pcm: PCM }[]>([]);
  const [rec, setRec] = useState<MediaRecorder | null>(null); const chunks = useRef<Blob[]>([]);
  const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const add = async (files: FileList | null) => { if (!files) return; for (const f of files) { try { setSamples((x) => [...x]); const p = await decodeFile(f); setSamples((x) => [...x, { name: f.name, pcm: p }]); } catch (e) { setErr((e as Error).message); } } };
  const record = async () => {
    if (rec) { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const mr = new MediaRecorder(stream); chunks.current = [];
      mr.ondataavailable = (e) => chunks.current.push(e.data);
      mr.onstop = async () => { stream.getTracks().forEach((t) => t.stop()); setRec(null); const b = new Blob(chunks.current, { type: mr.mimeType }); try { const p = await decodeFile(b); setSamples((x) => [...x, { name: `Recording ${x.length + 1}`, pcm: p }]); } catch (e) { setErr((e as Error).message); } };
      mr.start(); setRec(mr);
    } catch (e) { setErr(`Microphone unavailable: ${(e as Error).message}`); }
  };
  const runAnalysis = () => { if (!samples.length) return; const a = analyzeVoice(samples.map((x) => x.pcm)); setS((p) => ({ ...p, analysis: a, rangeLow: midiName(a.rangeLowMidi), rangeHigh: midiName(a.rangeHighMidi) })); };
  const save = async () => {
    if (!s.permissionConfirmed) { setErr('Confirm you own or have permission to use this voice.'); return; }
    const ids: string[] = [];
    for (const x of samples) { const id = uid(); await savePCM(id, x.pcm); ids.push(id); }
    const fps = samples.map((x) => meanMfcc(toMono(x.pcm), x.pcm.sampleRate));
    const timbreFingerprint = fps.length ? Array.from(fps[0], (_, i) => fps.reduce((a, f) => a + f[i], 0) / fps.length) : undefined;
    await saveSinger({ ...s, timbreFingerprint, sampleAssetIds: [...s.sampleAssetIds, ...ids] });
    setMsg(`Saved "${s.name}" as ${s.capability === 'neural-rvc' ? 'a neural RVC singer' : 'an analysis-only profile (not trained, cannot convert yet)'}. Next: Edit / upgrade to build its feature index.`);
  };
  const avatar = (f?: File) => { if (!f) return; const r = new FileReader(); r.onload = () => setS((p) => ({ ...p, avatar: r.result as string })); r.readAsDataURL(f); };
  const a = s.analysis;
  return (
    <div>
      <h2>Voice Clone Laboratory</h2>
      <p className="sub">Create a singer from voices you own or have permission to use.</p>
      {err && <div className="notice bad" onClick={() => setErr(null)}>{err}</div>}
      {msg && <div className="notice ok">{msg} <button className="btn small" onClick={() => go('singers')}>My AI Singers</button></div>}
      <div className="card">
        <h3>What this lab can and cannot do</h3>
        <table><tbody>
          <tr><td><b>A. Voice analysis</b></td><td><span className="tag ok">implemented</span></td><td>Pitch range, median F0, spectral centroid, loudness, voiced ratio. Describes a voice; does not clone it.</td></tr>
          <tr><td><b>B. Zero-shot adaptation</b></td><td><span className="tag bad">not available</span></td><td>No zero-shot singing-VC model has been verified to run in iPhone Safari. Not offered rather than faked.</td></tr>
          <tr><td><b>A+. Feature index</b></td><td><span className="tag ok">v0.2</span></td><td>After saving, open My AI Singers → Edit / upgrade to build an RVC-style retrieval index from these samples, link RMVPE, and export a training dataset.</td></tr>
          <tr><td><b>C. Trained voice model</b></td><td><span className="tag ok">import</span></td><td>Import an RVC v1/v2 model exported to ONNX (trained elsewhere, e.g. RVC WebUI on a PC). In-browser training is not implemented — RVC training needs minutes of audio and GPU hours.</td></tr>
        </tbody></table>
      </div>
      <div className="card">
        <h3>Recording guidance</h3>
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--muted)' }}><li>Quiet room, minimal reverb, no backing music</li><li>Several clear phrases at different comfortable pitches</li><li>Clear vowels and consonants; avoid clipping</li><li>Analysis: 30 s+ is enough. Training an RVC model elsewhere: typically 10+ minutes of clean singing.</li></ul>
      </div>
      <div className="card">
        <h3>Samples</h3>
        <div className="row"><label className="btn">Add WAV/MP3…<input hidden multiple type="file" accept="audio/*" onChange={(e) => add(e.target.files)} /></label><button className={`btn ${rec ? 'danger' : ''}`} onClick={record}>{rec ? '■ Stop recording' : '● Record'}</button><button className="btn primary" disabled={!samples.length} onClick={runAnalysis}>Analyse voice</button></div>
        {samples.map((x, i) => <div key={i} style={{ marginTop: 8 }}><div className="row" style={{ justifyContent: 'space-between' }}><small>{x.name} · {(x.pcm.channels[0].length / x.pcm.sampleRate).toFixed(1)}s</small><div className="row"><PlayButton pcm={x.pcm} label={`smp${i}`} /><button className="btn small danger" onClick={() => setSamples((v) => v.filter((_, k) => k !== i))}>✕</button></div></div><Waveform pcm={x.pcm} height={50} /><QualityBadges r={checkQuality(x.pcm)} /></div>)}
        {a && <div className="stats" style={{ marginTop: 10 }}>
          <div className="stat"><small>Median F0</small><b>{a.medianF0.toFixed(0)} Hz</b></div>
          <div className="stat"><small>Range (5–95%)</small><b>{midiName(a.rangeLowMidi)}–{midiName(a.rangeHighMidi)}</b></div>
          <div className="stat"><small>Spectral centroid</small><b>{a.spectralCentroid.toFixed(0)} Hz</b></div>
          <div className="stat"><small>Loudness</small><b>{a.rmsDb.toFixed(1)} dBFS</b></div>
          <div className="stat"><small>Voiced</small><b>{Math.round(a.voicedRatio * 100)}%</b></div>
          <div className="stat"><small>Material</small><b>{a.seconds.toFixed(0)} s</b></div>
        </div>}
      </div>
      <div className="card">
        <h3>Profile</h3>
        <div className="row" style={{ marginBottom: 10 }}>{s.avatar ? <img className="avatar" src={s.avatar} /> : <div className="avatar">{s.name[0]}</div>}<label className="btn small">Avatar…<input hidden type="file" accept="image/*" onChange={(e) => avatar(e.target.files?.[0])} /></label></div>
        <div className="grid">
          <label className="field">Name<input type="text" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} /></label>
          <label className="field">Voice type<select value={s.voiceType} onChange={(e) => setS({ ...s, voiceType: e.target.value })}>{['Unspecified', 'Soprano', 'Mezzo-soprano', 'Alto', 'Tenor', 'Baritone', 'Bass'].map((v) => <option key={v}>{v}</option>)}</select></label>
          <label className="field">Comfortable range<div className="row"><input type="text" value={s.rangeLow} onChange={(e) => setS({ ...s, rangeLow: e.target.value })} style={{ width: 70 }} />–<input type="text" value={s.rangeHigh} onChange={(e) => setS({ ...s, rangeHigh: e.target.value })} style={{ width: 70 }} /></div></label>
          <label className="field">Default style<select value={s.defaultStyle} onChange={(e) => setS({ ...s, defaultStyle: e.target.value })}>{VOICE_STYLES.map((v) => <option key={v.name} disabled={v.kind.includes('unavailable')}>{v.name}</option>)}</select></label>
          <label className="field">Presentation (optional)<input type="text" value={s.presentation} onChange={(e) => setS({ ...s, presentation: e.target.value })} /></label>
          <label className="field">Description<textarea rows={2} value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} /></label>
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>Style controls: {VOICE_STYLES.map((v) => `${v.name} (${v.kind})`).join(' · ')}</p>
        <h3>Neural model (capability C)</h3>
        <ModelLinker singer={s} onChange={setS} />
        <p>Status: <span className={`tag ${s.capability === 'neural-rvc' ? 'ok' : 'warn'}`}>{s.capability === 'neural-rvc' ? 'Neural RVC model linked' : 'Analysis-only — cannot convert'}</span></p>
        <label><input type="checkbox" checked={s.permissionConfirmed} onChange={(e) => setS({ ...s, permissionConfirmed: e.target.checked })} /> I own this voice or have explicit permission from the voice owner to clone it.</label><br />
        <label><input type="checkbox" checked={s.syntheticLabel} onChange={(e) => setS({ ...s, syntheticLabel: e.target.checked })} /> Label exports from this singer as AI-generated (synthetic) content.</label>
        <div className="row" style={{ marginTop: 10 }}><button className="btn primary" onClick={save}>Save singer</button></div>
      </div>
    </div>
  );
}
