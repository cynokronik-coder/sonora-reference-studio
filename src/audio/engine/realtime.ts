import workletUrl from './engine.worklet.ts?worker&url';
import type { EngineAsset } from './renderer';
import type { ProjectState } from '../model/types';
import type { ProcessorMeterSnapshot } from '../dsp/types';

export interface RealtimeMeters {
  peakL: number;
  peakR: number;
  gr: ProcessorMeterSnapshot;
  peaks: Record<string, { L: number; R: number }>;
}

type PositionListener = (seconds: number, playing: boolean) => void;
type MeterListener = (meters: RealtimeMeters) => void;
type EndedListener = () => void;

/**
 * Browser-side controller for the AudioWorklet engine.
 *
 * The AudioContext's native sample rate becomes the project sample rate; all
 * imported audio is resampled to it on import. This avoids hidden resampling in
 * the playback path and keeps the realtime and offline engines identical.
 */
export class RealtimeHost {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private monitor: GainNode | null = null;
  private comparison: GainNode | null = null;
  private loadedAssets = new Set<string>();
  private ready = false;
  private initialising: Promise<void> | null = null;
  private positionListeners = new Set<PositionListener>();
  private meterListeners = new Set<MeterListener>();
  private endedListeners = new Set<EndedListener>();
  private pendingProject: ProjectState | null = null;
  private pendingAssets: EngineAsset[] = [];
  lastError: string | null = null;
  lastMeters: ProcessorMeterSnapshot = {};
  lastPayload: RealtimeMeters = { peakL: -120, peakR: -120, gr: {}, peaks: {} };
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
    if (this.ready) return;
    if (this.initialising) return this.initialising;

    const attempt = (async () => {
      const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) throw new Error('Web Audio is not supported in this browser.');
      const ctx = this.ctx ?? new AudioCtor({ latencyHint: 'interactive' });
      this.ctx = ctx;
      if (!ctx.audioWorklet) throw new Error('AudioWorklet is not supported in this browser.');
      await ctx.audioWorklet.addModule(workletUrl);

      const node = new AudioWorkletNode(ctx, 'sonora-engine', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.node = node;
      const comparison = ctx.createGain();
      const monitor = ctx.createGain();
      this.comparison = comparison;
      this.monitor = monitor;
      node.connect(comparison);
      comparison.connect(monitor);
      monitor.connect(ctx.destination);
      node.port.onmessage = (event: MessageEvent) => this.handle(event.data);
      this.ready = true;

      if (this.pendingAssets.length) {
        this.pushAssets(this.pendingAssets);
        this.pendingAssets = [];
      }
      if (this.pendingProject) {
        this.pushProject(this.pendingProject);
        this.pendingProject = null;
      }
    })();

    this.initialising = attempt;
    try {
      await attempt;
    } catch (error) {
      // A rejected initialization must not poison every future play attempt.
      this.ready = false;
      this.playing = false;
      this.node?.disconnect();
      this.node = null;
      this.monitor?.disconnect();
      this.comparison?.disconnect();
      this.monitor = null;
      this.comparison = null;
      const context = this.ctx;
      this.ctx = null;
      this.loadedAssets.clear();
      if (context && context.state !== 'closed') {
        try {
          await context.close();
        } catch {
          // Preserve the original initialization error.
        }
      }
      throw error;
    } finally {
      if (this.initialising === attempt) this.initialising = null;
    }
  }

  private handle(message: Record<string, unknown>): void {
    if (message.type === 'meter') {
      const payload: RealtimeMeters = {
        peakL: message.peakL as number,
        peakR: message.peakR as number,
        gr: (message.gr as RealtimeMeters['gr']) ?? {},
        peaks: (message.peaks as RealtimeMeters['peaks']) ?? {},
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
    const { payload, transfer } = this.transferableAssets(assets);
    this.node.port.postMessage({ type: 'assets', assets: payload }, transfer);
    for (const asset of assets) this.loadedAssets.add(asset.id);
  }

  /** Reconcile the worklet's asset bank with the assets used by the active project. */
  loadAssets(assets: EngineAsset[]): void {
    const activeIds = new Set(assets.map((asset) => asset.id));

    if (!this.ready) {
      this.pendingAssets = this.pendingAssets.filter((asset) => activeIds.has(asset.id));
      const pendingIds = new Set(this.pendingAssets.map((asset) => asset.id));
      const fresh = assets.filter((asset) => !this.loadedAssets.has(asset.id) && !pendingIds.has(asset.id));
      this.pendingAssets.push(...fresh);
      return;
    }

    const removed = [...this.loadedAssets].filter((id) => !activeIds.has(id));
    if (removed.length && this.node) {
      this.node.port.postMessage({ type: 'removeAssets', ids: removed });
      for (const id of removed) this.loadedAssets.delete(id);
    }

    const fresh = assets.filter((asset) => !this.loadedAssets.has(asset.id));
    if (fresh.length) this.pushAssets(fresh);
  }

  pushProject(project: ProjectState): void {
    if (!this.ready || !this.node) {
      this.pendingProject = project;
      return;
    }
    this.node.port.postMessage({ type: 'configure', project: JSON.parse(JSON.stringify(project)) });
  }

  async play(position?: number): Promise<void> {
    await this.initialise();
    await this.ctx?.resume();
    this.node?.port.postMessage({ type: 'play', position: position ?? this.position });
    this.playing = true;
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

  async close(): Promise<void> {
    const pendingInitialisation = this.initialising;
    if (pendingInitialisation) {
      try {
        await pendingInitialisation;
      } catch {
        // The failed initialization has already released its partial resources.
      }
    }
    this.initialising = null;
    this.ready = false;
    this.node?.disconnect();
    this.node = null;
    this.monitor?.disconnect();
    this.comparison?.disconnect();
    this.monitor = null;
    this.comparison = null;
    await this.ctx?.close();
    this.ctx = null;
    this.loadedAssets.clear();
    this.pendingAssets = [];
    this.pendingProject = null;
  }
}

export const realtimeHost = new RealtimeHost();
