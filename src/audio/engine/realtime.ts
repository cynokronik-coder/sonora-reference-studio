import workletUrl from './engine.worklet.ts?worker&url';
import type { EngineAsset } from './renderer';
import type { ProjectState } from '../model/types';

export interface RealtimeMeters {
  peakL: number;
  peakR: number;
  gr: Record<string, Record<string, { reduction?: number }>>;
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
  lastMeters: Record<string, Record<string, { reduction?: number }>> = {};
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
    this.initialising = (async () => {
      const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) throw new Error('Web Audio is not supported in this browser.');
      const ctx = this.ctx ?? new AudioCtor({ latencyHint: 'interactive' });
      this.ctx = ctx;
      await ctx.audioWorklet.addModule(workletUrl);
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
      this.node = node;
      this.comparison = comparison;
      this.monitor = monitor;
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
    return this.initialising;
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

  /** Load only assets the worklet has not already received. */
  loadAssets(assets: EngineAsset[]): void {
    const fresh = assets.filter((a) => !this.loadedAssets.has(a.id));
    if (!fresh.length) return;
    if (!this.ready) {
      this.pendingAssets.push(...fresh);
      return;
    }
    this.pushAssets(fresh);
  }

  pushProject(project: ProjectState): void {
    if (!this.ready || !this.node) {
      this.pendingProject = project;
      return;
    }
    this.node.port.postMessage({ type: 'configure', project: JSON.parse(JSON.stringify(project)) });
  }

  /**
   * Install two offline-rendered versions for sample-aligned Reference Match
   * audition. Ownership of the buffers is transferred to the AudioWorklet.
   */
  setMatchAuditionBuffers(
    buffers: { beforeL: Float32Array; beforeR: Float32Array; afterL: Float32Array; afterR: Float32Array },
  ): void {
    if (!this.ready || !this.node) throw new Error('Audio engine is not ready for Reference Match audition.');
    const transfer: Transferable[] = [
      buffers.beforeL.buffer,
      buffers.beforeR.buffer,
      buffers.afterL.buffer,
      buffers.afterR.buffer,
    ];
    this.node.port.postMessage({ type: 'match-audition-buffers', ...buffers }, transfer);
  }

  setMatchAudition(active: boolean, mode: 'before' | 'after' = 'before'): void {
    this.node?.port.postMessage({ type: 'match-audition-mode', active, mode });
  }

  clearMatchAuditionBuffers(): void {
    this.node?.port.postMessage({ type: 'clear-match-audition' });
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
  }
}

export const realtimeHost = new RealtimeHost();
