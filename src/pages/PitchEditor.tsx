import { useEffect, useMemo, useRef, useState } from 'react';
import { useStudio } from '../ui/studio';
import { yin, segmentNotes, midiName, hzToMidi, type Note, type F0Track } from '../audio/pitch';
import { renderNotes } from '../audio/noteRender';
import { slicePCM, toMono } from '../audio/pcm';
import { PlayButton, Slider } from '../ui/components';

const SCALES: Record<string, number[]> = { chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Piano-roll editor. Edits are rendered by real DSP (granular pitch shift + gain) on "Render". */
export default function PitchEditor() {
  const st = useStudio();
  const tracks = st.project.tracks.filter((t) => ['vocal', 'converted', 'harmony'].includes(t.kind));
  const [trackId, setTrackId] = useState(st.project.notesTrackId ?? tracks[0]?.id ?? '');
  const track = tracks.find((t) => t.id === trackId); const pcm = track ? st.pcms.get(track.assetId) : undefined;
  const [notes, setNotes] = useState<Note[]>(st.project.notes ?? []);
  const [hist, setHist] = useState<Note[][]>([]); const [fut, setFut] = useState<Note[][]>([]);
  const [sel, setSel] = useState<string | null>(null); const [track0, setTrack0] = useState<F0Track | null>(null);
  const [view, setView] = useState<[number, number]>([0, 10]); const [range, setRange] = useState<[number, number]>([45, 84]);
  const [key, setKey] = useState(0); const [scale, setScale] = useState('major'); const [full, setFull] = useState(false);
  const [rendered, setRendered] = useState<import('../audio/pcm').PCM | null>(null); const [busy, setBusy] = useState(false);
  const cv = useRef<HTMLCanvasElement>(null);
  const commit = (n: Note[]) => { setHist((h) => [...h.slice(-50), notes]); setFut([]); setNotes(n); };
  const undo = () => { const p = hist.at(-1); if (!p) return; setFut((f) => [notes, ...f]); setHist((h) => h.slice(0, -1)); setNotes(p); };
  const redo = () => { const n = fut[0]; if (!n) return; setHist((h) => [...h, notes]); setFut((f) => f.slice(1)); setNotes(n); };
  useEffect(() => { st.setProject((p) => ({ ...p, notes, notesTrackId: trackId })); }, [notes, trackId]); // eslint-disable-line

  const detect = () => {
    if (!pcm) return; setBusy(true);
    setTimeout(() => {
      const t = yin(toMono(pcm), pcm.sampleRate, { hop: Math.round(pcm.sampleRate / 100) }); setTrack0(t);
      const n = segmentNotes(t); commit(n);
      const ms = n.map((x) => x.midi); if (ms.length) setRange([Math.min(...ms) - 5, Math.max(...ms) + 5]);
      setBusy(false);
    }, 20);
  };
  useEffect(() => { if (pcm && !track0) setTrack0(yin(toMono(pcm), pcm.sampleRate, { hop: Math.round(pcm.sampleRate / 100) })); }, [pcm]); // eslint-disable-line

  const dur = pcm ? pcm.channels[0].length / pcm.sampleRate : 10;
  useEffect(() => {
    const c = cv.current; if (!c) return; const dpr = devicePixelRatio || 1; const W = c.clientWidth * dpr, H = c.clientHeight * dpr; c.width = W; c.height = H;
    const g = c.getContext('2d')!; const rows = range[1] - range[0];
    const X = (t: number) => ((t - view[0]) / (view[1] - view[0])) * W, Y = (m: number) => H - ((m - range[0]) / rows) * H;
    for (let m = range[0]; m < range[1]; m++) {
      const inScale = SCALES[scale].includes(((m - key) % 12 + 12) % 12);
      g.fillStyle = inScale ? (m % 12 === key ? '#2a2342' : '#17132a') : '#0a0812'; g.fillRect(0, Y(m + 1), W, H / rows - 0.5);
      if (m % 12 === 0) { g.fillStyle = '#9a93b5'; g.font = `${10 * dpr}px sans-serif`; g.fillText(midiName(m), 3, Y(m) - 3); }
    }
    for (let s = Math.ceil(view[0]); s < view[1]; s++) { g.fillStyle = '#ffffff10'; g.fillRect(X(s), 0, 1, H); }
    for (const n of notes) {
      g.fillStyle = n.id === sel ? '#f0abfc' : n.midi !== Math.round(n.detectedMidi) ? '#a78bfa' : '#7c3aed';
      g.fillRect(X(n.start), Y(n.midi + 0.5), Math.max(2, X(n.end) - X(n.start)), H / rows);
    }
    if (track0) {
      g.strokeStyle = '#67e8f9'; g.lineWidth = 1.5 * dpr; g.beginPath(); let pen = false;
      const fps = track0.sampleRate / track0.hop;
      for (let i = Math.floor(view[0] * fps); i < Math.min(track0.f0.length, view[1] * fps); i++) { const f = track0.f0[i]; if (f > 0) { const x = X(i / fps), y = Y(hzToMidi(f)); pen ? g.lineTo(x, y) : g.moveTo(x, y); pen = true; } else pen = false; }
      g.stroke();
    }
  }, [notes, sel, view, range, key, scale, track0, full]);

  const drag = useRef<{ id: string; mode: 'move' | 'l' | 'r'; x: number; y: number; orig: Note } | null>(null);
  const hit = (e: React.PointerEvent) => {
    const r = cv.current!.getBoundingClientRect(); const t = view[0] + ((e.clientX - r.left) / r.width) * (view[1] - view[0]); const m = range[0] + (1 - (e.clientY - r.top) / r.height) * (range[1] - range[0]);
    const n = notes.find((x) => t >= x.start && t <= x.end && Math.abs(m - x.midi) < 0.9); const edge = n ? ((e.clientX - r.left) / r.width) * (view[1] - view[0]) : 0;
    return { n, t, m, edge };
  };
  const selNote = notes.find((n) => n.id === sel);
  const upd = (patch: Partial<Note>) => sel && commit(notes.map((n) => (n.id === sel ? { ...n, ...patch } : n)));
  const split = () => { if (!selNote) return; const mid = (selNote.start + selNote.end) / 2; commit(notes.flatMap((n) => (n.id === sel ? [{ ...n, end: mid }, { ...n, id: n.id + 'b' + Date.now(), start: mid }] : n))); };
  const merge = () => { if (!selNote) return; const i = notes.findIndex((n) => n.id === sel); const nx = notes[i + 1]; if (!nx) return; commit([...notes.slice(0, i), { ...selNote, end: nx.end }, ...notes.slice(i + 2)]); };
  const snapAll = () => commit(notes.map((n) => { let best = n.midi, d = 99; for (let m = Math.floor(n.detectedMidi) - 2; m <= Math.ceil(n.detectedMidi) + 2; m++) if (SCALES[scale].includes(((m - key) % 12 + 12) % 12) && Math.abs(m - n.detectedMidi) < d) { d = Math.abs(m - n.detectedMidi); best = m; } return { ...n, midi: best }; }));
  const render = async (phrase: boolean) => {
    if (!pcm) return; setBusy(true); await new Promise((r) => setTimeout(r, 20));
    if (phrase && selNote) { const a = Math.max(0, selNote.start - 0.5), b = selNote.end + 0.5; const seg = slicePCM(pcm, a, b); const out = renderNotes(seg, notes.filter((n) => n.end > a && n.start < b).map((n) => ({ ...n, start: n.start - a, end: n.end - a }))); setRendered(out); }
    else setRendered(renderNotes(pcm, notes));
    setBusy(false);
  };
  const apply = async () => { if (!rendered || !track || rendered.channels[0].length !== pcm!.channels[0].length) return; await st.replaceAsset(track.id, rendered, `${track.provenance ?? ''} + note edits (DSP)`); setRendered(null); setTrack0(null); };
  const original = useMemo(() => (pcm && selNote ? slicePCM(pcm, Math.max(0, selNote.start - 0.5), selNote.end + 0.5) : pcm), [pcm, selNote]);

  const body = (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <select value={trackId} onChange={(e) => { setTrackId(e.target.value); setTrack0(null); }} style={{ maxWidth: 220 }}>{tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <button className="btn" disabled={!pcm || busy} onClick={detect}>Detect notes</button>
        <select value={key} onChange={(e) => setKey(+e.target.value)} style={{ width: 70 }}>{KEYS.map((k, i) => <option key={k} value={i}>{k}</option>)}</select>
        <select value={scale} onChange={(e) => setScale(e.target.value)} style={{ width: 110 }}>{Object.keys(SCALES).map((s) => <option key={s}>{s}</option>)}</select>
        <button className="btn small" onClick={snapAll} disabled={!notes.length}>Snap to scale</button>
        <button className="btn small" onClick={undo} disabled={!hist.length}>Undo</button><button className="btn small" onClick={redo} disabled={!fut.length}>Redo</button>
        <button className="btn small" onClick={() => setFull(!full)}>{full ? 'Exit full screen' : 'Full screen'}</button>
      </div>
      <canvas ref={cv} className="roll"
        onWheel={(e) => { const span = Math.min(dur, Math.max(0.5, (view[1] - view[0]) * (e.deltaY > 0 ? 1.15 : 0.87))); const s = Math.max(0, Math.min(dur - span, view[0])); setView([s, s + span]); }}
        onPointerDown={(e) => { cv.current!.setPointerCapture(e.pointerId); const h = hit(e); if (h.n) { setSel(h.n.id); const w = (h.n.end - h.n.start) * 0.2; drag.current = { id: h.n.id, mode: h.t < h.n.start + w ? 'l' : h.t > h.n.end - w ? 'r' : 'move', x: e.clientX, y: e.clientY, orig: h.n }; } else { setSel(null); drag.current = { id: '', mode: 'move', x: e.clientX, y: e.clientY, orig: null as any }; } }}
        onPointerMove={(e) => {
          const d = drag.current; if (!d) return; const r = cv.current!.getBoundingClientRect();
          const dt = ((e.clientX - d.x) / r.width) * (view[1] - view[0]), dm = Math.round(-((e.clientY - d.y) / r.height) * (range[1] - range[0]));
          if (!d.id) { const span = view[1] - view[0]; const s = Math.max(0, Math.min(dur - span, view[0] - dt)); setView([s, s + span]); d.x = e.clientX; return; }
          setNotes((ns) => ns.map((n) => n.id !== d.id ? n : d.mode === 'move' ? { ...n, midi: d.orig.midi + dm } : d.mode === 'l' ? { ...n, start: Math.min(n.end - 0.03, d.orig.start + dt) } : { ...n, end: Math.max(n.start + 0.03, d.orig.end + dt) }));
        }}
        onPointerUp={() => { if (drag.current?.id) setHist((h) => [...h, notes.map((n) => (n.id === drag.current!.id ? drag.current!.orig : n))]); drag.current = null; }} />
      <div className="row" style={{ marginTop: 6 }}><Slider label="Zoom (s visible)" min={1} max={Math.max(2, Math.ceil(dur))} value={Math.round(view[1] - view[0])} onChange={(v) => setView([view[0], Math.min(dur, view[0] + v)])} /></div>
    </>
  );
  return (
    <div>
      <h2>Pitch & Melody Editor</h2>
      <p className="sub">Cyan = measured pitch (YIN). Bars = editable notes. Drag a note vertically to change pitch, its edges to change timing. Edits are applied by real pitch-shifting on render.</p>
      {!tracks.length && <div className="notice info">Add a vocal track first (Cover Studio).</div>}
      {full ? <div className="fullscreen">{body}</div> : <div className="card">{body}</div>}
      {selNote && <div className="card">
        <h3>Note {midiName(selNote.midi)} <small style={{ color: 'var(--muted)' }}>detected {selNote.detectedMidi.toFixed(2)} · {selNote.start.toFixed(2)}–{selNote.end.toFixed(2)}s</small></h3>
        <div className="grid">
          <Slider label="Pitch" unit=" (MIDI)" min={24} max={96} step={0.1} value={selNote.midi} onChange={(v) => upd({ midi: v })} note="cents-level bends" />
          <Slider label="Vibrato depth" unit="×" min={0} max={2} step={0.05} value={selNote.vibrato} onChange={(v) => upd({ vibrato: v })} />
          <Slider label="Note gain" unit=" dB" min={-24} max={12} step={0.5} value={selNote.gainDb} onChange={(v) => upd({ gainDb: v })} />
          <label className="field">Formant<span className="tag warn">not supported in DSP path</span></label>
        </div>
        <div className="row" style={{ marginTop: 8 }}><button className="btn small" onClick={split}>Split</button><button className="btn small" onClick={merge}>Merge with next</button><button className="btn small danger" onClick={() => commit(notes.filter((n) => n.id !== sel))}>Delete (bypass)</button></div>
      </div>}
      <div className="card">
        <div className="row">
          <button className="btn" disabled={!selNote || busy} onClick={() => render(true)}>Render phrase</button>
          <button className="btn primary" disabled={!notes.length || busy} onClick={() => render(false)}>{busy ? 'Rendering…' : 'Render whole track'}</button>
          <PlayButton pcm={selNote ? original : pcm} label="pe-a" text="A: original" />
          <PlayButton pcm={rendered ?? undefined} label="pe-b" text="B: edited" />
          <button className="btn" disabled={!rendered || rendered.channels[0].length !== pcm?.channels[0].length} onClick={apply}>Apply to track</button>
        </div>
      </div>
    </div>
  );
}
