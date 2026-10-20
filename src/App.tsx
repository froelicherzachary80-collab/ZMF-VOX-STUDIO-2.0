import { lazy, Suspense, useEffect, useState } from 'react';
import { useStudio } from './ui/studio';
import { player, type PlayerState } from './ui/player';
import { fmtTime } from './ui/components';
import Dashboard from './pages/Dashboard';
import CoverStudio from './pages/CoverStudio';

const VoiceLab = lazy(() => import('./pages/VoiceLab')); const Singers = lazy(() => import('./pages/Singers'));
const VocalEditor = lazy(() => import('./pages/VocalEditor')); const PitchEditor = lazy(() => import('./pages/PitchEditor'));
const Harmony = lazy(() => import('./pages/Harmony')); const Mixer = lazy(() => import('./pages/Mixer'));
const Mastering = lazy(() => import('./pages/Mastering')); const ModelManager = lazy(() => import('./pages/ModelManager'));
const Library = lazy(() => import('./pages/Library')); const ExportStudio = lazy(() => import('./pages/Export'));
const Settings = lazy(() => import('./pages/Settings'));

const ROUTES: [string, string, string][] = [
  ['dash', '◈', 'Studio Dashboard'], ['cover', '♫', 'AI Cover Studio'], ['lab', '⚗', 'Voice Clone Laboratory'], ['singers', '☺', 'My AI Singers'],
  ['vocal', '〰', 'Vocal Editor'], ['pitch', '♪', 'Pitch & Melody Editor'], ['harmony', '♬', 'Harmony Studio'], ['mixer', '⫼', 'Audio Mixer'],
  ['master', '◎', 'Mastering Suite'], ['models', '⬢', 'Model Manager'], ['library', '▤', 'Project Library'], ['export', '⇪', 'Export Studio'], ['settings', '⚙', 'Settings'],
];

export default function App() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || 'dash');
  const [open, setOpen] = useState(false); const [ps, setPs] = useState<PlayerState>(player.state);
  const st = useStudio();
  useEffect(() => player.subscribe(setPs), []);
  useEffect(() => { const h = () => setRoute(location.hash.slice(1) || 'dash'); addEventListener('hashchange', h); return () => removeEventListener('hashchange', h); }, []);
  const go = (r: string) => { location.hash = r; setOpen(false); };
  const page = (() => { switch (route) {
    case 'cover': return <CoverStudio go={go} />; case 'lab': return <VoiceLab go={go} />; case 'singers': return <Singers go={go} />;
    case 'vocal': return <VocalEditor />; case 'pitch': return <PitchEditor />; case 'harmony': return <Harmony />; case 'mixer': return <Mixer />;
    case 'master': return <Mastering />; case 'models': return <ModelManager />; case 'library': return <Library go={go} />;
    case 'export': return <ExportStudio />; case 'settings': return <Settings />; default: return <Dashboard go={go} />;
  } })();
  return (
    <div className="app">
      <nav className={`drawer ${open ? 'open' : ''}`}>
        <h1>ZMF VOX <span>STUDIO+</span></h1>
        {ROUTES.map(([id, icon, name]) => <a key={id} className={route === id ? 'active' : ''} onClick={() => go(id)}><span style={{ width: 18, textAlign: 'center' }}>{icon}</span>{name}</a>)}
        <p style={{ fontSize: 11, color: 'var(--muted)', margin: '16px 12px' }}>v0.1 · all processing on-device</p>
      </nav>
      <div className={`scrim ${open ? 'open' : ''}`} onClick={() => setOpen(false)} />
      <main className="main" key={route}>
        <div className="topbar"><button className="burger" aria-label="Menu" onClick={() => setOpen(true)}>☰</button><b>ZMF VOX <span style={{ color: 'var(--violet)' }}>STUDIO+</span></b></div>
        <Suspense fallback={<p>Loading…</p>}>{page}</Suspense>
      </main>
      <div className="transport">
        <button className="btn small" disabled={!ps.playing} onClick={() => player.stop()}>■</button>
        <small style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '35%' }}>{ps.label ?? 'Idle'} {ps.playing && `${fmtTime(ps.position)} / ${fmtTime(ps.duration)}`}</small>
        <div className="lvl"><i style={{ width: `${Math.min(100, Math.max(ps.levelL, ps.levelR) * 100)}%` }} /></div>
        <small>{st.project.name}</small>
      </div>
    </div>
  );
}
