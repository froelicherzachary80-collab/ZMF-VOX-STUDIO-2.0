import { useEffect, useRef, useState } from 'react';
import type { PCM } from '../audio/pcm';
import { toMono } from '../audio/pcm';
import { waveformPeaks } from '../audio/analysis';
import { player, type PlayerState } from './player';
import { encodeWav } from '../audio/wav';

export function Slider(p: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void; note?: string; disabled?: boolean }) {
  return (
    <label className="slider" title={p.note}>
      <span>{p.label}{p.note && <span className="tag" style={{ marginLeft: 6 }}>{p.note}</span>}</span>
      <b>{Number.isInteger(p.step ?? 1) ? p.value : p.value.toFixed(2)}{p.unit}</b>
      <input type="range" min={p.min} max={p.max} step={p.step ?? 1} value={p.value} disabled={p.disabled} onChange={(e) => p.onChange(parseFloat(e.target.value))} />
    </label>
  );
}

export function Progress({ value }: { value: number }) { return <div className="progress"><i style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} /></div>; }

/** Canvas waveform drawn from real sample peaks. Pinch / wheel zoom, drag to pan, tap to seek, optional selection. */
export function Waveform({ pcm, color = '#a78bfa', height = 96, selection, onSelect, playLabel }: { pcm: PCM | undefined; color?: string; height?: number; selection?: [number, number] | null; onSelect?: (s: [number, number]) => void; playLabel?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<[number, number]>([0, 1]);
  const [ps, setPs] = useState<PlayerState>(player.state);
  useEffect(() => player.subscribe(setPs), []);
  const mono = useRef<Float32Array | null>(null);
  useEffect(() => { mono.current = pcm ? toMono(pcm) : null; setView([0, 1]); }, [pcm]);
  const dur = pcm ? pcm.channels[0].length / pcm.sampleRate : 0;

  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth * dpr, h = height * dpr;
    c.width = w; c.height = h;
    const g = c.getContext('2d')!; g.clearRect(0, 0, w, h);
    const m = mono.current; if (!m) { g.fillStyle = '#9a93b5'; g.font = `${12 * dpr}px sans-serif`; g.fillText('No audio', 10 * dpr, h / 2); return; }
    const a = Math.floor(view[0] * m.length), b = Math.ceil(view[1] * m.length);
    const { min, max } = waveformPeaks(m.subarray(a, b), Math.max(1, Math.floor(w)));
    if (selection) { const x0 = ((selection[0] / dur - view[0]) / (view[1] - view[0])) * w, x1 = ((selection[1] / dur - view[0]) / (view[1] - view[0])) * w; g.fillStyle = '#a78bfa22'; g.fillRect(x0, 0, x1 - x0, h); }
    g.fillStyle = color;
    for (let x = 0; x < min.length; x++) { const y0 = (1 - max[x]) * h / 2, y1 = (1 - min[x]) * h / 2; g.fillRect(x, y0, 1, Math.max(1, y1 - y0)); }
    if (playLabel && ps.label === playLabel && ps.playing) { const x = ((ps.position / dur - view[0]) / (view[1] - view[0])) * w; g.fillStyle = '#fff'; g.fillRect(x, 0, 2 * dpr, h); }
  }, [pcm, view, height, color, selection, ps, playLabel, dur]);

  const pointers = useRef(new Map<number, number>()); const pinch = useRef<{ d: number; v: [number, number] } | null>(null);
  const drag = useRef<{ x: number; v: [number, number]; sel: number; moved: boolean } | null>(null);
  const toT = (clientX: number) => { const r = ref.current!.getBoundingClientRect(); return (view[0] + ((clientX - r.left) / r.width) * (view[1] - view[0])) * dur; };
  const zoom = (factor: number, centre: number) => {
    const span = Math.min(1, Math.max(0.002, (view[1] - view[0]) * factor));
    let s = centre - (centre - view[0]) * (span / (view[1] - view[0])); s = Math.max(0, Math.min(1 - span, s)); setView([s, s + span]);
  };
  return (
    <canvas ref={ref} className="wave" style={{ height }}
      onWheel={(e) => { const r = ref.current!.getBoundingClientRect(); zoom(e.deltaY > 0 ? 1.2 : 0.83, view[0] + ((e.clientX - r.left) / r.width) * (view[1] - view[0])); }}
      onPointerDown={(e) => { ref.current!.setPointerCapture(e.pointerId); pointers.current.set(e.pointerId, e.clientX); if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; pinch.current = { d: Math.abs(a - b), v: view }; drag.current = null; } else drag.current = { x: e.clientX, v: view, sel: toT(e.clientX), moved: false }; }}
      onPointerMove={(e) => {
        if (!pointers.current.has(e.pointerId)) return; pointers.current.set(e.pointerId, e.clientX);
        if (pinch.current && pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; const f = pinch.current.d / Math.max(10, Math.abs(a - b)); const r = ref.current!.getBoundingClientRect(); const v = pinch.current.v; const span = Math.min(1, Math.max(0.002, (v[1] - v[0]) * f)); const c = v[0] + (((a + b) / 2 - r.left) / r.width) * (v[1] - v[0]); let s = c - span / 2; s = Math.max(0, Math.min(1 - span, s)); setView([s, s + span]); return; }
        const d = drag.current; if (!d) return; if (Math.abs(e.clientX - d.x) > 4) d.moved = true;
        if (onSelect && d.moved) { const t = toT(e.clientX); onSelect([Math.min(d.sel, t), Math.max(d.sel, t)]); }
        else if (d.moved) { const r = ref.current!.getBoundingClientRect(); const span = d.v[1] - d.v[0]; let s = d.v[0] - ((e.clientX - d.x) / r.width) * span; s = Math.max(0, Math.min(1 - span, s)); setView([s, s + span]); }
      }}
      onPointerUp={(e) => { pointers.current.delete(e.pointerId); if (pointers.current.size < 2) pinch.current = null; const d = drag.current; drag.current = null; if (d && !d.moved && pcm && playLabel) player.play(pcm, playLabel, Math.max(0, toT(e.clientX))); }}
      onDoubleClick={() => setView([0, 1])}
    />
  );
}

export function PlayButton({ pcm, label, text = 'Play' }: { pcm: PCM | undefined | (() => Promise<PCM | undefined>); label: string; text?: string }) {
  const [ps, setPs] = useState(player.state); const [busy, setBusy] = useState(false);
  useEffect(() => player.subscribe(setPs), []);
  const on = ps.playing && ps.label === label;
  return <button className="btn" disabled={!pcm || busy} onClick={async () => {
    if (on) return player.stop();
    setBusy(true);
    try { const p = typeof pcm === 'function' ? await pcm() : pcm; if (p) await player.play(p, label); } finally { setBusy(false); }
  }}>{busy ? 'Rendering…' : on ? '■ Stop' : `▶ ${text}`}</button>;
}

export function download(blob: Blob, name: string) {
  // iOS Safari: prefer the native share sheet (→ "Save to Files") when available.
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as any;
  if (nav.canShare?.({ files: [file] }) && /iPhone|iPad/.test(navigator.userAgent)) { nav.share({ files: [file], title: name }).catch(() => fallback()); return; }
  fallback();
  function fallback() { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 30000); }
}

export const WavButton = ({ pcm, name }: { pcm?: PCM; name: string }) => <button className="btn small" disabled={!pcm} onClick={() => pcm && download(encodeWav(pcm), `${name}.wav`)}>WAV</button>;

export function Meter({ levels }: { levels: number[] }) {
  return <div className="meter">{levels.map((l, i) => { const dbv = 20 * Math.log10(Math.max(1e-5, l)); const h = Math.max(0, Math.min(1, (dbv + 60) / 60)); return <div key={i} title={`${dbv.toFixed(1)} dBFS`}><i style={{ height: `${h * 100}%` }} /></div>; })}</div>;
}

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`;
export const fmtDb = (d: number) => (isFinite(d) ? `${d.toFixed(1)} dB` : '-∞ dB');
