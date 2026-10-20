import { all, del, get, put, uid } from './db';
import type { Note } from '../audio/pitch';

export type TrackKind = 'original' | 'vocal' | 'converted' | 'instrumental' | 'harmony' | 'layer';
export interface Track {
  id: string; name: string; kind: TrackKind; assetId: string; offset: number;
  gainDb: number; pan: number; mute: boolean; solo: boolean;
  eq: { low: number; mid: number; midFreq: number; high: number };
  comp: { on: boolean; thresholdDb: number; ratio: number };
  deEss: number; reverb: number; delay: { timeMs: number; feedback: number; mix: number };
  width: number; automation: { t: number; gainDb: number }[];
  /** Provenance label shown in UI ("neural RVC", "DSP harmony", ...) */
  provenance?: string;
}
export interface MasterSettings {
  gainDb: number; eq: { low: number; mid: number; high: number };
  comp: { on: boolean; thresholdDb: number; ratio: number; attackMs: number; releaseMs: number };
  limiter: { on: boolean; ceilingDb: number }; width: number; reverbDecay: number;
}
export interface Project {
  id: string; name: string; createdAt: number; updatedAt: number;
  tracks: Track[]; master: MasterSettings; notes?: Note[]; notesTrackId?: string;
  sourceStats?: Record<string, unknown>; singerId?: string; syntheticContent: boolean;
}

export const defaultMaster = (): MasterSettings => ({
  gainDb: 0, eq: { low: 0, mid: 0, high: 0 }, comp: { on: true, thresholdDb: -14, ratio: 2, attackMs: 20, releaseMs: 200 },
  limiter: { on: true, ceilingDb: -1 }, width: 1, reverbDecay: 2.2,
});
export const newTrack = (name: string, kind: TrackKind, assetId: string, provenance?: string): Track => ({
  id: uid(), name, kind, assetId, offset: 0, gainDb: 0, pan: 0, mute: false, solo: false,
  eq: { low: 0, mid: 0, midFreq: 2500, high: 0 }, comp: { on: false, thresholdDb: -20, ratio: 3 }, deEss: 0, reverb: kind === 'converted' || kind === 'harmony' ? 0.15 : 0,
  delay: { timeMs: 250, feedback: 0.25, mix: 0 }, width: 1, automation: [], provenance,
});
export const newProject = (name = 'Untitled Cover'): Project => ({ id: uid(), name, createdAt: Date.now(), updatedAt: Date.now(), tracks: [], master: defaultMaster(), syntheticContent: false });

export const saveProject = (p: Project) => put('projects', p.id, { ...p, updatedAt: Date.now() });
export const loadProject = (id: string) => get<Project>('projects', id);
export const listProjects = async () => (await all<Project>('projects')).sort((a, b) => b.updatedAt - a.updatedAt);
export const deleteProject = (id: string) => del('projects', id);
