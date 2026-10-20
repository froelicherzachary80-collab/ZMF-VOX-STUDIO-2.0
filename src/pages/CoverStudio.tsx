import { useEffect, useMemo, useRef, useState } from 'react';
import { useStudio } from '../ui/studio';
import { decodeFile } from '../audio/decode';
import { analyze, type AudioStats } from '../audio/analysis';
import { centerSeparate } from '../audio/separation';
import { fmtDb, fmtTime, PlayButton, Progress, Slider, Waveform, WavButton } from '../ui/components';
import { listSingers, type Singer } from '../store/singers';
import { runCover, type CoverResult, type CoverSettings } from '../ai/coverPipeline';
import { HV_PRESETS } from '../audio/humanvoice';
import { QUALITY } from '../ai/capabilities';
import { renderMix } from '../audio/render';
import { midiToHz } from '../audio/pitch';
import type { PCM } from '../audio/pcm';

const noteHz = (n: string) => { const m = /^([A-G])(#?)(-?\d)$/.exec(n.trim()); if (!m) return null; const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]]!; return midiToHz(12 * (parseInt(m[3]) + 1) + base + (m[2] ? 1 : 0)); };

export default function CoverStudio({ go }: { go: (r: string) => void }) {
  const st = useStudio();
  const song = st.trackPCM('original'), vocal = st.trackPCM('vocal'), inst = st.trackPCM('instrumental'), converted = st.trackPCM('converted');
  const stats = (st.project.sourceStats as unknown as AudioStats | undefined) ?? null;
  const [busy, setBusy] = useState<string | null>(null); const [prog, setProg] = useState(0); const [err, setErr] = useState<string | null>(null);
  const [sepMethod, setSepMethod] = useState<string | null>(null);
  const [singers, setSingers] = useState<Singer[]>([]); const [singerId, setSingerId] = useState<string>(st.project.singerId ?? '');
  const [result, setResult] = useState<CoverResult | null>(null);
  const abort = useRef<AbortController | null>(null);
  const q = st.quality === 'CUSTOM' ? QUALITY.BALANCED : QUALITY[st.quality];
  const [cs, setCs] = useState<CoverSettings>({
    transpose: 0, f0Min: 65, f0Max: 1100, octaveCorrection: false, pitchCorrection: 0, vibrato: 1, stability: 0,
    chunkSeconds: q.chunkSeconds, crossfadeSeconds: q.crossfadeSeconds, voiceBlend: 1, consonantProtection: 0.3, expressionPreservation: 0.6,
    humanVoice: { ...HV_PRESETS['Natural Studio'] }, previewSeconds: q.previewSeconds, previewStart: 0,
  });
  const [preset, setPreset] = useState('Natural Studio');
  const [rangeLow, setRangeLow] = useState('C3'); const [rangeHigh, setRangeHigh] = useState('C5');
  useEffect(() => { listSingers().then(setSingers); }, []);
  const singer = singers.find((s) => s.id === singerId);
  useEffect(() => { if (singer) { setCs((c) => ({ ...c, transpose: singer.transpose, humanVoice: { ...singer.humanVoice } })); setRangeLow(singer.rangeLow); setRangeHigh(singer.rangeHigh); } }, [singerId]); // eslint-disable-line
  const set = <K extends keyof CoverSettings>(k: K, v: CoverSettings[K]) => setCs((c) => ({ ...c, [k]: v }));
  const hv = (k: keyof CoverSettings['humanVoice'], v: number | boolean) => setCs((c) => ({ ...c, humanVoice: { ...c.humanVoice, [k]: v } }));

  const importSong = async (f: File) => {
    setErr(null); setBusy('Decoding locally'); setProg(0.1);
    try {
      const pcm = await decodeFile(f); setProg(0.5); setBusy('Analysing');
      await new Promise((r) => setTimeout(r, 20));
      const s = analyze(pcm);
      st.create(f.name.replace(/\.[^.]+$/, ''));
      await new Promise((r) => setTimeout(r));
      const ot = await st.addTrack(pcm, `Song: ${f.name}`, 'original', 'imported (muted in mix)');
      st.updateTrack(ot.id, { mute: true });
      st.setProject((p) => ({ ...p, sourceStats: s as any }));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); setProg(0); }
  };
  const separate = async () => {
    if (!song) return; setErr(null); setBusy('Separating (DSP center extraction)'); abort.current = new AbortController();
    try {
      const r = await centerSeparate(song, { onProgress: setProg, signal: abort.current.signal });
      setSepMethod(r.method);
      await st.addTrack(r.vocal, 'Vocal stem', 'vocal', r.method, true);
      await st.addTrack(r.instrumental, 'Instrumental stem', 'instrumental', r.method, true);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); setProg(0); }
  };
  const manualStem = async (f: File, kind: 'vocal' | 'instrumental') => {
    setBusy('Decoding stem'); try { await st.addTrack(await decodeFile(f), kind === 'vocal' ? 'Vocal stem (manual)' : 'Instrumental (manual)', kind, 'user-supplied stem', true); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const convert = async (full: boolean) => {
    if (!vocal || !singer) return; setErr(null); setResult(null); abort.current = new AbortController();
    const lo = noteHz(rangeLow), hi = noteHz(rangeHigh);
    const settings: CoverSettings = { ...cs, previewSeconds: full ? null : cs.previewSeconds, f0Min: cs.octaveCorrection && lo ? lo : 50, f0Max: cs.octaveCorrection && hi ? hi : 1100 };
    try {
      const r = await runCover(vocal, singer, settings, q.backend, (s, f) => { setBusy(s); setProg(f); }, abort.current.signal);
      setResult(r);
      if (full) {
        await st.addTrack(r.processed, `Converted: ${singer.name}`, 'converted', `neural RVC (${r.backend}) + HUMANVOICE`, true);
        st.setProject((p) => ({ ...p, singerId: singer.id, syntheticContent: true }));
        const { saveSinger } = await import('../store/singers');
        await saveSinger({ ...singer, recentProjects: [st.project.id, ...singer.recentProjects.filter((x) => x !== st.project.id)].slice(0, 10) });
      }
    } catch (e) {
      const m = (e as Error).message;
      setErr(/memory|OOM|allocation/i.test(m) ? `Out of memory: ${m}. Try LIGHT mode in Settings (smaller chunks, WASM), or a shorter preview.` : m);
    } finally { setBusy(null); setProg(0); }
  };
  const mixPreview = useMemo(() => async (): Promise<PCM | undefined> => renderMix(st.project.tracks.filter((t) => t.kind === 'converted' || t.kind === 'instrumental'), st.pcms, st.project.master), [st.project, st.version]); // eslint-disable-line

  return (
    <div>
      <h2>AI Cover Studio</h2>
      <p className="sub">Everything below runs in this browser. Nothing is uploaded.</p>
      {err && <div className="notice bad">{err}</div>}
      {busy && <div className="card"><div className="row" style={{ justifyContent: 'space-between' }}><span>{busy}</span><span>{Math.round(prog * 100)}%</span></div><Progress value={prog} /><div className="row" style={{ marginTop: 8 }}><button className="btn small danger" onClick={() => abort.current?.abort()}>Cancel</button></div></div>}

      <div className="card">
        <div className="step"><span className="n">1</span><h3>Import song (MP3 / WAV)</h3></div>
        <input type="file" accept="audio/*,.mp3,.wav,.m4a" onChange={(e) => e.target.files?.[0] && importSong(e.target.files[0])} />
        {song && <>
          <div style={{ marginTop: 10 }}><Waveform pcm={song} playLabel="song" /></div>
          <div className="row" style={{ marginTop: 8 }}><PlayButton pcm={song} label="song" /><span className="tag">tap waveform to seek · pinch/scroll to zoom · drag to pan</span></div>
        </>}
        {stats && <div className="stats" style={{ marginTop: 10 }}>
          <div className="stat"><small>Length</small><b>{fmtTime(stats.duration)}</b></div>
          <div className="stat"><small>Sample rate</small><b>{stats.sampleRate} Hz</b></div>
          <div className="stat"><small>Channels</small><b>{stats.channels}</b></div>
          <div className="stat"><small>Peak</small><b>{fmtDb(stats.peakDb)}</b></div>
          <div className="stat"><small>RMS</small><b>{fmtDb(stats.rmsDb)}</b></div>
          <div className="stat"><small>Est. BPM</small><b>{stats.bpm ?? '—'}</b> <span className={`tag ${stats.bpmConfidence > 0.5 ? 'ok' : 'warn'}`}>{Math.round(stats.bpmConfidence * 100)}% conf.</span></div>
          <div className="stat"><small>Est. key</small><b>{stats.key ?? '—'}</b> <span className={`tag ${stats.keyConfidence > 0.4 ? 'ok' : 'warn'}`}>{Math.round(stats.keyConfidence * 100)}%</span>{stats.keyConfidence < 0.4 && <small>or {stats.keyAlternative}</small>}</div>
        </div>}
        {stats && <p className="sub" style={{ fontSize: 12, marginTop: 6 }}>MP3 sample rate reflects the browser decoder's output rate. BPM/key are estimates (onset autocorrelation; Krumhansl key profiles).</p>}
      </div>

      <div className="card">
        <div className="step"><span className="n">2</span><h3>Separate vocals / instrumental</h3></div>
        <div className="notice">No neural separation model (Demucs/MDX ONNX) is bundled or verified on iPhone yet. The built-in method is <b>DSP center-channel extraction</b> — real processing, but much weaker than neural separation, and it works poorly on mono or heavily-reverbed mixes. For best results, supply stems made elsewhere.</div>
        <div className="row">
          <button className="btn primary" disabled={!song || !!busy} onClick={separate}>Run DSP separation</button>
          <label className="btn">Vocal stem…<input hidden type="file" accept="audio/*" onChange={(e) => e.target.files?.[0] && manualStem(e.target.files[0], 'vocal')} /></label>
          <label className="btn">Instrumental…<input hidden type="file" accept="audio/*" onChange={(e) => e.target.files?.[0] && manualStem(e.target.files[0], 'instrumental')} /></label>
        </div>
        {sepMethod && <p><span className="tag v">{sepMethod}</span></p>}
        {vocal && <><p>Vocal stem <WavButton pcm={vocal} name="vocal-stem" /></p><Waveform pcm={vocal} playLabel="vocal" color="#67e8f9" /><PlayButton pcm={vocal} label="vocal" /></>}
        {inst && <><p>Instrumental <WavButton pcm={inst} name="instrumental" /></p><Waveform pcm={inst} playLabel="inst" color="#34d399" /><PlayButton pcm={inst} label="inst" /></>}
      </div>

      <div className="card">
        <div className="step"><span className="n">3</span><h3>Select AI voice</h3></div>
        {!singers.length && <div className="notice info">No singers yet. Create one in the Voice Clone Laboratory and link an RVC ONNX model you're permitted to use. ZMF ships no bundled voices.</div>}
        <select value={singerId} onChange={(e) => setSingerId(e.target.value)}>
          <option value="">— choose singer —</option>
          {singers.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.capability === 'neural-rvc' ? 'neural RVC model' : 'analysis-only (cannot convert)'}</option>)}
        </select>
        {singer && singer.capability !== 'neural-rvc' && <div className="notice bad">This profile has only an analysis — no neural model is linked, so it cannot convert a voice. Link a model in My AI Singers → Edit.</div>}
      </div>

      <div className="card">
        <div className="step"><span className="n">4</span><h3>Voice settings</h3></div>
        <div className="grid">
          <Slider label="Pitch transpose" unit=" st" min={-24} max={24} value={cs.transpose} onChange={(v) => set('transpose', v)} note="neural" />
          <label className="field">Target range (with octave correction)<div className="row"><input type="text" value={rangeLow} onChange={(e) => setRangeLow(e.target.value)} style={{ width: 70 }} />–<input type="text" value={rangeHigh} onChange={(e) => setRangeHigh(e.target.value)} style={{ width: 70 }} /><label><input type="checkbox" checked={cs.octaveCorrection} onChange={(e) => set('octaveCorrection', e.target.checked)} /> auto-octave</label></div></label>
          <Slider label="Timbre intensity / voice blend" min={0} max={1} step={0.05} value={cs.voiceBlend} onChange={(v) => set('voiceBlend', v)} note="mix" />
          <Slider label="Pitch correction" min={0} max={1} step={0.05} value={cs.pitchCorrection} onChange={(v) => set('pitchCorrection', v)} note="F0 → model" />
          <Slider label="Vibrato amount" min={0} max={2} step={0.05} value={cs.vibrato} onChange={(v) => set('vibrato', v)} note="F0 → model" />
          <Slider label="Vocal stability" min={0} max={1} step={0.05} value={cs.stability} onChange={(v) => set('stability', v)} note="F0 smoothing" />
          <Slider label="Consonant / unvoiced preservation" min={0} max={1} step={0.05} value={cs.consonantProtection} onChange={(v) => set('consonantProtection', v)} note="blend" />
          <Slider label="Original expression preservation" min={0} max={1} step={0.05} value={cs.expressionPreservation} onChange={(v) => set('expressionPreservation', v)} note="envelope" />
          <label className="field">Formant shift<span className="tag warn">Not supported by RVC ONNX path — disabled</span></label>
        </div>
        <h3 style={{ marginTop: 14 }}>HUMANVOICE ENGINE <span className="tag">post-production DSP</span></h3>
        <div className="row" style={{ marginBottom: 8 }}>
          <select value={preset} onChange={(e) => { setPreset(e.target.value); setCs((c) => ({ ...c, humanVoice: { ...HV_PRESETS[e.target.value] } })); }} style={{ maxWidth: 240 }}>{Object.keys(HV_PRESETS).map((k) => <option key={k}>{k}</option>)}</select>
        </div>
        <div className="grid">
          <Slider label="Breathiness / air" unit=" dB" min={-6} max={8} step={0.5} value={cs.humanVoice.air} onChange={(v) => hv('air', v)} />
          <Slider label="Brightness" unit=" dB" min={-8} max={8} step={0.5} value={cs.humanVoice.brightness} onChange={(v) => hv('brightness', v)} />
          <Slider label="Warmth" unit=" dB" min={-6} max={8} step={0.5} value={cs.humanVoice.warmth} onChange={(v) => hv('warmth', v)} />
          <Slider label="Presence" unit=" dB" min={-6} max={6} step={0.5} value={cs.humanVoice.presence} onChange={(v) => hv('presence', v)} />
          <Slider label="Dynamics (gentle compression)" min={0} max={1} step={0.05} value={cs.humanVoice.naturalDynamics} onChange={(v) => hv('naturalDynamics', v)} />
          <Slider label="Sibilance control" min={0} max={1} step={0.05} value={cs.humanVoice.sibilance} onChange={(v) => hv('sibilance', v)} />
          <Slider label="Harmonic saturation" min={0} max={1} step={0.05} value={cs.humanVoice.saturation} onChange={(v) => hv('saturation', v)} />
          <Slider label="Breath preservation" min={0} max={1} step={0.05} value={cs.humanVoice.breathPreservation} onChange={(v) => hv('breathPreservation', v)} />
          <Slider label="Noise gate" unit=" dB" min={-90} max={-30} value={cs.humanVoice.noiseGateDb} onChange={(v) => hv('noiseGateDb', v)} note="-90 = off" />
          <label className="field"><span><input type="checkbox" checked={cs.humanVoice.declick} onChange={(e) => hv('declick', e.target.checked)} /> De-click</span></label>
        </div>
      </div>

      <div className="card">
        <div className="step"><span className="n">5</span><h3>Convert (neural RVC)</h3></div>
        <div className="grid">
          <Slider label="Preview length" unit=" s" min={5} max={30} value={cs.previewSeconds ?? 15} onChange={(v) => set('previewSeconds', v)} />
          <Slider label="Preview start" unit=" s" min={0} max={Math.max(0, Math.floor((vocal?.channels[0].length ?? 0) / (vocal?.sampleRate ?? 1)) - 5)} value={cs.previewStart} onChange={(v) => set('previewStart', v)} />
          <Slider label="Chunk size" unit=" s" min={3} max={30} value={cs.chunkSeconds} onChange={(v) => set('chunkSeconds', v)} />
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" disabled={!vocal || !singer || !!busy || singer?.capability !== 'neural-rvc'} onClick={() => convert(false)}>Preview {cs.previewSeconds}s</button>
          <button className="btn primary" disabled={!vocal || !singer || !!busy || singer?.capability !== 'neural-rvc'} onClick={() => convert(true)}>Render full vocal</button>
        </div>
        {result && <div style={{ marginTop: 10 }}>
          <div className="notice ok">Converted {result.source.channels[0].length / result.source.sampleRate | 0}s in {result.seconds.toFixed(1)}s on <b>{result.backend}</b>. Measured: log-spectral distance from source <b>{result.measured.spectralDiff.toFixed(1)} dB</b>, melody (log-F0) correlation <b>{isNaN(result.measured.pitchCorrelation) ? 'n/a' : result.measured.pitchCorrelation.toFixed(2)}</b>.</div>
          <h3>A/B comparison</h3>
          <div className="row"><PlayButton pcm={result.source} label="ab-src" text="Source voice" /><PlayButton pcm={result.dry} label="ab-dry" text="Dry converted" /><PlayButton pcm={result.processed} label="ab-proc" text="Processed" /><WavButton pcm={result.dry} name="converted-dry" /></div>
          <Waveform pcm={result.processed} playLabel="ab-proc" />
        </div>}
        {converted && <><p>Full converted vocal in project <WavButton pcm={converted} name="converted-vocal" /></p><Waveform pcm={converted} playLabel="conv" color="#f0abfc" /></>}
      </div>

      <div className="card">
        <div className="step"><span className="n">6</span><h3>Recombine, master and export</h3></div>
        <div className="row">
          <PlayButton pcm={converted && inst ? mixPreview : undefined} label="cover-mix" text="Play cover mix" />
          <button className="btn" onClick={() => go('mixer')}>Open Mixer</button><button className="btn" onClick={() => go('master')}>Mastering</button><button className="btn primary" onClick={() => go('export')}>Export</button>
        </div>
      </div>
    </div>
  );
}
