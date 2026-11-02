import type { ParamValues } from '../dsp/types';

export type TrackKind = 'audio' | 'vocal' | 'instrument' | 'drums' | 'bass' | 'instrumental' | 'stem' | 'reference' | 'bus';

export interface ClipState {
  id: string;
  assetId: string;
  /** Timeline position in seconds. */
  start: number;
  /** Offset into the source asset in seconds. */
  offset: number;
  /** Length in seconds. */
  duration: number;
  fadeIn: number;
  fadeOut: number;
  gainDb: number;
}

export type CurveType = 0 | 1; // 0 linear, 1 exponential

export interface AutomationPoint {
  time: number;
  value: number;
  curve: CurveType;
}

export interface AutomationLane {
  id: string;
  /** Target: a mixer control or a processor parameter. */
  target: 'volume' | 'pan' | 'send';
  busId?: string;
  processorId?: string;
  param?: string;
  points: AutomationPoint[];
  enabled: boolean;
}

export interface SendState {
  busId: string;
  levelDb: number;
  preFader: boolean;
}

export interface ProcessorNodeState {
  id: string;
  type: string;
  version: number;
  enabled: boolean;
  params: ParamValues;
  /** Optional external sidechain key, by track id. */
  sidechainFrom?: string | null;
  /** Why this processor exists (used by AI-generated chains). */
  note?: string;
}

export interface TrackState {
  id: string;
  name: string;
  kind: TrackKind;
  color: string;
  volumeDb: number;
  pan: number;
  muted: boolean;
  soloed: boolean;
  polarity: boolean;
  mono: boolean;
  output: string | null; // bus id or null for master
  sends: SendState[];
  processors: ProcessorNodeState[];
  automation: AutomationLane[];
  clips: ClipState[];
  height: number;
}

export interface BusState {
  id: string;
  name: string;
  color: string;
  volumeDb: number;
  muted: boolean;
  polarity: boolean;
  processors: ProcessorNodeState[];
  automation: AutomationLane[];
}

export interface MasterState {
  volumeDb: number;
  processors: ProcessorNodeState[];
}

export interface MatchSettings {
  enabled: boolean;
  intensity: number;
  frequencyBalance: number;
  loudness: number;
  dynamics: number;
  stereoWidth: number;
  punch: number;
  saturation: number;
  character: number;
  maxEqBoost: number;
  maxEqCut: number;
  maxLoudnessChange: number;
  protectLowEnd: boolean;
  protectHighEnd: boolean;
  excludeLowHz: number;
  excludeHighHz: number;
  targetSection: 'full' | 'chorus' | 'verse';
  referenceSection: 'full' | 'chorus' | 'verse';
  categorySource: Record<string, number>;
  matchTonal: boolean;
  matchLoudness: boolean;
  matchDynamics: boolean;
  matchStereo: boolean;
  matchLowEnd: boolean;
  matchHighEnd: boolean;
  matchPunch: boolean;
}

export interface MasterVersion {
  id: string;
  name: string;
  createdAt: number;
  lufs: number | null;
  truePeak: number | null;
  processors: ProcessorNodeState[];
  note?: string;
}

export interface ProjectState {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  sampleRate: number;
  tempo: number;
  folder: string;
  notes: string;
  tracks: TrackState[];
  buses: BusState[];
  master: MasterState;
  referenceAssetIds: string[];
  targetAssetIds: string[];
  match: MatchSettings;
  masters: MasterVersion[];
  targetLufs: number | null;
  targetTruePeak: number;
  autosave: boolean;
}

export type AssetRole = 'target' | 'reference' | 'stem' | 'export';

export interface AudioAssetMeta {
  id: string;
  projectId: string;
  name: string;
  role: AssetRole;
  mimeType: string;
  fileSize: number;
  duration: number;
  sampleRate: number;
  channels: number;
  bitDepth: number | null;
  peakDb: number | null;
  lufs: number | null;
  createdAt: number;
  /** true when the browser had to decode a container it cannot report headers for. */
  decodedOnly: boolean;
}

export interface ExportRecord {
  id: string;
  projectId: string;
  name: string;
  createdAt: number;
  format: string;
  sampleRate: number;
  bitDepth: number;
  duration: number;
  lufs: number | null;
  truePeak: number | null;
  sizeBytes: number;
  settings: Record<string, unknown>;
  verifiedLufs?: number | null;
  verifiedTruePeakDb?: number | null;
  verificationNote?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  folder: string;
  trackCount: number;
  hasReference: boolean;
}
