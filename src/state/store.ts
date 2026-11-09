import { create } from 'zustand';
import type { AnalysisReport } from '../audio/analysis/analyze';
import { decodeAudioFile, resampleToRate } from '../audio/io/decode';
import { encodeAiff, encodeWav, type WavBitDepth } from '../audio/io/wav';
import { analyzeLoudness, normalizeToTruePeak } from '../audio/analysis/loudness';
import { generateMatchPlan, planToNodes, type MatchPlan } from '../audio/analysis/match';
import { interpretCommand, suggestionsFor, type AssistantProposal } from '../audio/ai/assistant';
import { requestSonoraAi } from '../audio/ai/client';
import { buildAssistantContext } from '../audio/ai/context';
import { createValidatedAiProposal } from '../audio/ai/proposals';
import { realtimeHost } from '../audio/engine/realtime';
import type { EngineAsset } from '../audio/engine/renderer';
import { createProcessorNode, createProject as newProject, createTrack, createClip, createBus, defaultMatchSettings, uid } from '../audio/model/defaults';
import type {
  AudioAssetMeta,
  BusState,
  ExportRecord,
  MatchSettings,
  ProcessorNodeState,
  ProjectState,
  ProjectSummary,
  TrackKind,
  TrackState,
} from '../audio/model/types';
import { allAssetIds, chainFor, cloneProject, findTrack, type ChainScope } from '../audio/model/project';
import { BUILT_IN_PRESETS, createPreset, type PresetCategory, type PresetDefinition } from '../audio/presets/library';
import { computePeaks } from '../lib/peaks';
import * as db from '../lib/db';
import { computeMatchPreview } from '../audio/analysis/preview';
import { loudnessMatchedMonitorGain } from '../audio/analysis/ab';

export type Screen =
  | 'dashboard'
  | 'projects'
  | 'studio'
  | 'reference'
  | 'mastering'
  | 'presets'
  | 'analysis'
  | 'export'
  | 'learn'
  | 'settings'
  | 'plans'
  | 'account';

export type Mode = 'beginner' | 'advanced';

export interface AssetBuffer {
  L: Float32Array;
  R: Float32Array;
  sampleRate: number;
  peaks: Float32Array;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  detail?: string[];
  proposalId?: string;
}

export interface ABSlot {
  id: string;
  label: string;
  processors: ProcessorNodeState[];
  volumeDb: number;
  /** Integrated loudness measured from an offline render of this snapshot. */
  lufs: number | null;
  /** Annex 2 true peak measured from the same offline render. */
  truePeakDb: number | null;
  createdAt: number;
}

export interface ABWorkingMix {
  projectId: string;
  processors: ProcessorNodeState[];
  volumeDb: number;
}

export interface BusyState {
  kind: 'import' | 'load' | 'analyze' | 'render' | 'match' | 'decode' | 'assistant';
  label: string;
  progress: number;
  cancel?: () => void;
}

export interface ExportSettings {
  format: 'wav' | 'aiff' | 'mp3';
  bitDepth: WavBitDepth;
  sampleRate: number;
  startSec: number;
  endSec: number;
  mode: 'master' | 'track';
  trackId?: string;
  dither: boolean;
  normalize: boolean;
  filename: string;
  metadata: { title: string; artist: string; comment: string };
}

interface RenderStats {
  lufs: number;
  truePeakDb: number;
  samplePeakDb: number;
  lra: number;
  crestDb: number;
  duration: number;
  elapsedMs: number;
}

interface AppState {
  screen: Screen;
  mode: Mode;
  projects: ProjectSummary[];
  project: ProjectState | null;
  assets: AudioAssetMeta[];
  assetBuffers: Record<string, AssetBuffer>;
  analyses: Record<string, AnalysisReport>;
  matchPlan: MatchPlan | null;
  matchPreview: { before: number[]; after: number[] } | null;
  presets: PresetDefinition[];
  exports: ExportRecord[];
  selectedTrackId: string | null;
  selectedProcessorId: string | null;
  selectedAssetId: string | null;
  assistantOpen: boolean;
  assistantScope: 'master' | 'track';
  chat: ChatMessage[];
  assistantProposal: AssistantProposal | null;
  busy: BusyState | null;
  toast: string | null;
  transport: {
    playing: boolean;
    position: number;
    loopEnabled: boolean;
    loopStart: number;
    loopEnd: number;
    duration: number;
  };
  abSlots: ABSlot[];
  activeSlot: string | null;
  workingMix: ABWorkingMix | null;
  loudnessMatch: boolean;
  comparisonDb: number;
  monitorDb: number;
  history: ProjectState[];
  future: ProjectState[];
  lastCoalesceKey: string | null;
  lastCoalesceAt: number;
  lastSavedAt: number | null;
  lastRenderStats: RenderStats | null;
  engineError: string | null;
  storageError: string | null;
  verifying: boolean;

  init: () => Promise<void>;
  setScreen: (screen: Screen) => void;
  setMode: (mode: Mode) => void;
  createProject: (name?: string) => Promise<void>;
  openProject: (id: string) => Promise<void>;
  closeProject: () => void;
  deleteProjectById: (id: string) => Promise<void>;
  duplicateProjectById: (id: string) => Promise<void>;
  importFiles: (files: File[], role: 'target' | 'reference' | 'stem') => Promise<void>;
  analyzeAsset: (assetId: string) => Promise<AnalysisReport | null>;
  analyzeProjectAssets: () => Promise<void>;
  removeReference: (assetId: string) => void;
  selectTrack: (id: string | null) => void;
  selectProcessor: (id: string | null) => void;
  selectAsset: (id: string | null) => void;
  setToast: (message: string | null) => void;
  clearBusy: () => void;

  mutate: (mutator: (project: ProjectState) => void, options?: { coalesce?: string; preserveAb?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  saveNow: () => Promise<void>;

  addProcessor: (scope: ChainScope, trackId: string | null, type: string, params?: Record<string, number>) => void;
  updateProcessorParams: (scope: ChainScope, trackId: string | null, processorId: string, params: Record<string, number>) => void;
  toggleProcessor: (scope: ChainScope, trackId: string | null, processorId: string) => void;
  removeProcessor: (scope: ChainScope, trackId: string | null, processorId: string) => void;
  duplicateProcessor: (scope: ChainScope, trackId: string | null, processorId: string) => void;
  moveProcessor: (scope: ChainScope, trackId: string | null, from: number, to: number) => void;
  resetProcessor: (scope: ChainScope, trackId: string | null, processorId: string) => void;
  setProcessorSidechain: (scope: ChainScope, trackId: string | null, processorId: string, sourceTrackId: string | null) => void;

  addTrack: (kind: TrackKind, name?: string) => void;
  removeTrack: (trackId: string) => void;
  updateTrack: (trackId: string, patch: Partial<TrackState>) => void;
  addBus: (name: string) => void;
  removeBus: (busId: string) => void;
  updateBus: (busId: string, patch: Partial<BusState>) => void;
  addSend: (trackId: string, busId: string) => void;
  removeSend: (trackId: string, busId: string) => void;
  updateSend: (trackId: string, busId: string, patch: { levelDb?: number; preFader?: boolean }) => void;
  setMasterVolume: (db: number) => void;
  updateMatchSettings: (patch: Partial<MatchSettings>) => void;

  togglePlay: () => Promise<void>;
  stop: () => void;
  seek: (seconds: number) => void;
  setLoop: (enabled: boolean, start?: number, end?: number) => void;
  setMonitorDb: (db: number) => void;

  generateMatch: () => Promise<void>;
  applyMatchPlan: (proposalIds?: string[]) => void;
  clearMatchPlan: () => void;
  verifyMaster: () => Promise<void>;

  setAssistantScope: (scope: 'master' | 'track') => void;
  sendAssistantMessage: (text: string) => Promise<void>;
  applyAssistantProposal: () => void;
  rejectAssistantProposal: () => void;
  toggleAssistant: () => void;

  applyPreset: (presetId: string, scope: 'master' | 'track', trackId?: string | null) => void;
  savePreset: (name: string, category: PresetCategory, description: string, scope: 'master' | 'track', trackId?: string | null) => Promise<void>;
  deleteUserPreset: (id: string) => Promise<void>;

  captureSlot: (label: string) => void;
  recallSlot: (id: string) => void;
  deleteSlot: (id: string) => void;
  restoreWorkingMix: () => void;
  setLoudnessMatch: (on: boolean) => void;

  exportMix: (settings: ExportSettings) => Promise<void>;
  refreshExports: () => Promise<void>;
  downloadExport: (id: string) => Promise<void>;
  deleteExportById: (id: string) => Promise<void>;
  setTargets: (lufs: number, truePeak: number) => void;
  clearAllData: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let engineTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(project: ProjectState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (useApp.getState().project?.autosave === false) return;
    void db.saveProject(project);
  }, 700);
}

function engineAssets(project: ProjectState, buffers: Record<string, AssetBuffer>): EngineAsset[] {
  const out: EngineAsset[] = [];
  for (const assetId of allAssetIds(project)) {
    const buffer = buffers[assetId];
    if (!buffer) continue;
    out.push({
      id: assetId,
      length: buffer.L.length,
      sampleRate: project.sampleRate,
      L: buffer.L,
      R: buffer.R,
    });
  }
  return out;
}

function syncEngine(project: ProjectState, buffers: Record<string, AssetBuffer>): void {
  if (engineTimer) clearTimeout(engineTimer);
  engineTimer = setTimeout(() => {
    try {
      realtimeHost.loadAssets(engineAssets(project, buffers));
      realtimeHost.pushProject(project);
    } catch (error) {
      useApp.setState({ engineError: error instanceof Error ? error.message : String(error) });
    }
  }, 45);
}

function parseAssistantToolArguments(value: unknown): Record<string, unknown> {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error('The AI returned invalid tool arguments.');
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The AI returned invalid tool arguments.');
  }
  return parsed as Record<string, unknown>;
}

function describeSessionOnlyStorage(reason: string | null): string {
  return `Sonora cannot save to this browser's database (${reason ?? 'storage unavailable'}), so it is running in session-only mode. You can create a project and work normally, but everything is lost when you reload. Open Sonora in a normal browser tab to keep your work.`;
}

function describeStorageError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Sonora cannot use this browser's local storage, so projects cannot be saved. Open Sonora in its own browser tab and turn off strict storage blocking. (${detail})`;
}

function emptyProject(): ProjectState {
  const project = newProject('Untitled project', 48000);
  return project;
}

export const useApp = create<AppState>((set, get) => ({
  screen: 'dashboard',
  mode: 'advanced',
  projects: [],
  project: null,
  assets: [],
  assetBuffers: {},
  analyses: {},
  matchPlan: null,
  matchPreview: null,
  presets: [...BUILT_IN_PRESETS],
  exports: [],
  selectedTrackId: null,
  selectedProcessorId: null,
  selectedAssetId: null,
  assistantOpen: false,
  assistantScope: 'master',
  chat: [],
  assistantProposal: null,
  busy: null,
  toast: null,
  transport: { playing: false, position: 0, loopEnabled: false, loopStart: 0, loopEnd: 0, duration: 0 },
  abSlots: [],
  activeSlot: null,
  workingMix: null,
  loudnessMatch: false,
  comparisonDb: 0,
  monitorDb: 0,
  history: [],
  future: [],
  lastCoalesceKey: null,
  lastCoalesceAt: 0,
  lastSavedAt: null,
  lastRenderStats: null,
  engineError: null,
  storageError: null,
  verifying: false,

  init: async () => {
    let mode: Mode = 'advanced';
    try {
      mode = (localStorage.getItem('sonora:mode') as Mode) ?? 'advanced';
    } catch {
      // Storage can be blocked in embedded views and strict privacy modes.
    }
    try {
      const projects = await db.listProjects();
      const userPresets = await db.listUserPresets();
      const storage = db.storageStatus();
      set({
        projects,
        presets: [...BUILT_IN_PRESETS, ...userPresets],
        mode,
        storageError: storage.persistent ? null : describeSessionOnlyStorage(storage.reason),
      });
    } catch (error) {
      set({ mode, storageError: describeStorageError(error) });
    }
    realtimeHost.onPosition((position, playing) => {
      set((state) => ({ transport: { ...state.transport, position, playing } }));
    });
    realtimeHost.onEnded(() => {
      set((state) => ({ transport: { ...state.transport, playing: false, position: 0 } }));
    });
    realtimeHost.onMeters(() => {
      // Meters are pulled by the UI at animation rate through the host's last
      // message; the canvas components read from the exposed global below.
      const meters = realtimeHost.lastMeters;
      if (meters) latestMeters = meters;
    });
  },

  setScreen: (screen) => set({ screen }),
  setMode: (mode) => {
    try {
      localStorage.setItem('sonora:mode', mode);
    } catch {
      // Keep the choice for this session even when it cannot be persisted.
    }
    set({ mode });
  },
  setToast: (toast) => set({ toast }),
  clearBusy: () => set({ busy: null }),
  selectTrack: (selectedTrackId) => set({ selectedTrackId, selectedProcessorId: null }),
  selectProcessor: (selectedProcessorId) => set({ selectedProcessorId }),
  selectAsset: (selectedAssetId) => set({ selectedAssetId }),

  createProject: async (name) => {
    try {
      await realtimeHost.initialise();
    } catch (error) {
      set({ engineError: error instanceof Error ? error.message : String(error) });
    }
    const rate = realtimeHost.sampleRate;
    const project = newProject(name ?? 'Untitled project', rate);
    project.match = defaultMatchSettings();
    try {
      await db.saveProject(project);
    } catch (error) {
      set({ storageError: describeStorageError(error), toast: 'Could not create the project: this browser is blocking local storage.' });
      return;
    }
    set({
      project,
      assets: [],
      assetBuffers: {},
      analyses: {},
      matchPlan: null,
      matchPreview: null,
      selectedTrackId: null,
      selectedProcessorId: null,
      exports: [],
      abSlots: [],
      activeSlot: null,
      workingMix: null,
      loudnessMatch: false,
      comparisonDb: 0,
      history: [],
      future: [],
      transport: { playing: false, position: 0, loopEnabled: false, loopStart: 0, loopEnd: 0, duration: 0 },
      screen: 'studio',
    });
    await get().init();
    syncEngine(project, {});
  },

  openProject: async (id) => {
    set({ busy: { kind: 'load', label: 'Opening project', progress: 0 } });
    try {
      await realtimeHost.initialise().catch((error) => {
        set({ engineError: error instanceof Error ? error.message : String(error) });
      });
      const rate = realtimeHost.sampleRate;
      const project = await db.getProject(id);
      if (!project) throw new Error('Project not found');
      const assets = await db.listAssets(id);
      const analyses = await db.loadAnalyses(assets.map((a) => a.id));
      const exports = await db.listExports(id);
      const buffers: Record<string, AssetBuffer> = {};
      const targetRate = rate || project.sampleRate;
      let count = 0;
      for (const meta of assets) {
        const blob = await db.getAssetBlob(meta.id);
        if (!blob) continue;
        set({
          busy: {
            kind: 'decode',
            label: `Decoding ${meta.name}`,
            progress: count / Math.max(1, assets.length),
          },
        });
        try {
          const file = new File([blob], meta.name, { type: meta.mimeType });
          const decoded = await decodeAudioFile(file);
          const converted =
            decoded.sampleRate === targetRate
              ? { L: decoded.L, R: decoded.R }
              : await resampleToRate(decoded.L, decoded.R, decoded.sampleRate, targetRate);
          buffers[meta.id] = {
            L: converted.L,
            R: converted.R,
            sampleRate: targetRate,
            peaks: computePeaks(converted.L, converted.R),
          };
        } catch (error) {
          set({ toast: `Could not restore ${meta.name}: ${error instanceof Error ? error.message : String(error)}` });
        }
        count++;
      }
      project.sampleRate = targetRate;
      await db.saveProject(project);
      set({
        project,
        assets,
        analyses,
        exports,
        abSlots: [],
        activeSlot: null,
        workingMix: null,
        loudnessMatch: false,
        comparisonDb: 0,
        assetBuffers: buffers,
        selectedTrackId: project.tracks[0]?.id ?? null,
        selectedProcessorId: null,
        selectedAssetId: assets[0]?.id ?? null,
        screen: 'studio',
        busy: null,
        history: [],
        future: [],
        matchPlan: null,
        transport: {
          playing: false,
          position: 0,
          loopEnabled: false,
          loopStart: 0,
          loopEnd: Math.max(...project.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)), 0),
          duration: Math.max(...project.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)), 0),
        },
      });
      syncEngine(project, buffers);
      await get().init();
    } catch (error) {
      set({ busy: null, toast: error instanceof Error ? error.message : String(error) });
    }
  },

  closeProject: () => {
    realtimeHost.stop();
    realtimeHost.setComparisonGain(0);
    set({ project: null, assets: [], assetBuffers: {}, analyses: {}, matchPlan: null, abSlots: [], activeSlot: null, workingMix: null, loudnessMatch: false, comparisonDb: 0, screen: 'projects' });
  },

  deleteProjectById: async (id) => {
    await db.deleteProject(id);
    if (get().project?.id === id) get().closeProject();
    await get().init();
    set({ toast: 'Project deleted.' });
  },

  duplicateProjectById: async (id) => {
    const project = await db.getProject(id);
    if (!project) return;
    await db.duplicateProject(project, uid('prj'));
    await get().init();
    set({ toast: 'Project duplicated (audio assets are shared references in this build).' });
  },

  importFiles: async (files, role) => {
    if (!files.length) return;
    if (!get().project) {
      await get().createProject();
    }
    const project = get().project!;
    const targetRate = project.sampleRate || realtimeHost.sampleRate;
    const createdAssets: AudioAssetMeta[] = [];
    const newBuffers: Record<string, AssetBuffer> = {};
    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        set({
          busy: {
            kind: 'import',
            label: `Decoding ${file.name}`,
            progress: index / files.length,
          },
        });
        const decoded = await decodeAudioFile(file);
        const converted =
          decoded.sampleRate === targetRate
            ? { L: decoded.L, R: decoded.R }
            : await resampleToRate(decoded.L, decoded.R, decoded.sampleRate, targetRate);
        const id = uid('asset');
        const peaks = computePeaks(converted.L, converted.R);
        const meta: AudioAssetMeta = {
          id,
          projectId: project.id,
          name: file.name.replace(/\.[^.]+$/, ''),
          role,
          mimeType: file.type || 'application/octet-stream',
          fileSize: file.size,
          duration: converted.L.length / targetRate,
          sampleRate: decoded.sampleRate,
          channels: decoded.channels,
          bitDepth: decoded.header?.bitDepth ?? null,
          peakDb: (() => {
            let p = 0;
            for (let i = 0; i < converted.L.length; i++) p = Math.max(p, Math.abs(converted.L[i]), Math.abs(converted.R[i]));
            return p > 0 ? 20 * Math.log10(p) : -Infinity;
          })(),
          lufs: null,
          createdAt: Date.now(),
          decodedOnly: decoded.decodedOnly,
        };
        await db.saveAsset(meta, file);
        createdAssets.push(meta);
        newBuffers[id] = { L: converted.L, R: converted.R, sampleRate: targetRate, peaks };
        if (decoded.warnings.length) set({ toast: decoded.warnings.join(' ') });
      }

      const assets = [...get().assets, ...createdAssets];
      const buffers = { ...get().assetBuffers, ...newBuffers };
      set({ assets, assetBuffers: buffers });

      get().mutate((next) => {
        for (const meta of createdAssets) {
          if (role === 'reference') {
            next.referenceAssetIds.push(meta.id);
            const track = createTrack('reference', `REF · ${meta.name}`, next.tracks.length);
            track.color = '#5ad1e6';
            track.muted = true;
            track.clips.push(createClip(meta.id, meta.duration));
            track.height = 56;
            next.tracks.push(track);
          } else if (role === 'stem') {
            const track = createTrack('stem', meta.name, next.tracks.length);
            track.clips.push(createClip(meta.id, meta.duration));
            next.tracks.push(track);
            // Keep the original target available but muted once stems exist.
            for (const t of next.tracks) if (t.kind === 'audio') t.muted = true;
          } else {
            next.targetAssetIds.push(meta.id);
            const track = createTrack('audio', meta.name, next.tracks.length);
            track.clips.push(createClip(meta.id, meta.duration));
            next.tracks.push(track);
          }
        }
        const duration = Math.max(
          0,
          ...next.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)),
        );
        set((state) => ({
          transport: { ...state.transport, duration, loopStart: 0, loopEnd: duration },
        }));
      });
      const nextProject = get().project!;
      syncEngine(nextProject, buffers);
      set({ busy: null, toast: `${files.length} file${files.length > 1 ? 's' : ''} imported at ${targetRate} Hz.` });
      if (role === 'target' || role === 'reference') {
        for (const meta of createdAssets) {
          await get().analyzeAsset(meta.id);
        }
      }
    } catch (error) {
      set({ busy: null, toast: error instanceof Error ? error.message : String(error) });
    }
  },

  analyzeAsset: async (assetId) => {
    const buffer = get().assetBuffers[assetId];
    if (!buffer) {
      set({ toast: 'Audio is still loading.' });
      return null;
    }
    set({ busy: { kind: 'analyze', label: 'Measuring audio', progress: 0 } });
    try {
      const worker = new Worker(new URL('../audio/analysis/analysis.worker.ts', import.meta.url), { type: 'module' });
      const report = await new Promise<AnalysisReport>((resolve, reject) => {
        worker.onmessage = (event: MessageEvent) => {
          const message = event.data;
          if (message.type === 'progress') {
            set({
              busy: {
                kind: 'analyze',
                label: message.stage as string,
                progress: message.progress as number,
              },
            });
          } else if (message.type === 'done') {
            resolve(message.report as AnalysisReport);
          } else if (message.type === 'error') {
            reject(new Error(message.message as string));
          }
        };
        worker.onerror = () => reject(new Error('Analysis worker failed'));
        const L = buffer.L.slice();
        const R = buffer.R.slice();
        worker.postMessage(
          { type: 'analyze', assetId, L, R, sampleRate: buffer.sampleRate, includeSections: true },
          [L.buffer, R.buffer],
        );
      });
      worker.terminate();
      const analyses = { ...get().analyses, [assetId]: report };
      await db.saveAnalysis(assetId, report);
      const assets = get().assets.map((a) =>
        a.id === assetId ? { ...a, lufs: report.loudness.integratedLufs, peakDb: report.loudness.samplePeakDb } : a,
      );
      set({ assets, analyses, busy: null });
      return report;
    } catch (error) {
      set({ busy: null, toast: error instanceof Error ? `Analysis failed: ${error.message}` : 'Analysis failed' });
      return null;
    }
  },

  analyzeProjectAssets: async () => {
    const ids = allAssetIds(get().project ?? emptyProject());
    for (const id of ids) {
      if (!get().analyses[id]) await get().analyzeAsset(id);
    }
  },

  removeReference: (assetId) => {
    get().mutate((project) => {
      project.referenceAssetIds = project.referenceAssetIds.filter((id) => id !== assetId);
      project.tracks = project.tracks.filter((t) => !(t.kind === 'reference' && t.clips.some((c) => c.assetId === assetId)));
    });
    set((state) => {
      const analyses = { ...state.analyses };
      delete analyses[assetId];
      return { analyses, matchPlan: null, matchPreview: null };
    });
  },

  mutate: (mutator, options) => {
    const state = get();
    if (!state.project) return;
    const previous = cloneProject(state.project);
    const next = cloneProject(state.project);
    mutator(next);
    next.updatedAt = Date.now();
    const masterChanged = JSON.stringify(previous.master) !== JSON.stringify(next.master);
    const clearAudition = masterChanged && state.activeSlot !== null && !options?.preserveAb;
    const coalesce = options?.coalesce;
    const shouldCoalesce =
      Boolean(coalesce) && state.lastCoalesceKey === coalesce && Date.now() - state.lastCoalesceAt < 800;
    set({
      project: next,
      history: shouldCoalesce ? state.history : [...state.history.slice(-49), previous],
      future: [],
      lastCoalesceKey: coalesce ?? null,
      lastCoalesceAt: Date.now(),
      ...(clearAudition ? { activeSlot: null, workingMix: null, comparisonDb: 0 } : {}),
    });
    if (clearAudition) realtimeHost.setComparisonGain(0);
    schedulePersist(next);
    syncEngine(next, get().assetBuffers);
  },

  undo: () => {
    const { history, project, future } = get();
    if (!history.length || !project) return;
    const previous = history[history.length - 1];
    set({
      project: previous,
      history: history.slice(0, -1),
      future: [project, ...future].slice(0, 50),
      selectedProcessorId: null,
    });
    schedulePersist(previous);
    syncEngine(previous, get().assetBuffers);
  },

  redo: () => {
    const { future, project, history } = get();
    if (!future.length || !project) return;
    const next = future[0];
    set({
      project: next,
      future: future.slice(1),
      history: [...history, project].slice(-50),
      selectedProcessorId: null,
    });
    schedulePersist(next);
    syncEngine(next, get().assetBuffers);
  },

  saveNow: async () => {
    const project = get().project;
    if (!project) return;
    await db.saveProject(project);
    set({ lastSavedAt: Date.now() });
  },

  addProcessor: (scope, trackId, type, params) => {
    const node = createProcessorNode(type, params);
    get().mutate((project) => {
      const chain = chainFor(project, scope, trackId);
      if (!chain) return;
      chain.push(node);
    });
    set({ selectedProcessorId: node.id });
  },

  updateProcessorParams: (scope, trackId, processorId, params) => {
    get().mutate(
      (project) => {
        const chain = chainFor(project, scope, trackId);
        const node = chain?.find((p) => p.id === processorId);
        if (node) node.params = { ...node.params, ...params };
      },
      { coalesce: `param:${processorId}` },
    );
  },

  toggleProcessor: (scope, trackId, processorId) => {
    get().mutate((project) => {
      const node = chainFor(project, scope, trackId)?.find((p) => p.id === processorId);
      if (node) node.enabled = !node.enabled;
    });
  },

  removeProcessor: (scope, trackId, processorId) => {
    get().mutate((project) => {
      const chain = chainFor(project, scope, trackId);
      if (!chain) return;
      const index = chain.findIndex((p) => p.id === processorId);
      if (index >= 0) chain.splice(index, 1);
    });
    if (get().selectedProcessorId === processorId) set({ selectedProcessorId: null });
  },

  duplicateProcessor: (scope, trackId, processorId) => {
    get().mutate((project) => {
      const chain = chainFor(project, scope, trackId);
      if (!chain) return;
      const index = chain.findIndex((p) => p.id === processorId);
      if (index < 0) return;
      const copy: ProcessorNodeState = {
        ...structuredClone(chain[index]),
        id: uid('proc'),
        enabled: true,
      };
      chain.splice(index + 1, 0, copy);
    });
  },

  moveProcessor: (scope, trackId, from, to) => {
    get().mutate((project) => {
      const chain = chainFor(project, scope, trackId);
      if (!chain || from < 0 || from >= chain.length) return;
      const [node] = chain.splice(from, 1);
      chain.splice(Math.max(0, Math.min(chain.length, to)), 0, node);
    });
  },

  resetProcessor: (scope, trackId, processorId) => {
    get().mutate((project) => {
      const node = chainFor(project, scope, trackId)?.find((p) => p.id === processorId);
      if (!node) return;
      const fresh = createProcessorNode(node.type);
      node.params = fresh.params;
    });
  },

  setProcessorSidechain: (scope, trackId, processorId, sourceTrackId) => {
    get().mutate((project) => {
      const node = chainFor(project, scope, trackId)?.find((p) => p.id === processorId);
      if (node) node.sidechainFrom = sourceTrackId;
    });
  },

  addTrack: (kind, name) => {
    get().mutate((project) => {
      const track = createTrack(kind, name ?? `${kind[0].toUpperCase()}${kind.slice(1)} ${project.tracks.length + 1}`, project.tracks.length);
      project.tracks.push(track);
      set({ selectedTrackId: track.id });
    });
  },

  removeTrack: (trackId) => {
    get().mutate((project) => {
      project.tracks = project.tracks.filter((t) => t.id !== trackId);
    });
    if (get().selectedTrackId === trackId) set({ selectedTrackId: null });
  },

  updateTrack: (trackId, patch) => {
    get().mutate((project) => {
      const track = findTrack(project, trackId);
      if (track) Object.assign(track, patch);
    });
  },

  addBus: (name) => {
    get().mutate((project) => {
      project.buses.push(createBus(name, project.buses.length));
    });
  },

  removeBus: (busId) => {
    get().mutate((project) => {
      project.buses = project.buses.filter((b) => b.id !== busId);
      for (const track of project.tracks) {
        track.sends = track.sends.filter((s) => s.busId !== busId);
        if (track.output === busId) track.output = null;
      }
    });
  },

  updateBus: (busId, patch) => {
    get().mutate((project) => {
      const bus = project.buses.find((b) => b.id === busId);
      if (bus) Object.assign(bus, patch);
    });
  },

  addSend: (trackId, busId) => {
    get().mutate((project) => {
      const track = findTrack(project, trackId);
      if (!track || track.sends.some((s) => s.busId === busId)) return;
      track.sends.push({ busId, levelDb: -12, preFader: false });
    });
  },

  removeSend: (trackId, busId) => {
    get().mutate((project) => {
      const track = findTrack(project, trackId);
      if (track) track.sends = track.sends.filter((s) => s.busId !== busId);
    });
  },

  updateSend: (trackId, busId, patch) => {
    get().mutate((project) => {
      const send = findTrack(project, trackId)?.sends.find((s) => s.busId === busId);
      if (send) Object.assign(send, patch);
    });
  },

  setMasterVolume: (dbValue) => {
    get().mutate((project) => {
      project.master.volumeDb = dbValue;
    });
  },

  updateMatchSettings: (patch) => {
    get().mutate((project) => {
      project.match = { ...project.match, ...patch };
    });
    const project = get().project;
    if (project && get().matchPlan) {
      const preview = computeMatchPreview(project, get().analyses);
      set({ matchPreview: preview });
    }
  },

  setTargets: (lufs, truePeak) => {
    get().mutate((project) => {
      project.targetLufs = lufs;
      project.targetTruePeak = truePeak;
    });
  },

  togglePlay: async () => {
    const { project, assetBuffers, transport } = get();
    if (!project) return;
    try {
      await realtimeHost.initialise();
    } catch (error) {
      set({ engineError: error instanceof Error ? error.message : String(error), toast: 'Audio engine could not start.' });
      return;
    }
    realtimeHost.loadAssets(engineAssets(project, assetBuffers));
    realtimeHost.pushProject(project);
    realtimeHost.setMonitorGain(get().monitorDb);
    realtimeHost.setComparisonGain(get().comparisonDb);
    realtimeHost.setLoop(transport.loopEnabled, transport.loopStart, transport.loopEnd);
    if (transport.playing) {
      realtimeHost.pause();
      set((state) => ({ transport: { ...state.transport, playing: false } }));
    } else {
      await realtimeHost.play(transport.position);
      set((state) => ({ transport: { ...state.transport, playing: true } }));
    }
  },

  stop: () => {
    realtimeHost.stop();
    set((state) => ({ transport: { ...state.transport, playing: false, position: 0 } }));
  },

  seek: (seconds) => {
    realtimeHost.seek(Math.max(0, seconds));
    set((state) => ({ transport: { ...state.transport, position: Math.max(0, seconds) } }));
  },

  setLoop: (enabled, start, end) => {
    set((state) => {
      const loopStart = start ?? state.transport.loopStart;
      const loopEnd = end ?? state.transport.loopEnd;
      realtimeHost.setLoop(enabled, loopStart, loopEnd);
      return { transport: { ...state.transport, loopEnabled: enabled, loopStart, loopEnd } };
    });
  },

  setMonitorDb: (dbValue) => {
    realtimeHost.setMonitorGain(dbValue);
    set({ monitorDb: dbValue });
  },

  generateMatch: async () => {
    const { project, analyses, assets } = get();
    if (!project) return;
    const targetId = project.targetAssetIds[0];
    if (!targetId || !analyses[targetId]) {
      set({ toast: 'Analyse a target song first.' });
      return;
    }
    const references = project.referenceAssetIds
      .filter((id) => analyses[id])
      .map((id) => ({ assetId: id, report: analyses[id], weight: project.match.referenceWeights?.[id] ?? 100 }));
    if (!references.length) {
      set({ toast: 'Analyse at least one reference track first.' });
      return;
    }
    set({ busy: { kind: 'match', label: 'Comparing measurements', progress: 0.4 } });
    try {
      const plan = generateMatchPlan({
        settings: project.match,
        target: analyses[targetId],
        references,
        targetTruePeakDb: project.targetTruePeak,
      });
      const preview = computeMatchPreview(project, analyses);
      set({ matchPlan: plan, matchPreview: preview, busy: null });
    } catch (error) {
      set({ busy: null, toast: error instanceof Error ? error.message : 'Matching failed.' });
    }
    void assets;
  },

  applyMatchPlan: (proposalIds) => {
    const plan = get().matchPlan;
    if (!plan) return;
    const selectedPlan = proposalIds
      ? { ...plan, proposals: plan.proposals.filter((p) => proposalIds.includes(p.id)) }
      : plan;
    get().mutate((project) => {
      project.master.processors = planToNodes(selectedPlan);
      project.match.enabled = true;
    });
    set({
      toast: `Applied ${selectedPlan.proposals.length} processor${selectedPlan.proposals.length === 1 ? '' : 's'} to the master chain. Every parameter is editable.`,
    });
  },

  clearMatchPlan: () => set({ matchPlan: null, matchPreview: null }),

  verifyMaster: async () => {
    const { project } = get();
    if (!project) return;
    set({ verifying: true, busy: { kind: 'render', label: 'Rendering master for verification', progress: 0 } });
    try {
      const result = await renderProject(get, {
        mode: 'master',
        startSec: 0,
        endSec: timelineDuration(project),
      });
      const targetId = project.targetAssetIds[0];
      const targetReport = targetId ? get().analyses[targetId] : undefined;
      if (targetReport) {
        const before = targetReport.loudness.integratedLufs;
        set({
          toast: `Measured master: ${result.stats.lufs.toFixed(1)} LUFS, ${result.stats.truePeakDb.toFixed(1)} dBTP (source was ${before.toFixed(1)} LUFS).`,
          lastRenderStats: result.stats,
        });
      } else {
        set({ toast: `Measured master: ${result.stats.lufs.toFixed(1)} LUFS, ${result.stats.truePeakDb.toFixed(1)} dBTP.` });
      }
      set({ verifying: false, busy: null });
    } catch (error) {
      set({ verifying: false, busy: null, toast: error instanceof Error ? error.message : 'Verification failed.' });
    }
  },

  toggleAssistant: () => set((state) => ({ assistantOpen: !state.assistantOpen })),

  setAssistantScope: (scope) => set({ assistantScope: scope, assistantProposal: null }),

  sendAssistantMessage: async (text) => {
    const initial = get();
    if (!initial.project || !text.trim()) return;

    const userMessage: ChatMessage = { id: uid('msg'), role: 'user', text: text.trim() };
    const priorMessages = initial.chat.slice(-14);
    const conversation = [
      ...priorMessages.map((message) => ({ role: message.role, content: message.text })),
      { role: 'user', content: text.trim() },
    ];
    set({
      chat: [...initial.chat, userMessage],
      busy: { kind: 'assistant', label: 'Sonora AI is thinking', progress: 0.08 },
      toast: null,
    });

    const makeContext = () => {
      const state = get();
      if (!state.project) throw new Error('The project was closed while the assistant was working.');
      return buildAssistantContext({
        project: state.project,
        assets: state.assets,
        analyses: state.analyses,
        mode: state.mode,
        scope: state.assistantScope,
        selectedTrackId: state.selectedTrackId,
        matchPlan: state.matchPlan,
        lastRenderStats: state.lastRenderStats,
      });
    };

    const offlineReply = (reason: string) => {
      const state = get();
      const project = state.project;
      if (!project) return;
      const track = findTrack(project, state.selectedTrackId);
      const scope = state.assistantScope === 'track' && track ? 'track' : 'master';
      const processors = scope === 'master' ? project.master.processors : track?.processors ?? [];
      const proposal = interpretCommand(
        text,
        {
          scope,
          trackId: track?.id,
          trackName: track?.name,
          trackKind: track?.kind,
          processors,
          hasReference: project.referenceAssetIds.length > 0,
          multiTrack: project.tracks.filter((item) => item.clips.length > 0 && item.kind !== 'reference').length > 1,
        },
        state.assistantProposal,
      );
      const assistantMessage: ChatMessage = {
        id: uid('msg'),
        role: 'assistant',
        text: `Offline assistant used. ${reason} ${proposal.message}`,
        detail: [...proposal.explanation, 'The offline assistant recognizes a limited set of mixing commands. Configure the server-side AI key to enable natural-language reasoning.'],
        proposalId: proposal.operations.length ? proposal.id : undefined,
      };
      set((current) => ({
        chat: [...current.chat, assistantMessage],
        assistantProposal: proposal.operations.length ? proposal : proposal.requiresReference ? proposal : null,
        busy: null,
      }));
    };

    try {
      let input: unknown[] = conversation;
      let response = await requestSonoraAi(input, makeContext());
      let finalText = '';
      let proposalCreated = false;
      let analysisRequests = 0;

      for (let cycle = 0; cycle < 4; cycle++) {
        const calls = response.output.filter((item) => item.type === 'function_call');
        if (!calls.length) {
          finalText = response.outputText;
          break;
        }

        set({ busy: { kind: 'assistant', label: 'Checking Sonora audio tools', progress: 0.2 + cycle * 0.15 } });
        const outputs: Record<string, unknown>[] = [];
        const analysisCalls = calls.filter((call) => call.name === 'request_audio_analysis');
        const proposalCalls = calls.filter((call) => call.name === 'propose_processor_changes');

        for (const call of analysisCalls) {
          let output: Record<string, unknown>;
          try {
            const args = parseAssistantToolArguments(call.arguments);
            const assetId = typeof args.assetId === 'string' ? args.assetId : '';
            const state = get();
            const asset = state.assets.find((item) => item.id === assetId);
            if (!asset) throw new Error('That asset is not part of the current project.');
            let report: AnalysisReport | undefined = state.analyses[assetId];
            if (!report) {
              if (++analysisRequests > 3) throw new Error('The assistant may request analysis for at most three assets per turn.');
              const analyzed = await get().analyzeAsset(assetId);
              report = analyzed ?? undefined;
            }
            if (!report) throw new Error('Sonora could not produce an analysis report for that audio.');
            output = {
              ok: true,
              assetId,
              assetName: asset.name,
              integratedLufs: report.loudness.integratedLufs,
              truePeakDbtp: report.loudness.truePeakDb,
              message: 'Local audio analysis completed. The refreshed project context contains the full measured report.',
            };
          } catch (error) {
            output = { ok: false, error: error instanceof Error ? error.message : 'Audio analysis failed.' };
          }
          outputs.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify(output),
          });
        }

        // If analysis was requested in this response, force a fresh reasoning pass
        // before accepting any simultaneously returned proposal.
        if (analysisCalls.length > 0) {
          for (const call of proposalCalls) {
            outputs.push({
              type: 'function_call_output',
              call_id: call.call_id,
              output: JSON.stringify({ ok: false, message: 'Audio analysis was just requested. Re-evaluate the refreshed analysis context before creating a proposal.' }),
            });
          }
        } else {
          for (const call of proposalCalls) {
            let output: Record<string, unknown>;
            try {
              const args = parseAssistantToolArguments(call.arguments);
              const currentProject = get().project;
              if (!currentProject) throw new Error('No project is open.');
              const proposal = createValidatedAiProposal(args, currentProject);
              set({ assistantProposal: proposal });
              proposalCreated = true;
              output = {
                ok: true,
                proposalId: proposal.id,
                operationCount: proposal.operations.length,
                message: 'A validated preview proposal is now waiting for user approval. No project changes have been applied.',
              };
            } catch (error) {
              output = { ok: false, error: error instanceof Error ? error.message : 'The proposal failed validation.' };
            }
            outputs.push({
              type: 'function_call_output',
              call_id: call.call_id,
              output: JSON.stringify(output),
            });
          }
        }

        const handledCalls = analysisCalls.length + proposalCalls.length;
        const unknownCalls = calls.filter((call) =>
          call.name !== 'request_audio_analysis' && call.name !== 'propose_processor_changes',
        );
        for (const call of unknownCalls) {
          outputs.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify({ ok: false, error: 'This tool is not available in Sonora.' }),
          });
        }

        if (outputs.length === 0 || handledCalls === 0 && unknownCalls.length === 0) {
          finalText = response.outputText;
          break;
        }
        input = [...input, ...response.output, ...outputs];
        response = await requestSonoraAi(input, makeContext());
        if (cycle === 3) finalText = response.outputText;
      }

      if (!finalText.trim()) {
        finalText = proposalCreated
          ? 'I prepared a validated processing preview. Review the proposed operations below before accepting them.'
          : 'I checked the available project context. Please tell me which part of the sound you would like to improve.';
      }
      const assistantMessage: ChatMessage = {
        id: uid('msg'),
        role: 'assistant',
        text: finalText,
        detail: proposalCreated ? ['A processing preview is ready. Nothing has changed until you accept it.'] : undefined,
        proposalId: get().assistantProposal?.id,
      };
      set((state) => ({ chat: [...state.chat, assistantMessage], busy: null }));
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'The AI service is unavailable.';
      offlineReply(`AI backend unavailable (${reason}).`);
    }
  },

  applyAssistantProposal: () => {
    const proposal = get().assistantProposal;
    if (!proposal) return;
    const scaleValue = (base: Record<string, number> | undefined, params: Record<string, number>, factor: number): Record<string, number> => {
      if (!base || factor === 1) return params;
      const merged = { ...params };
      for (const key of Object.keys(params)) {
        const before = base[key];
        const after = params[key];
        if (typeof before === 'number' && typeof after === 'number') {
          merged[key] = before + (after - before) * factor;
        }
      }
      return merged;
    };
    get().mutate((project) => {
      const idMap = new Map<string, string>();
      const operationKey = (op: AssistantProposal['operations'][number]) =>
        `${op.scope}:${op.trackId ?? 'master'}:${op.processorId ?? ''}`;
      for (const op of proposal.operations) {
        const chain = chainFor(project, op.scope, op.trackId ?? null);
        if (!chain) continue;
        const key = operationKey(op);
        if (op.kind === 'add') {
          const params = scaleValue(op.base, op.params ?? {}, proposal.scale ?? 1);
          const node = createProcessorNode(op.processorType ?? 'eq', params);
          node.note = op.note;
          idMap.set(key, node.id);
          chain.push(node);
        } else if (op.kind === 'update') {
          const realId = idMap.get(key) ?? op.processorId;
          const node = chain.find((processor) => processor.id === realId);
          if (node) node.params = { ...node.params, ...scaleValue(op.base, op.params ?? {}, proposal.scale ?? 1) };
        } else if (op.kind === 'remove') {
          const realId = idMap.get(key) ?? op.processorId;
          const index = chain.findIndex((processor) => processor.id === realId);
          if (index >= 0) chain.splice(index, 1);
        } else if (op.kind === 'bypass' || op.kind === 'enable') {
          const realId = idMap.get(key) ?? op.processorId;
          const node = chain.find((processor) => processor.id === realId);
          if (node) node.enabled = op.kind === 'enable';
        }
      }
    });
    set((state) => ({
      chat: [
        ...state.chat,
        {
          id: uid('msg'),
          role: 'assistant',
          text: proposal.operations.length
            ? `Applied ${proposal.operations.length} change${proposal.operations.length > 1 ? 's' : ''}. Use undo if it is not what you wanted.`
            : 'Nothing was applied.',
        },
      ],
      assistantProposal: null,
    }));
  },

  rejectAssistantProposal: () => set({ assistantProposal: null }),

  applyPreset: (presetId, scope, trackId) => {
    const preset = get().presets.find((p) => p.id === presetId);
    if (!preset) return;
    get().mutate((project) => {
      const chain = chainFor(project, scope, trackId ?? null);
      if (!chain) return;
      chain.splice(0, chain.length, ...preset.processors.map((p) => createProcessorNode(p.type, p.params)));
    });
    set({ toast: `Preset "${preset.name}" loaded. All parameters remain editable.` });
  },

  savePreset: async (name, category, description, scope, trackId) => {
    const project = get().project;
    if (!project) return;
    const chain = chainFor(project, scope, trackId ?? null);
    if (!chain) return;
    const preset = createPreset(
      name,
      category,
      description,
      chain.map((node) => ({ type: node.type, params: { ...node.params } })),
    );
    await db.savePreset(preset);
    set((state) => ({ presets: [...state.presets, preset], toast: 'Preset saved to your library.' }));
  },

  deleteUserPreset: async (id) => {
    await db.deletePreset(id);
    set((state) => ({ presets: state.presets.filter((p) => p.id !== id) }));
  },

  captureSlot: async (label) => {
    const initial = get();
    const project = initial.project;
    if (!project) return;
    if (initial.busy) {
      set({ toast: 'Finish the current task before measuring an A/B version.' });
      return;
    }
    const capturedProject = cloneProject(project);
    const projectId = project.id;
    try {
      const result = await renderProject(get, {
        mode: 'master',
        startSec: 0,
        endSec: timelineDuration(capturedProject),
        label: `Measuring version ${label}`,
      });
      const currentProject = get().project;
      if (!currentProject || currentProject.id !== projectId) {
        set({ busy: null, toast: 'A/B capture discarded because the open project changed.' });
        return;
      }
      const slot: ABSlot = {
        id: uid('slot'),
        label,
        processors: structuredClone(capturedProject.master.processors),
        volumeDb: capturedProject.master.volumeDb,
        lufs: Number.isFinite(result.stats.lufs) ? result.stats.lufs : null,
        truePeakDb: Number.isFinite(result.stats.truePeakDb) ? result.stats.truePeakDb : null,
        createdAt: Date.now(),
      };
      const state = get();
      const nextSlots = [...state.abSlots.filter((item) => item.label !== label), slot].slice(-8);
      const projectUnchanged = JSON.stringify(currentProject) === JSON.stringify(capturedProject);
      const nextActiveSlot = projectUnchanged ? slot.id : state.activeSlot;
      const nextWorkingMix = state.workingMix ?? (state.activeSlot === null
        ? {
            projectId,
            processors: structuredClone(capturedProject.master.processors),
            volumeDb: capturedProject.master.volumeDb,
          }
        : null);
      const comparisonDb = state.loudnessMatch
        ? loudnessMatchedMonitorGain(nextSlots, nextActiveSlot)
        : 0;
      realtimeHost.setComparisonGain(comparisonDb);
      set({
        abSlots: nextSlots,
        activeSlot: nextActiveSlot,
        workingMix: nextWorkingMix,
        comparisonDb,
        lastRenderStats: result.stats,
        busy: null,
        toast: projectUnchanged
          ? `Captured version ${label}: ${slot.lufs !== null ? slot.lufs.toFixed(1) + ' LUFS' : 'loudness unavailable'}.`
          : `Version ${label} was measured and saved, but the project changed during capture. Select it to audition the captured snapshot.`,
      });
    } catch (error) {
      set({ busy: null, toast: error instanceof Error ? `A/B capture failed: ${error.message}` : 'A/B capture failed.' });
    }
  },

  recallSlot: (id) => {
    const state = get();
    const slot = state.abSlots.find((item) => item.id === id);
    const project = state.project;
    if (!slot || !project) return;
    const workingMix = state.workingMix ?? (state.activeSlot === null
      ? {
          projectId: project.id,
          processors: structuredClone(project.master.processors),
          volumeDb: project.master.volumeDb,
        }
      : null);
    if (workingMix) set({ workingMix });
    get().mutate((next) => {
      next.master.processors = structuredClone(slot.processors);
      next.master.volumeDb = slot.volumeDb;
    }, { preserveAb: true });
    const comparisonDb = get().loudnessMatch
      ? loudnessMatchedMonitorGain(get().abSlots, slot.id)
      : 0;
    realtimeHost.setComparisonGain(comparisonDb);
    set({ activeSlot: slot.id, comparisonDb });
  },

  deleteSlot: (id) => {
    const state = get();
    const nextSlots = state.abSlots.filter((slot) => slot.id !== id);
    if (state.activeSlot === id) {
      get().restoreWorkingMix();
    }
    const current = get();
    const comparisonDb = current.loudnessMatch
      ? loudnessMatchedMonitorGain(nextSlots, current.activeSlot)
      : 0;
    realtimeHost.setComparisonGain(comparisonDb);
    set({
      abSlots: nextSlots,
      activeSlot: current.activeSlot === id ? null : current.activeSlot,
      comparisonDb: current.activeSlot === id ? 0 : comparisonDb,
    });
  },

  restoreWorkingMix: () => {
    const state = get();
    const project = state.project;
    const workingMix = state.workingMix;
    if (project && workingMix && project.id === workingMix.projectId) {
      get().mutate((next) => {
        next.master.processors = structuredClone(workingMix.processors);
        next.master.volumeDb = workingMix.volumeDb;
      }, { preserveAb: true });
    }
    realtimeHost.setComparisonGain(0);
    set({ activeSlot: null, workingMix: null, comparisonDb: 0 });
  },

  setLoudnessMatch: (on) => {
    const state = get();
    const comparisonDb = on
      ? loudnessMatchedMonitorGain(state.abSlots, state.activeSlot)
      : 0;
    realtimeHost.setComparisonGain(comparisonDb);
    set({ loudnessMatch: on, comparisonDb });
  },

  exportMix: async (settings) => {
    const project = get().project;
    if (!project) return;
    set({ busy: { kind: 'render', label: 'Rendering offline', progress: 0 } });
    try {
      const result = await renderProject(get, {
        mode: settings.mode,
        trackId: settings.trackId,
        startSec: settings.startSec,
        endSec: settings.endSec,
      });
      let L = result.L;
      let R = result.R;
      let sampleRate = result.sampleRate;

      // Convert to the requested delivery rate first. True-peak normalization
      // must operate on the final PCM rate, because SRC can change the
      // reconstructed inter-sample maximum.
      if (settings.sampleRate !== sampleRate) {
        set({ busy: { kind: 'render', label: `Resampling to ${settings.sampleRate} Hz`, progress: 0.9 } });
        const resampled = await resampleToRate(L, R, sampleRate, settings.sampleRate);
        L = resampled.L;
        R = resampled.R;
        sampleRate = settings.sampleRate;
      }

      if (settings.normalize) {
        set({ busy: { kind: 'render', label: 'Normalising to the true-peak target', progress: 0.93 } });
        normalizeToTruePeak(L, R, project.targetTruePeak ?? -1);
      }

      // Measure the final PCM after resampling and optional true-peak gain.
      const pcmReport = analyzeLoudness(L, R, sampleRate);
      let finalStats: RenderStats = {
        ...result.stats,
        lufs: pcmReport.integratedLufs,
        truePeakDb: pcmReport.truePeakDb,
        samplePeakDb: pcmReport.samplePeakDb,
        lra: pcmReport.lra,
        crestDb: pcmReport.crestDb,
        duration: L.length / sampleRate,
      };

      const filename = sanitizeFilename(settings.filename || project.name);
      const extension = settings.format === 'mp3' ? 'mp3' : settings.format;
      const exportName = `${filename}.${extension}`;
      let blob: Blob;
      if (settings.format === 'wav') {
        blob = encodeWav(L, R, {
          sampleRate,
          bitDepth: settings.bitDepth,
          dither: settings.dither,
          metadata: {
            title: settings.metadata.title || project.name,
            artist: settings.metadata.artist,
            comment: settings.metadata.comment,
            software: 'Sonora Reference Studio',
          },
        });
      } else if (settings.format === 'aiff') {
        if (settings.bitDepth === 32) throw new Error('AIFF export supports 16 or 24-bit. Choose WAV for 32-bit float.');
        blob = encodeAiff(L, R, sampleRate, settings.bitDepth === 16 ? 16 : 24);
      } else {
        blob = await encodeMp3(L, R, sampleRate);
      }

      // Download remains available even if the browser decoder cannot verify a
      // particular encoded stream. In that case, history keeps the final PCM
      // measurement and clearly reports that decoded-file verification failed.
      downloadBlob(blob, exportName);
      let encodedVerification: EncodedFileMeasurements | null = null;
      let verificationWarning: string | null = null;
      try {
        set({ busy: { kind: 'render', label: 'Verifying encoded delivery file', progress: 0.98 } });
        encodedVerification = await verifyEncodedBlob(blob);
      } catch (error) {
        verificationWarning = error instanceof Error ? error.message : String(error);
      }

      if (encodedVerification) {
        finalStats = {
          ...finalStats,
          lufs: encodedVerification.lufs,
          truePeakDb: encodedVerification.truePeakDb,
          samplePeakDb: encodedVerification.samplePeakDb,
          lra: encodedVerification.lra,
          crestDb: encodedVerification.crestDb,
          duration: encodedVerification.duration,
        };
      }

      const record: ExportRecord = {
        id: uid('export'),
        projectId: project.id,
        name: exportName,
        createdAt: Date.now(),
        format: settings.format.toUpperCase(),
        sampleRate,
        bitDepth: settings.format === 'mp3' ? 16 : settings.bitDepth,
        duration: finalStats.duration,
        lufs: finalStats.lufs,
        truePeak: finalStats.truePeakDb,
        sizeBytes: blob.size,
        settings: { ...settings },
      };
      await db.saveExport(record, blob);
      const measuredText = `${finalStats.lufs.toFixed(1)} LUFS · ${finalStats.truePeakDb.toFixed(1)} dBTP`;
      const toast = verificationWarning
        ? `Exported ${record.name} · pre-encode measurement ${measuredText}. Encoded-file verification unavailable: ${verificationWarning}`
        : `Exported and verified ${record.name} · ${measuredText}`;
      set((state) => ({
        exports: [record, ...state.exports],
        lastRenderStats: finalStats,
        busy: null,
        toast,
      }));
      if (settings.mode === 'master') {
        const masterVersion = {
          id: uid('master'),
          name: filename,
          createdAt: Date.now(),
          lufs: finalStats.lufs,
          truePeak: finalStats.truePeakDb,
          processors: structuredClone(project.master.processors),
        };
        get().mutate((p) => {
          p.masters.push(masterVersion);
        });
      }
    } catch (error) {
      set({ busy: null, toast: error instanceof Error ? error.message : 'Export failed.' });
    }
  },

  refreshExports: async () => {
    const project = get().project;
    if (!project) return;
    const exports = await db.listExports(project.id);
    set({ exports });
  },

  downloadExport: async (id) => {
    const blob = await db.getExportBlob(id);
    const record = get().exports.find((e) => e.id === id);
    if (!blob || !record) return;
    downloadBlob(blob, record.name);
  },

  deleteExportById: async (id) => {
    await db.deleteExport(id);
    set((state) => ({ exports: state.exports.filter((e) => e.id !== id) }));
  },

  clearAllData: async () => {
    await db.clearAllData();
    set({
      projects: [],
      project: null,
      assets: [],
      assetBuffers: {},
      analyses: {},
      exports: [],
      presets: [...BUILT_IN_PRESETS],
      screen: 'dashboard',
      toast: 'All local project data was deleted.',
    });
  },
}));

export let latestMeters: Record<string, Record<string, { reduction?: number }>> = {};

function timelineDuration(project: ProjectState): number {
  let end = 0;
  for (const track of project.tracks) for (const clip of track.clips) end = Math.max(end, clip.start + clip.duration);
  return end || 30;
}

async function renderProject(
  get: () => AppState,
  options: { mode: 'master' | 'track'; trackId?: string; startSec: number; endSec: number; label?: string },
): Promise<{ L: Float32Array; R: Float32Array; sampleRate: number; stats: RenderStats }> {
  const state = get();
  const project = state.project;
  if (!project) throw new Error('No project open.');
  let renderProjectState = cloneProject(project);
  if (options.mode === 'track' && options.trackId) {
    // Stem render: keep only the selected track, and bypass the master chain so
    // the result is the processed track rather than a master of the whole mix.
    renderProjectState.tracks = renderProjectState.tracks.map((t) => ({
      ...t,
      muted: t.id === options.trackId ? false : true,
      soloed: false,
    }));
    renderProjectState.master.processors = [];
    renderProjectState.master.volumeDb = 0;
  }
  renderProjectState.tracks = renderProjectState.tracks.map((t) => ({ ...t, soloed: false }));
  const assets: EngineAsset[] = [];
  for (const assetId of allAssetIds(renderProjectState)) {
    const buffer = state.assetBuffers[assetId];
    if (!buffer) continue;
    assets.push({
      id: assetId,
      length: buffer.L.length,
      sampleRate: renderProjectState.sampleRate,
      L: buffer.L,
      R: buffer.R,
    });
  }
  const worker = new Worker(new URL('../audio/engine/offline.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise((resolve, reject) => {
      const cancel = () => worker.postMessage({ type: 'cancel' });
      useApp.setState({
        busy: {
          kind: 'render',
          label: 'Rendering offline',
          progress: 0,
          cancel,
        },
      });
      worker.onmessage = (event: MessageEvent) => {
        const message = event.data;
        if (message.type === 'progress') {
          useApp.setState({
            busy: { kind: 'render', label: 'Rendering offline', progress: message.progress as number, cancel },
          });
        } else if (message.type === 'done') {
          resolve({
            L: message.L as Float32Array,
            R: message.R as Float32Array,
            sampleRate: message.sampleRate as number,
            stats: message.stats as RenderStats,
          });
        } else if (message.type === 'cancelled') {
          reject(new Error('Render cancelled.'));
        } else if (message.type === 'error') {
          reject(new Error(message.message as string));
        }
      };
      worker.onerror = () => reject(new Error('The offline render worker crashed.'));
      worker.postMessage({
        type: 'render',
        project: renderProjectState,
        assets,
        sampleRate: renderProjectState.sampleRate,
        startSec: options.startSec,
        endSec: options.endSec,
      });
    });
  } finally {
    worker.terminate();
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'sonora-master';
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function encodeMp3(L: Float32Array, R: Float32Array, sampleRate: number): Promise<Blob> {
  if (sampleRate !== 44100 && sampleRate !== 48000) {
    throw new Error('MP3 encoding supports 44.1 kHz and 48 kHz. Choose WAV/AIFF for other sample rates.');
  }
  const lameModule = await import('@breezystack/lamejs');
  const lame = (lameModule as unknown as { default?: unknown }).default ?? lameModule;
  const Mp3Encoder = (lame as { Mp3Encoder: new (channels: number, sampleRate: number, bitrate: number) => {
    encodeBuffer: (left: Int16Array, right: Int16Array) => Int8Array;
    flush: () => Int8Array;
  } }).Mp3Encoder;
  if (!Mp3Encoder) throw new Error('MP3 encoder failed to load.');
  const encoder = new Mp3Encoder(2, sampleRate, 320);
  const left = new Int16Array(L.length);
  const right = new Int16Array(R.length);
  for (let i = 0; i < L.length; i++) {
    left[i] = Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767)));
    right[i] = Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767)));
  }
  const chunkSize = 1152;
  const chunks: BlobPart[] = [];
  for (let offset = 0; offset < left.length; offset += chunkSize) {
    const l = left.subarray(offset, offset + chunkSize);
    const r = right.subarray(offset, offset + chunkSize);
    const encoded = encoder.encodeBuffer(l, r);
    if (encoded.length) chunks.push(new Uint8Array(encoded.slice()));
  }
  const tail = encoder.flush();
  if (tail.length) chunks.push(new Uint8Array(tail.slice()));
  return new Blob(chunks, { type: 'audio/mpeg' });
}

export interface EncodedFileMeasurements {
  lufs: number;
  truePeakDb: number;
  samplePeakDb: number;
  lra: number;
  crestDb: number;
  duration: number;
}

/** Decode and re-measure the actual encoded file bytes, not the pre-encode PCM. */
export async function verifyEncodedBlob(blob: Blob): Promise<EncodedFileMeasurements> {
  const file = new File([blob], 'verification.wav', { type: blob.type });
  const decoded = await decodeAudioFile(file);
  const report = analyzeLoudness(decoded.L, decoded.R, decoded.sampleRate);
  return {
    lufs: report.integratedLufs,
    truePeakDb: report.truePeakDb,
    samplePeakDb: report.samplePeakDb,
    lra: report.lra,
    crestDb: report.crestDb,
    duration: decoded.duration,
  };
}

export function assistantSuggestions(): string[] {
  const state = useApp.getState();
  if (!state.project) return [];
  const processors = state.project.master.processors;
  const isStereo = state.project.tracks.filter((t) => t.kind !== 'reference' && t.clips.length > 0).length <= 1;
  return suggestionsFor(processors, isStereo);
}

void emptyProject;
void verifyEncodedBlob;
