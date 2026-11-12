import workletUrl from './engine.worklet.ts?worker&url';
import type { EngineAsset } from './renderer';
import type { ProjectState } from '../model/types';

export interface AuditionPerformance {
  averageMs: number;
  maxMs: number;
  blockBudgetMs: number;
  utilizationPercent: number;
}

export interface AssetSyncPlan {
  releaseIds: string[];
  loadIds: string[];
}

/** Asset delta used to keep AudioWorklet memory aligned with the open project. */
export function planAssetSync(loadedIds: Iterable<string>, requestedIds: Iterable<string>): AssetSyncPlan {
  const loaded = new Set(loadedIds);
  const requested = new Set(requestedIds);
  return {
    releaseIds: [...loaded].filter((id) => !requested.has(id)),
    loadIds: [...requested].filter((id) => !loaded.has(id)),
  };
}

export interface RealtimeMeters {
  peakL: number;
  peakR: number;
  gr: Record<string, Record<string, { reduction?: number }>>;
  peaks: Record<string, { L: number; R: number }>;
  auditionPerformance: AuditionPerformance | null;
}

type PositionListener = (seconds: number, playing: boolean) => void;
type MeterListener = (meters: RealtimeMeters) => void;
type EndedListener = () => void;
type ErrorListener = (message: string) => void;

/** Whether a transport toggle should pause instead of attempting recovery. */
export function shouldPauseTransport(playing: boolean, contextState: string): boolean {
  return playing && contextState !== 'suspended' && contextState !== 'interrupted' && contextState !== 'closed';
}

/**
 * Browser-side controller for the AudioWorklet engine.
 *
 * The AudioContext's native sample rate becomes the project sample rate; all
 * imported audio is resampled to it on import. This avoids hidden resampling in
 * the playback path and keeps the realtime and offline engines identical.
 */
export class RealtimeHost {
  private ctx: AudioContext | null = null;
  private workletLoadedFor: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private monitor: GainNode | null = null;
  private comparison: GainNode | null = null;
  private loadedAssets = new Set<string>();
  private ready = false;
  private initialising: Promise<void> | null = null;
  private positionListeners = new Set<PositionListener>();
  private meterListeners = new Set<MeterListener>();
  private endedListeners = new Set<EndedListener>();
  private errorListeners = new Set<ErrorListener>();
  private pendingProject: ProjectState | null = null;
  private pendingAssets: EngineAsset[] = [];
  lastError: string | null = null;
  lastMeters: Record<string, Record<string, { reduction?: number }>> = {};
  lastPayload: RealtimeMeters = { peakL: -120, peakR: -120, gr: {}, peaks: {}, auditionPerformance: null };
  playing = false;
  position = 0;

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  get isReady(): boolean {
    return this.ready;
  }

  get contextState(): string {
    return this.ctx?.state ?? 'uninitialised';
  }

  async initialise(): Promise<void> {
    if (this.ready && this.node && this.ctx?.state !== 'closed') return;
    if (this.initialising) return this.initialising;

    const initialization = (async () => {
      const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) throw new Error('Web Audio is not supported in this browser.');

      if (this.ctx?.state === 'closed') {
        this.ready = false;
        this.node?.disconnect();
        this.node = null;
        this.comparison?.disconnect();
        this.monitor?.disconnect();
        this.comparison = null;
        this.monitor = null;
        this.ctx = null;
        this.workletLoadedFor = null;
        this.loadedAssets.clear();
        this.playing = false;
      }
      const ctx = this.ctx ?? new AudioCtor({ latencyHint: 'interactive' });
      this.ctx = ctx;
      if (this.workletLoadedFor !== ctx) {
        await ctx.audioWorklet.addModule(workletUrl);
        this.workletLoadedFor = ctx;
      }

      // A processorerror permanently silences that AudioWorkletNode. A fresh
      // node can be created on the same live AudioContext and repopulated from
      // the app's still-owned decoded asset buffers.
      this.node?.disconnect();
      this.comparison?.disconnect();
      this.monitor?.disconnect();
      const node = new AudioWorkletNode(ctx, 'sonora-engine', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      const comparison = ctx.createGain();
      const monitor = ctx.createGain();
      node.connect(comparison);
      comparison.connect(monitor);
      monitor.connect(ctx.destination);
      node.port.onmessage = (event: MessageEvent) => this.handle(event.data);
      node.onprocessorerror = () => this.handleProcessorError();
      this.node = node;
      this.comparison = comparison;
      this.monitor = monitor;
      this.ready = true;
      this.lastError = null;

      if (this.pendingAssets.length) {
        this.pushAssets(this.pendingAssets);
        this.pendingAssets = [];
      }
      if (this.pendingProject) {
        this.pushProject(this.pendingProject);
        this.pendingProject = null;
      }
    })();

    this.initialising = initialization;
    try {
      await initialization;
    } finally {
      if (this.initialising === initialization) this.initialising = null;
    }
  }

  private handleProcessorError(): void {
    const message = 'The audio processor stopped unexpectedly. Press Play to rebuild the audio engine and resume.';
    this.lastError = message;
    this.ready = false;
    this.playing = false;
    this.loadedAssets.clear();
    this.node?.port.close();
    this.node?.disconnect();
    this.node = null;
    this.comparison?.disconnect();
    this.monitor?.disconnect();
    this.comparison = null;
    this.monitor = null;
    for (const listener of this.errorListeners) listener(message);
  }

  private handle(message: Record<string, unknown>): void {
    if (message.type === 'meter') {
      const payload: RealtimeMeters = {
        peakL: message.peakL as number,
        peakR: message.peakR as number,
        gr: (message.gr as RealtimeMeters['gr']) ?? {},
        peaks: (message.peaks as RealtimeMeters['peaks']) ?? {},
        auditionPerformance: (message.auditionPerformance as AuditionPerformance | null) ?? null,
      };
      this.lastMeters = payload.gr;
      this.lastPayload = payload;
      for (const listener of this.meterListeners) listener(payload);
    }
    if (typeof message.position === 'number') {
      this.position = message.position;
      this.playing = Boolean(message.playing);
      for (const listener of this.positionListeners) listener(this.position, this.playing);
    }
    if (message.type === 'ended') {
      this.playing = false;
      this.position = 0;
      for (const listener of this.endedListeners) listener();
    }
    if (message.type === 'configured') {
      // end sample is tracked inside the worklet; nothing to do here.
    }
  }

  private transferableAssets(assets: EngineAsset[]): {
    payload: { id: string; sampleRate: number; length: number; L: Float32Array; R: Float32Array }[];
    transfer: Transferable[];
  } {
    const payload = assets.map((a) => ({
      id: a.id,
      sampleRate: a.sampleRate,
      length: a.length,
      L: a.L.slice(),
      R: a.R.slice(),
    }));
    return { payload, transfer: payload.flatMap((a) => [a.L.buffer, a.R.buffer]) };
  }

  private pushAssets(assets: EngineAsset[]): void {
    if (!this.node) {
      this.pendingAssets = assets;
      return;
    }
    // Copy and transfer a small batch at a time. A single postMessage carrying
    // every stem would temporarily duplicate the entire session PCM in memory.
    const batchSize = 2;
    for (let start = 0; start < assets.length; start += batchSize) {
      const batch = assets.slice(start, start + batchSize);
      const { payload, transfer } = this.transferableAssets(batch);
      this.node.port.postMessage({ type: 'assets', assets: payload }, transfer);
      for (const asset of batch) this.loadedAssets.add(asset.id);
    }
  }

  /** Load only assets the worklet has not already received. */
  loadAssets(assets: EngineAsset[]): void {
    const fresh = assets.filter((a) => !this.loadedAssets.has(a.id));
    if (!fresh.length) return;
    if (!this.ready) {
      const pending = new Map(this.pendingAssets.map((asset) => [asset.id, asset]));
      for (const asset of fresh) pending.set(asset.id, asset);
      this.pendingAssets = [...pending.values()];
      return;
    }
    this.pushAssets(fresh);
  }

  /**
   * Synchronize AudioWorklet PCM residency with the assets reachable from the
   * open project. Assets removed from the project are explicitly released.
   */
  syncAssets(assets: EngineAsset[]): void {
    if (!this.ready || !this.node) {
      this.pendingAssets = [...assets];
      this.loadedAssets.clear();
      return;
    }

    const plan = planAssetSync(this.loadedAssets, assets.map((asset) => asset.id));
    if (plan.releaseIds.length) {
      this.node.port.postMessage({ type: 'release-assets', ids: plan.releaseIds });
      for (const id of plan.releaseIds) this.loadedAssets.delete(id);
    }
    if (plan.loadIds.length) {
      const loadSet = new Set(plan.loadIds);
      this.pushAssets(assets.filter((asset) => loadSet.has(asset.id)));
    }
  }

  pushProject(project: ProjectState): void {
    if (!this.ready || !this.node) {
      this.pendingProject = project;
      return;
    }
    this.node.port.postMessage({ type: 'configure', project: JSON.parse(JSON.stringify(project)) });
  }

  /** Configure two independent live render paths for Reference Match audition. */
  setMatchAuditionProjects(projects: { before: ProjectState; after: ProjectState }): void {
    if (!this.ready || !this.node) throw new Error('Audio engine is not ready for Reference Match audition.');
    this.node.port.postMessage({
      type: 'match-audition-projects',
      before: JSON.parse(JSON.stringify(projects.before)),
      after: JSON.parse(JSON.stringify(projects.after)),
    });
  }

  setMatchAudition(active: boolean, mode: 'before' | 'after' = 'before'): void {
    this.node?.port.postMessage({ type: 'match-audition-mode', active, mode });
  }

  clearMatchAuditionBuffers(): void {
    this.node?.port.postMessage({ type: 'clear-match-audition' });
  }

  async play(position?: number): Promise<void> {
    await this.initialise();
    if (!this.ctx || !this.node) throw new Error('Audio engine could not be rebuilt.');
    await this.ctx.resume();
    if (this.ctx.state !== 'running') {
      throw new Error(`Audio context did not resume (state: ${this.ctx.state}). Click Play again after the browser interruption.`);
    }
    this.node.port.postMessage({ type: 'play', position: position ?? this.position });
    this.playing = true;
    this.lastError = null;
  }

  pause(): void {
    this.node?.port.postMessage({ type: 'pause' });
    this.playing = false;
  }

  seek(seconds: number): void {
    this.node?.port.postMessage({ type: 'seek', position: seconds });
    this.position = seconds;
  }

  setLoop(enabled: boolean, start: number, end: number): void {
    this.node?.port.postMessage({ type: 'loop', enabled, start, end });
  }

  stop(): void {
    this.node?.port.postMessage({ type: 'stop' });
    this.playing = false;
    this.position = 0;
  }

  setMonitorGain(db: number): void {
    if (this.monitor && this.ctx) {
      this.monitor.gain.setTargetAtTime(Math.pow(10, db / 20), this.ctx.currentTime, 0.02);
    }
  }

  setComparisonGain(db: number): void {
    if (this.comparison && this.ctx) {
      this.comparison.gain.setTargetAtTime(Math.pow(10, db / 20), this.ctx.currentTime, 0.02);
    }
  }

  onPosition(listener: PositionListener): () => void {
    this.positionListeners.add(listener);
    return () => this.positionListeners.delete(listener);
  }

  onMeters(listener: MeterListener): () => void {
    this.meterListeners.add(listener);
    return () => this.meterListeners.delete(listener);
  }

  onEnded(listener: EndedListener): () => void {
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  async close(): Promise<void> {
    this.ready = false;
    this.node?.port.postMessage({ type: 'release-assets', ids: [...this.loadedAssets] });
    this.node?.disconnect();
    this.node = null;
    this.pendingAssets = [];
    this.monitor?.disconnect();
    this.comparison?.disconnect();
    this.monitor = null;
    this.comparison = null;
    await this.ctx?.close();
    this.ctx = null;
    this.workletLoadedFor = null;
    this.initialising = null;
    this.loadedAssets.clear();
  }
}

export const realtimeHost = new RealtimeHost();
