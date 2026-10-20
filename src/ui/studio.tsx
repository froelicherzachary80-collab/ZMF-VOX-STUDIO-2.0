import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PCM } from '../audio/pcm';
import { loadPCM, savePCM } from '../store/assets';
import { uid } from '../store/db';
import { loadProject, newProject, newTrack, saveProject, type Project, type Track, type TrackKind } from '../store/project';
import type { QualityMode } from '../ai/capabilities';

interface Studio {
  project: Project; pcms: Map<string, PCM>; version: number;
  setProject: (fn: (p: Project) => Project) => void;
  addTrack: (pcm: PCM, name: string, kind: TrackKind, provenance?: string, replaceKind?: boolean) => Promise<Track>;
  replaceAsset: (trackId: string, pcm: PCM, provenance?: string) => Promise<void>;
  updateTrack: (id: string, patch: Partial<Track>) => void;
  removeTrack: (id: string) => void;
  open: (id: string) => Promise<void>; create: (name?: string) => void; saveNow: () => Promise<void>;
  trackPCM: (kind: TrackKind) => PCM | undefined;
  quality: QualityMode; setQuality: (q: QualityMode) => void;
  savedAt: number | null;
}
const Ctx = createContext<Studio>(null as any);
export const useStudio = () => useContext(Ctx);
const LAST = 'zmf.lastProject';
const ls = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* */ } } };

export function StudioProvider({ children }: { children: ReactNode }) {
  const [project, setP] = useState<Project>(() => newProject());
  const pcms = useRef(new Map<string, PCM>());
  const [version, setVersion] = useState(0);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [quality, setQ] = useState<QualityMode>(() => (ls.get('zmf.quality') as QualityMode) || 'BALANCED');
  const setQuality = (q: QualityMode) => { setQ(q); ls.set('zmf.quality', q); };
  const bump = () => setVersion((v) => v + 1);
  const setProject = useCallback((fn: (p: Project) => Project) => setP((p) => fn(p)), []);

  const open = useCallback(async (id: string) => {
    const p = await loadProject(id); if (!p) return;
    pcms.current.clear();
    for (const t of p.tracks) { const a = await loadPCM(t.assetId); if (a) pcms.current.set(t.assetId, a); }
    setP(p); ls.set(LAST, id); bump();
  }, []);

  // Recover the last project after reload / iOS tab eviction
  useEffect(() => { const id = ls.get(LAST); if (id) open(id).catch(() => {}); }, [open]);

  // Debounced autosave of metadata
  useEffect(() => {
    if (!project.tracks.length) return;
    const t = setTimeout(async () => { await saveProject(project); ls.set(LAST, project.id); setSavedAt(Date.now()); }, 600);
    return () => clearTimeout(t);
  }, [project]);

  const addTrack = async (pcm: PCM, name: string, kind: TrackKind, provenance?: string, replaceKind = false) => {
    const assetId = uid(); await savePCM(assetId, pcm); pcms.current.set(assetId, pcm);
    const t = newTrack(name, kind, assetId, provenance);
    setP((p) => ({ ...p, tracks: [...(replaceKind ? p.tracks.filter((x) => x.kind !== kind) : p.tracks), t] }));
    bump(); return t;
  };
  const replaceAsset = async (trackId: string, pcm: PCM, provenance?: string) => {
    const assetId = uid(); await savePCM(assetId, pcm); pcms.current.set(assetId, pcm);
    setP((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, assetId, provenance: provenance ?? t.provenance } : t)) })); bump();
  };
  const updateTrack = (id: string, patch: Partial<Track>) => setP((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  const removeTrack = (id: string) => setP((p) => ({ ...p, tracks: p.tracks.filter((t) => t.id !== id) }));
  const create = (name?: string) => { pcms.current.clear(); setP(newProject(name)); bump(); };
  const saveNow = async () => { await saveProject(project); ls.set(LAST, project.id); setSavedAt(Date.now()); };
  const trackPCM = (kind: TrackKind) => { const t = project.tracks.find((x) => x.kind === kind); return t ? pcms.current.get(t.assetId) : undefined; };

  return <Ctx.Provider value={{ project, pcms: pcms.current, version, setProject, addTrack, replaceAsset, updateTrack, removeTrack, open, create, saveNow, trackPCM, quality, setQuality, savedAt }}>{children}</Ctx.Provider>;
}
