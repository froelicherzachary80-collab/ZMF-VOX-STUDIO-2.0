import { useEffect, useState } from 'react';
import { detectCapabilities, QUALITY, type Capabilities, type QualityMode } from '../ai/capabilities';
import { useStudio } from '../ui/studio';
import { releaseEngine } from '../ai/coverPipeline';

export default function Settings() {
  const st = useStudio(); const [cap, setCap] = useState<Capabilities | null>(null); const [sw, setSw] = useState('checking');
  const [netLog, setNetLog] = useState<string[]>([]);
  useEffect(() => {
    detectCapabilities().then(setCap);
    navigator.serviceWorker?.getRegistration().then((r) => setSw(r?.active ? 'active (offline cache on)' : 'not active'));
    const entries = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => !n.startsWith(location.origin));
    setNetLog(entries);
  }, []);
  return (
    <div>
      <h2>Settings</h2>
      <div className="card"><h3>Quality mode</h3>
        <div className="row">{(['LIGHT', 'BALANCED', 'HIGH', 'CUSTOM'] as QualityMode[]).map((q) => <button key={q} className={`btn ${st.quality === q ? 'primary' : ''}`} onClick={() => st.setQuality(q)}>{q}</button>)}</div>
        <p className="sub" style={{ marginTop: 8 }}>{st.quality === 'CUSTOM' ? 'Custom: chunk size / preview length are set per job in Cover Studio.' : `Chunks ${QUALITY[st.quality].chunkSeconds}s, crossfade ${QUALITY[st.quality].crossfadeSeconds}s, backend ${QUALITY[st.quality].backend}, preview ${QUALITY[st.quality].previewSeconds}s, max loaded model sets ${QUALITY[st.quality].maxLoadedModels}.`}</p>
        <button className="btn" onClick={() => releaseEngine()}>Release loaded models (free memory)</button>
      </div>
      <div className="card"><h3>Device compatibility</h3>{cap ? <table><tbody>
        {Object.entries(cap).filter(([k]) => k !== 'gpuFeatures').map(([k, v]) => <tr key={k}><td>{k}</td><td>{String(v)}</td></tr>)}
        <tr><td>serviceWorker status</td><td>{sw}</td></tr>
      </tbody></table> : 'Detecting…'}
        {cap && !cap.crossOriginIsolated && <div className="notice">Not cross-origin isolated → ONNX Runtime runs single-threaded WASM. Hosting with COOP/COEP headers (see public/_headers) enables threads.</div>}
        {cap?.isIOS && <div className="notice">iOS may suspend Safari in the background; keep the screen on during long renders. Background processing is not guaranteed.</div>}
      </div>
      <div className="card"><h3>Privacy check</h3><p className="sub">Cross-origin network requests made by this page since load (audio is never sent):</p>
        {netLog.length ? <ul>{netLog.map((n) => <li key={n} style={{ fontSize: 12 }}>{n}</li>)}</ul> : <span className="tag ok">none</span>}
      </div>
    </div>
  );
}
