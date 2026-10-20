import { all, del, get, put, uid } from './db';
import type { HumanVoiceSettings } from '../audio/humanvoice';
import { HV_DEFAULT } from '../audio/humanvoice';

export interface VoiceAnalysis {
  medianF0: number; rangeLowMidi: number; rangeHighMidi: number; spectralCentroid: number; brightness: number;
  rmsDb: number; voicedRatio: number; seconds: number; analyzedAt: number;
}
export interface Singer {
  id: string; name: string; avatar?: string; description: string; voiceType: string;
  rangeLow: string; rangeHigh: string; defaultStyle: string; presentation: string;
  /** Capability is explicit: an analysis-only profile is never reported as trained. */
  capability: 'analysis-only' | 'neural-rvc';
  voiceModelId?: string; contentModelId?: string; modelSampleRate?: number;
  sampleAssetIds: string[]; analysis?: VoiceAnalysis;
  humanVoice: HumanVoiceSettings; transpose: number;
  permissionConfirmed: boolean; syntheticLabel: boolean; recentProjects: string[];
  createdAt: number;
}

export const newSinger = (name = 'New Singer'): Singer => ({
  id: uid(), name, description: '', voiceType: 'Unspecified', rangeLow: 'C3', rangeHigh: 'C5', defaultStyle: 'Natural Studio',
  presentation: 'Unspecified', capability: 'analysis-only', sampleAssetIds: [], humanVoice: { ...HV_DEFAULT }, transpose: 0,
  permissionConfirmed: false, syntheticLabel: true, recentProjects: [], createdAt: Date.now(),
});
export const saveSinger = (s: Singer) => put('singers', s.id, s);
export const getSinger = (id: string) => get<Singer>('singers', id);
export const listSingers = async () => (await all<Singer>('singers')).sort((a, b) => b.createdAt - a.createdAt);
export const deleteSinger = (id: string) => del('singers', id);
