import { useRef, useState } from 'react';
import { useStudio } from '../ui/studio';
import { renderMix } from '../audio/render';
import { Meter, PlayButton, Slider } from '../ui/components';
import { peakOf } from '../audio/analysis';
import type { Track } from '../store/project';
import { player } from '../ui/player';
import { useEffect } from 'react';

const COLORS: Record<string, string> = { original: '#64748b', vocal: '#67e8f9', converted: '#f0abfc', instrumental: '#34d399', harmony: '#a78bfa', layer: '#fbbf24' };

function Timeline() {
  const st = useStudio(); const tracks = st.project.tracks;
  const total = Math.max(10, ...tracks.map((t) => { const p = st.pcms.get(t.assetId); return p ? t.offset + p.channels[0].length / p.sampleRate : 0; }));
  const [zoom, setZoom] = useState(1); const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; x: number; off: number } | null>(null);
  const pxPerSec = ((ref.current?.clientWidth ?? 600) / total) * zoom;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}><h3>Timeline</h3><div style={{ width: 160 }}><Slider label="Zoom" min={1} max={20} step={0.5} value={zoom} onChange={setZoom} /></div></div>
      <div ref={ref} style={{ overflowX: 'auto', touchAction: 'pan-y' }}>
        <div style={{ width: total * pxPerSec, position: 'relative' }}>
          {tracks.map((t) => { const p = st.pcms.get(t.assetId); const len = p ? p.channels[0].length / p.sampleRate : 0; return (
            <div key={t.id} style={{ height: 34, position: 'relative', borderBottom: '1px solid var(--line)' }}>
              <div title="drag to move region" style={{ position: 'absolute', left: t.offset * pxPerSec, width: Math.max(4, len * pxPerSec), top: 3, bottom: 3, background: COLORS[t.kind] + '55', border: `1px solid ${COLORS[t.kind]}`, borderRadius: 6, fontSize: 11, padding: '2px 6px', whiteSpace: 'nowrap', overflow: 'hidden', cursor: 'grab', touchAction: 'none', opacity: t.mute ? 0.35 : 1 }}
                onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { id: t.id, x: e.clientX, off: t.offset }; }}
                onPointerMove={(e) => { const d = drag.current; if (d?.id === t.id) st.updateTrack(t.id, { offset: Math.max(0, Math.round((d.off + (e.clientX - d.x) / pxPerSec) * 100) / 100) }); }}
                onPointerUp={() => (drag.current = null)}>{t.name} · {t.offset.toFixed(2)}s</div>
            </div>); })}
        </div>
      </div>
    </div>
  );
}

function Strip({ t }: { t: Track }) {
  const st = useStudio(); const u = (p: Partial<Track>) => st.updateTrack(t.id, p);
  const pcm = st.pcms.get(t.assetId); const pk = pcm ? peakOf(pcm) : 0;
  return (
    <div className="channel" style={{ borderTop: `3px solid ${COLORS[t.kind]}` }}>
      <b style={{ fontSize: 13 }}>{t.name}</b>
      {t.provenance && <span className="tag" style={{ fontSize: 10 }}>{t.provenance}</span>}
      <div className="row"><button className={`btn small`} style={t.mute ? { color: 'var(--bad)' } : {}} onClick={() => u({ mute: !t.mute })}>M</button><button className="btn small" style={t.solo ? { color: 'var(--warn)' } : {}} onClick={() => u({ solo: !t.solo })}>S</button><small>peak {(20 * Math.log10(pk || 1e-9)).toFixed(1)} dB</small></div>
      <Slider label="Gain" unit=" dB" min={-40} max={12} step={0.5} value={t.gainDb} onChange={(v) => u({ gainDb: v })} />
      <Slider label="Pan" min={-1} max={1} step={0.05} value={t.pan} onChange={(v) => u({ pan: v })} />
      <Slider label="Low" unit=" dB" min={-12} max={12} step={0.5} value={t.eq.low} onChange={(v) => u({ eq: { ...t.eq, low: v } })} />
      <Slider label={`Mid @${t.eq.midFreq}`} unit=" dB" min={-12} max={12} step={0.5} value={t.eq.mid} onChange={(v) => u({ eq: { ...t.eq, mid: v } })} />
      <Slider label="High" unit=" dB" min={-12} max={12} step={0.5} value={t.eq.high} onChange={(v) => u({ eq: { ...t.eq, high: v } })} />
      <label style={{ fontSize: 13 }}><input type="checkbox" checked={t.comp.on} onChange={(e) => u({ comp: { ...t.comp, on: e.target.checked } })} /> Compressor</label>
      {t.comp.on && <><Slider label="Threshold" unit=" dB" min={-50} max={0} value={t.comp.thresholdDb} onChange={(v) => u({ comp: { ...t.comp, thresholdDb: v } })} /><Slider label="Ratio" min={1} max={20} step={0.5} value={t.comp.ratio} onChange={(v) => u({ comp: { ...t.comp, ratio: v } })} /></>}
      <Slider label="De-esser" min={0} max={1} step={0.05} value={t.deEss} onChange={(v) => u({ deEss: v })} />
      <Slider label="Reverb send" min={0} max={1} step={0.05} value={t.reverb} onChange={(v) => u({ reverb: v })} />
      <Slider label="Delay mix" min={0} max={1} step={0.05} value={t.delay.mix} onChange={(v) => u({ delay: { ...t.delay, mix: v } })} />
      {t.delay.mix > 0 && <><Slider label="Delay time" unit=" ms" min={20} max={1000} value={t.delay.timeMs} onChange={(v) => u({ delay: { ...t.delay, timeMs: v } })} /><Slider label="Feedback" min={0} max={0.9} step={0.05} value={t.delay.feedback} onChange={(v) => u({ delay: { ...t.delay, feedback: v } })} /></>}
      <Slider label="Stereo width" min={0} max={2} step={0.05} value={t.width} onChange={(v) => u({ width: v })} />
      <button className="btn small danger" onClick={() => confirm(`Remove ${t.name} from mix?`) && st.removeTrack(t.id)}>Remove</button>
    </div>
  );
}

export default function Mixer() {
  const st = useStudio(); const [lv, setLv] = useState([0, 0]);
  useEffect(() => player.subscribe((s) => setLv(s.playing ? [s.levelL, s.levelR] : [0, 0])), []);
  const conv = st.project.tracks.find((t) => t.kind === 'converted'), voc = st.project.tracks.find((t) => t.kind === 'vocal');
  const [blend, setBlend] = useState(1);
  const applyBlend = (b: number) => { setBlend(b); if (conv) st.updateTrack(conv.id, { gainDb: 20 * Math.log10(Math.max(1e-3, b)), mute: b === 0 }); if (voc) st.updateTrack(voc.id, { gainDb: 20 * Math.log10(Math.max(1e-3, 1 - b)), mute: b === 1 }); };
  return (
    <div>
      <h2>Audio Mixer</h2>
      <p className="sub">Non-destructive: settings are stored with the project and applied at render time (Web Audio nodes + JS DSP).</p>
      <div className="card"><div className="row" style={{ alignItems: 'flex-end' }}>
        <PlayButton pcm={st.project.tracks.length ? () => renderMix(st.project.tracks, st.pcms, st.project.master) : undefined} label="mix" text="Render & play mix" />
        <Meter levels={lv} />
        {conv && voc && <div style={{ flex: 1, minWidth: 200 }}><Slider label="Original ⟷ converted voice" min={0} max={1} step={0.05} value={blend} onChange={applyBlend} /></div>}
      </div></div>
      <Timeline />
      <div className="mixer">{st.project.tracks.map((t) => <Strip key={t.id} t={t} />)}</div>
      {!st.project.tracks.length && <div className="notice info">No tracks — import a song in Cover Studio.</div>}
    </div>
  );
}
