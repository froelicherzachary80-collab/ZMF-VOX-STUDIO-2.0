import { useEffect, useState } from 'react';
import { detectCapabilities, type Capabilities } from '../ai/capabilities';
import { useStudio } from '../ui/studio';
import { listModels } from '../store/models';
import { listSingers } from '../store/singers';

export const STATUS: [string, 'ok' | 'warn' | 'bad', string][] = [
  ['Local MP3/WAV import, waveform, analysis', 'ok', 'implemented + unit-tested'],
  ['WAV / MP3 export', 'ok', 'implemented + unit-tested (LAME)'],
  ['DSP vocal separation', 'warn', 'center-channel mask; not neural'],
  ['Neural (Demucs) separation', 'bad', 'not integrated'],
  ['RVC ONNX voice conversion', 'warn', 'implemented; needs your models; not yet verified on iPhone'],
  ['Target-voice feature index (retrieval) + protect', 'ok', 'v0.2; built from your samples; unit + e2e tested'],
  ['RMVPE pitch extractor', 'warn', 'v0.2 adapter; needs rmvpe.onnx; not validated with real weights'],
  ['Quality check · timbre match · dataset export', 'ok', 'v0.2; unit + e2e tested'],
  ['Zero-shot voice cloning', 'bad', 'not available'],
  ['In-browser training', 'bad', 'not available'],
  ['Pitch editing / harmonies (DSP)', 'ok', 'implemented + unit-tested'],
  ['Mixer / mastering / loudness meters', 'ok', 'implemented; LUFS unit-tested'],
  ['Offline PWA', 'warn', 'service worker implemented; verify on device'],
];

export default function Dashboard({ go }: { go: (r: string) => void }) {
  const st = useStudio(); const [cap, setCap] = useState<Capabilities | null>(null); const [counts, setCounts] = useState({ models: 0, singers: 0 });
  useEffect(() => { detectCapabilities().then(setCap); Promise.all([listModels(), listSingers()]).then(([m, s]) => setCounts({ models: m.length, singers: s.length })); }, []);
  return (
    <div>
      <h2>Studio Dashboard</h2>
      <p className="sub">Local-only AI singing studio. No account, no uploads, no API keys.</p>
      <div className="grid">
        <div className="card"><h3>Current project</h3><b>{st.project.name}</b><p className="sub">{st.project.tracks.length} tracks{st.savedAt ? ` · saved ${new Date(st.savedAt).toLocaleTimeString()}` : ''}</p><button className="btn primary" onClick={() => go('cover')}>Open Cover Studio</button></div>
        <div className="card"><h3>Voices & models</h3><p>{counts.singers} singers · {counts.models} models installed</p><div className="row"><button className="btn" onClick={() => go('lab')}>Voice Lab</button><button className="btn" onClick={() => go('models')}>Models</button></div></div>
        <div className="card"><h3>This device</h3>{cap ? <>
          <p style={{ margin: 0 }}>WebGPU: <span className={`tag ${cap.webgpu ? 'ok' : 'warn'}`}>{cap.webgpu ? cap.gpuAdapter : 'unavailable → WASM'}</span></p>
          <p style={{ margin: '4px 0' }}>WASM SIMD: <span className={`tag ${cap.wasmSimd ? 'ok' : 'warn'}`}>{cap.wasmSimd ? 'yes' : 'no'}</span> Threads: <span className={`tag ${cap.wasmThreads ? 'ok' : 'warn'}`}>{cap.wasmThreads ? 'yes' : 'single-thread'}</span></p>
          <p style={{ margin: 0 }}>Recommended mode: <b>{cap.recommendedMode}</b> (current {st.quality})</p></> : 'Detecting…'}</div>
      </div>
      <div className="card"><h3>Honest feature status</h3><table><tbody>{STATUS.map(([f, s, n]) => <tr key={f}><td>{f}</td><td><span className={`tag ${s}`}>{s === 'ok' ? 'working' : s === 'warn' ? 'partial' : 'missing'}</span></td><td style={{ color: 'var(--muted)' }}>{n}</td></tr>)}</tbody></table></div>
    </div>
  );
}
