import type {
  BusState,
  ClipState,
  MatchSettings,
  ProcessorNodeState,
  ProjectState,
  TrackKind,
  TrackState,
} from './types';
import { createDefaultParams } from '../dsp/registry';

export const TRACK_COLORS = [
  '#c8f169',
  '#5ad1e6',
  '#f0b45a',
  '#a78bfa',
  '#f2657a',
  '#7dd3a0',
  '#e2a3ff',
  '#f9a8a8',
];

export function uid(prefix = 'id'): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function defaultMatchSettings(): MatchSettings {
  return {
    enabled: true,
    intensity: 75,
    frequencyBalance: 100,
    loudness: 75,
    dynamics: 60,
    stereoWidth: 50,
    punch: 50,
    saturation: 35,
    character: 50,
    maxEqBoost: 6,
    maxEqCut: 8,
    maxLoudnessChange: 6,
    protectLowEnd: true,
    protectHighEnd: false,
    excludeLowHz: 20,
    excludeHighHz: 20000,
    targetSection: 'full',
    referenceSection: 'full',
    categorySource: {
      frequencyBalance: 0,
      loudness: 0,
      dynamics: 0,
      stereoWidth: 0,
      punch: 0,
      saturation: 0,
      character: 0,
    },
    matchTonal: true,
    matchLoudness: true,
    matchDynamics: true,
    matchStereo: true,
    matchLowEnd: true,
    matchHighEnd: true,
    matchPunch: true,
  };
}

export function createTrack(kind: TrackKind, name: string, index: number, color?: string): TrackState {
  return {
    id: uid('trk'),
    name,
    kind,
    color: color ?? TRACK_COLORS[index % TRACK_COLORS.length],
    volumeDb: 0,
    pan: 0,
    muted: false,
    soloed: false,
    polarity: false,
    mono: false,
    output: null,
    sends: [],
    processors: [],
    automation: [],
    clips: [],
    height: 78,
  };
}

export function createBus(name: string, index: number): BusState {
  return {
    id: uid('bus'),
    name,
    color: TRACK_COLORS[(index + 4) % TRACK_COLORS.length],
    volumeDb: 0,
    muted: false,
    polarity: false,
    processors: [],
    automation: [],
  };
}

export function createProject(name = 'Untitled project', sampleRate = 48000): ProjectState {
  const now = Date.now();
  return {
    id: uid('prj'),
    name,
    createdAt: now,
    updatedAt: now,
    sampleRate,
    tempo: 120,
    folder: '',
    notes: '',
    tracks: [],
    buses: [],
    master: { volumeDb: 0, processors: [] },
    referenceAssetIds: [],
    targetAssetIds: [],
    match: defaultMatchSettings(),
    masters: [],
    targetLufs: -14,
    targetTruePeak: -1,
    autosave: true,
  };
}

export function createClip(assetId: string, duration: number, start = 0): ClipState {
  return {
    id: uid('clip'),
    assetId,
    start,
    offset: 0,
    duration,
    fadeIn: 0,
    fadeOut: 0,
    gainDb: 0,
  };
}

export function createProcessorNode(type: string, params?: Record<string, number>): ProcessorNodeState {
  return {
    id: uid('proc'),
    type,
    version: 1,
    enabled: true,
    params: { ...createDefaultParams(type), ...(params ?? {}) },
  };
}
