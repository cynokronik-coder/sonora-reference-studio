import { ProcessorChain } from '../dsp/chain';
import { valueAtTime, findLane } from '../dsp/automation';
import type { ParamValues } from '../dsp/types';
import { dbToGain, clamp } from '../dsp/util';
import type { BusState, ProjectState, TrackState } from '../model/types';

export interface EngineAsset {
  id: string;
  length: number;
  sampleRate: number;
  L: Float32Array;
  R: Float32Array;
}

/** Integer delay line used for latency compensation between paths. */
class DelayBuffer {
  private bufL: Float32Array;
  private bufR: Float32Array;
  private index = 0;
  private readonly size: number;
  samples = 0;

  constructor(maxSamples: number) {
    this.size = Math.max(1, maxSamples + 1);
    this.bufL = new Float32Array(this.size);
    this.bufR = new Float32Array(this.size);
  }

  setDelay(samples: number): void {
    this.samples = Math.max(0, Math.min(this.size - 1, Math.round(samples)));
  }

  reset(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
    this.index = 0;
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    if (this.samples === 0) return;
    for (let i = 0; i < n; i++) {
      this.bufL[this.index] = L[i];
      this.bufR[this.index] = R[i];
      let read = this.index - this.samples;
      if (read < 0) read += this.size;
      L[i] = this.bufL[read];
      R[i] = this.bufR[read];
      this.index = (this.index + 1) % this.size;
    }
  }
}

interface ChannelPath {
  chain: ProcessorChain;
  delay: DelayBuffer;
  latency: number;
}

/**
 * The heart of playback and rendering.
 *
 * The same class drives the realtime AudioWorklet and the offline export
 * worker, so what you hear is what gets rendered. Signal flow:
 * clip audio → track chain → fader/pan → sends → bus chain → bus fader →
 * master chain → master fader. Solo, mute, polarity and mono are applied in
 * the graph, not in the UI.
 */
export class ProjectRenderer {
  private project: ProjectState | null = null;
  private assets = new Map<string, EngineAsset>();
  private trackPaths = new Map<string, ChannelPath>();
  private busPaths = new Map<string, ChannelPath>();
  private masterChain: ProcessorChain | null = null;
  private blockSize = 256;
  private sr = 48000;
  private scratch = new Map<string, { L: Float32Array; R: Float32Array }>();
  private rawKeys = new Map<string, { L: Float32Array; R: Float32Array }>();
  private busAccum = new Map<string, { L: Float32Array; R: Float32Array }>();
  private preFader = { L: new Float32Array(0), R: new Float32Array(0) };
  private maxLatency = 0;
  private masterLatency = 0;
  private trackConfigSignature = '';
  private meterRefs: Record<string, Record<string, { reduction?: number }>> = {};
  private channelPeaks = new Map<string, { L: number; R: number }>();

  configure(project: ProjectState, assets: EngineAsset[], sampleRate: number, blockSize: number): void {
    this.project = project;
    this.sr = sampleRate;
    this.blockSize = blockSize;
    this.assets = new Map(assets.map((a) => [a.id, a]));
    this.ensureBuffers(blockSize);
    this.rebuild(project);
  }

  setProject(project: ProjectState): void {
    this.project = project;
    this.rebuild(project);
  }

  setAssets(assets: EngineAsset[]): void {
    this.assets = new Map(assets.map((a) => [a.id, a]));
  }

  private ensureBuffers(blockSize: number): void {
    this.preFader = { L: new Float32Array(blockSize), R: new Float32Array(blockSize) };
    for (const buf of this.scratch.values()) {
      if (buf.L.length < blockSize) {
        buf.L = new Float32Array(blockSize);
        buf.R = new Float32Array(blockSize);
      }
    }
    for (const buf of this.busAccum.values()) {
      if (buf.L.length < blockSize) {
        buf.L = new Float32Array(blockSize);
        buf.R = new Float32Array(blockSize);
      }
    }
  }

  private getBuffer(map: Map<string, { L: Float32Array; R: Float32Array }>, id: string): { L: Float32Array; R: Float32Array } {
    let buf = map.get(id);
    if (!buf || buf.L.length < this.blockSize) {
      buf = { L: new Float32Array(this.blockSize), R: new Float32Array(this.blockSize) };
      map.set(id, buf);
    }
    return buf;
  }

  private rebuild(project: ProjectState): void {
    const signature = JSON.stringify({
      tracks: project.tracks.map((t) => [t.id, t.processors.map((p) => `${p.id}:${p.type}:${p.enabled}`)]),
      buses: project.buses.map((b) => [b.id, b.processors.map((p) => `${p.id}:${p.type}:${p.enabled}`)]),
      master: project.master.processors.map((p) => `${p.id}:${p.type}:${p.enabled}`),
    });
    if (signature === this.trackConfigSignature) {
      this.pushParams(project);
      return;
    }
    this.trackConfigSignature = signature;

    const existingTrackPaths = this.trackPaths;
    this.trackPaths = new Map();
    for (const track of project.tracks) {
      let path = existingTrackPaths.get(track.id);
      if (!path) {
        path = {
          chain: new ProcessorChain(this.sr, this.blockSize),
          delay: new DelayBuffer(Math.ceil(this.sr * 0.02)),
          latency: 0,
        };
        path.chain.prepare(this.sr, this.blockSize);
      }
      path.chain.update(track.processors.map((p) => ({ id: p.id, type: p.type, enabled: p.enabled, params: p.params })));
      this.trackPaths.set(track.id, path);
      this.getBuffer(this.scratch, track.id);
      this.getBuffer(this.rawKeys, track.id);
    }

    const existingBusPaths = this.busPaths;
    this.busPaths = new Map();
    for (const bus of project.buses) {
      let path = existingBusPaths.get(bus.id);
      if (!path) {
        path = {
          chain: new ProcessorChain(this.sr, this.blockSize),
          delay: new DelayBuffer(Math.ceil(this.sr * 0.02)),
          latency: 0,
        };
        path.chain.prepare(this.sr, this.blockSize);
      }
      path.chain.update(bus.processors.map((p) => ({ id: p.id, type: p.type, enabled: p.enabled, params: p.params })));
      this.busPaths.set(bus.id, path);
      this.getBuffer(this.busAccum, bus.id);
    }

    if (!this.masterChain) {
      this.masterChain = new ProcessorChain(this.sr, this.blockSize);
      this.masterChain.prepare(this.sr, this.blockSize);
    }
    this.masterChain.update(
      project.master.processors.map((p) => ({ id: p.id, type: p.type, enabled: p.enabled, params: p.params })),
    );

    this.recomputeLatency(project);
  }

  private pushParams(project: ProjectState): void {
    for (const track of project.tracks) {
      const path = this.trackPaths.get(track.id);
      if (!path) continue;
      path.chain.update(track.processors.map((p) => ({ id: p.id, type: p.type, enabled: p.enabled, params: p.params })));
    }
    for (const bus of project.buses) {
      const path = this.busPaths.get(bus.id);
      if (!path) continue;
      path.chain.update(bus.processors.map((p) => ({ id: p.id, type: p.type, enabled: p.enabled, params: p.params })));
    }
    this.masterChain?.update(
      project.master.processors.map((p) => ({ id: p.id, type: p.type, enabled: p.enabled, params: p.params })),
    );
    this.recomputeLatency(project);
  }

  private recomputeLatency(project: ProjectState): void {
    let maxTrack = 0;
    for (const track of project.tracks) {
      const path = this.trackPaths.get(track.id);
      if (!path) continue;
      path.latency = path.chain.latency;
      maxTrack = Math.max(maxTrack, path.latency);
    }
    let maxBus = 0;
    for (const bus of project.buses) {
      const path = this.busPaths.get(bus.id);
      if (!path) continue;
      path.latency = path.chain.latency;
      maxBus = Math.max(maxBus, path.latency);
    }
    const masterLatency = this.masterChain?.latency ?? 0;
    this.maxLatency = maxTrack + maxBus;
    this.masterLatency = masterLatency;
    for (const track of project.tracks) {
      const path = this.trackPaths.get(track.id);
      if (!path) continue;
      // Track paths align to maxTrack, then direct tracks also absorb the bus
      // latency so every route reaches the master at the same time.
      path.delay.setDelay(maxTrack - path.latency + (track.output ? 0 : maxBus));
    }
    for (const bus of project.buses) {
      const path = this.busPaths.get(bus.id);
      if (path) path.delay.setDelay(maxBus - path.latency);
    }
  }

  get totalLatency(): number {
    return this.maxLatency + this.masterLatency;
  }

  reset(): void {
    for (const path of this.trackPaths.values()) {
      path.chain.reset();
      path.delay.reset();
    }
    for (const path of this.busPaths.values()) {
      path.chain.reset();
      path.delay.reset();
    }
    this.masterChain?.reset();
  }

  private automationValues(track: TrackState, time: number): { volumeDb: number; pan: number } {
    const volLane = findLane(track.automation, 'volume');
    const panLane = findLane(track.automation, 'pan');
    return {
      volumeDb: volLane ? valueAtTime(volLane.points, time, track.volumeDb) : track.volumeDb,
      pan: panLane ? valueAtTime(panLane.points, time, track.pan) : track.pan,
    };
  }

  private applyAutomatedParams(
    track: TrackState,
    chain: ProcessorChain,
    time: number,
  ): void {
    for (const processor of track.processors) {
      const lanes = track.automation.filter((l) => l.enabled && l.processorId === processor.id);
      if (!lanes.length) continue;
      const params: ParamValues = { ...processor.params };
      for (const lane of lanes) {
        if (!lane.param) continue;
        params[lane.param] = valueAtTime(lane.points, time, params[lane.param] ?? 0);
      }
      chain.setParams(processor.id, params);
    }
  }

  private fillTrack(track: TrackState, startSample: number, n: number, L: Float32Array, R: Float32Array): void {
    L.fill(0, 0, n);
    R.fill(0, 0, n);
    const startSec = startSample / this.sr;
    const endSec = (startSample + n) / this.sr;
    for (const clip of track.clips) {
      const clipStart = clip.start;
      const clipEnd = clip.start + clip.duration;
      if (clipEnd <= startSec || clipStart >= endSec) continue;
      const asset = this.assets.get(clip.assetId);
      if (!asset) continue;
      const from = Math.max(startSec, clipStart);
      const to = Math.min(endSec, clipEnd);
      const sampleFrom = Math.round((from - startSec) * this.sr);
      const sampleTo = Math.min(n, Math.round((to - startSec) * this.sr));
      const gain = dbToGain(clip.gainDb);
      const srcOffset = clip.offset * asset.sampleRate;
      for (let i = sampleFrom; i < sampleTo; i++) {
        const timelineTime = startSec + i / this.sr;
        const local = timelineTime - clipStart;
        let fade = 1;
        if (clip.fadeIn > 0 && local < clip.fadeIn) fade = local / clip.fadeIn;
        if (clip.fadeOut > 0 && clip.duration - local < clip.fadeOut) {
          fade = Math.min(fade, (clip.duration - local) / clip.fadeOut);
        }
        const srcIndex = Math.floor(srcOffset + local * asset.sampleRate);
        if (srcIndex < 0 || srcIndex >= asset.length) continue;
        L[i] += asset.L[srcIndex] * gain * fade;
        R[i] += asset.R[srcIndex] * gain * fade;
      }
    }
  }

  /**
   * Render one block at the given absolute sample position.
   * Both hosts call this identically, guaranteeing export == monitoring.
   */
  renderBlock(startSample: number, frames: number, outL: Float32Array, outR: Float32Array): void {
    const project = this.project;
    if (!project) {
      outL.fill(0, 0, frames);
      outR.fill(0, 0, frames);
      return;
    }
    outL.fill(0, 0, frames);
    outR.fill(0, 0, frames);
    const anySolo = project.tracks.some((t) => t.soloed);
    const time = startSample / this.sr;

    for (const bus of project.buses) {
      const acc = this.getBuffer(this.busAccum, bus.id);
      acc.L.fill(0, 0, frames);
      acc.R.fill(0, 0, frames);
    }

    const audible = (track: TrackState) => !track.muted && (!anySolo || track.soloed);

    // 1. Raw audio for every track, needed for external sidechain keys.
    for (const track of project.tracks) {
      const raw = this.getBuffer(this.scratch, track.id);
      this.fillTrack(track, startSample, frames, raw.L, raw.R);
      const key = this.getBuffer(this.rawKeys, track.id);
      if (audible(track)) {
        key.L.set(raw.L.subarray(0, frames));
        key.R.set(raw.R.subarray(0, frames));
      } else {
        key.L.fill(0, 0, frames);
        key.R.fill(0, 0, frames);
      }
    }

    // 2. Track chains and routing.
    for (const track of project.tracks) {
      if (!audible(track)) continue;
      const buf = this.getBuffer(this.scratch, track.id);
      const path = this.trackPaths.get(track.id);
      if (!path) continue;
      if (track.polarity) {
        for (let i = 0; i < frames; i++) {
          buf.L[i] = -buf.L[i];
          buf.R[i] = -buf.R[i];
        }
      }
      if (track.mono) {
        for (let i = 0; i < frames; i++) {
          const m = (buf.L[i] + buf.R[i]) * 0.5;
          buf.L[i] = m;
          buf.R[i] = m;
        }
      }
      for (const processor of track.processors) {
        if (processor.sidechainFrom) {
          const key = this.rawKeys.get(processor.sidechainFrom);
          path.chain.setSidechain(processor.id, key?.L ?? null, key?.R ?? null);
        }
      }
      // Automation must be applied after the structural sync and immediately
      // before processing, otherwise the base parameter values overwrite it.
      this.applyAutomatedParams(track, path.chain, time);
      const automated = this.automationValues(track, time);
      path.chain.process(buf.L, buf.R, frames);

      // Pre-fader sends.
      for (const send of track.sends) {
        if (!send.preFader) continue;
        const bus = this.busAccum.get(send.busId);
        if (!bus) continue;
        const g = dbToGain(send.levelDb);
        for (let i = 0; i < frames; i++) {
          bus.L[i] += buf.L[i] * g;
          bus.R[i] += buf.R[i] * g;
        }
      }

      // Fader and pan.
      const gain = dbToGain(automated.volumeDb);
      const pan = clamp(automated.pan / 100, -1, 1);
      const angle = ((pan + 1) * Math.PI) / 4;
      const gl = Math.cos(angle) * Math.SQRT2 * gain;
      const gr = Math.sin(angle) * Math.SQRT2 * gain;
      for (let i = 0; i < frames; i++) {
        buf.L[i] *= gl;
        buf.R[i] *= gr;
      }

      // Post-fader sends.
      for (const send of track.sends) {
        if (send.preFader) continue;
        const bus = this.busAccum.get(send.busId);
        if (!bus) continue;
        const g = dbToGain(send.levelDb);
        for (let i = 0; i < frames; i++) {
          bus.L[i] += buf.L[i] * g;
          bus.R[i] += buf.R[i] * g;
        }
      }

      path.delay.process(buf.L, buf.R, frames);
      this.capturePeak(track.id, buf.L, buf.R, frames);

      if (track.output) {
        const bus = this.busAccum.get(track.output);
        if (bus) {
          for (let i = 0; i < frames; i++) {
            bus.L[i] += buf.L[i];
            bus.R[i] += buf.R[i];
          }
        }
      } else {
        for (let i = 0; i < frames; i++) {
          outL[i] += buf.L[i];
          outR[i] += buf.R[i];
        }
      }
    }

    // 3. Buses.
    for (const bus of project.buses) {
      const acc = this.busAccum.get(bus.id);
      const path = this.busPaths.get(bus.id);
      if (!acc || !path) continue;
      if (bus.muted) {
        acc.L.fill(0, 0, frames);
        acc.R.fill(0, 0, frames);
        continue;
      }
      this.applyAutomatedParams({ ...this.emptyTrack(bus.id), automation: bus.automation, processors: bus.processors } as TrackState, path.chain, time);
      path.chain.process(acc.L, acc.R, frames);
      if (bus.polarity) {
        for (let i = 0; i < frames; i++) {
          acc.L[i] = -acc.L[i];
          acc.R[i] = -acc.R[i];
        }
      }
      const g = dbToGain(bus.volumeDb);
      for (let i = 0; i < frames; i++) {
        acc.L[i] *= g;
        acc.R[i] *= g;
      }
      path.delay.process(acc.L, acc.R, frames);
      this.capturePeak(bus.id, acc.L, acc.R, frames);
      for (let i = 0; i < frames; i++) {
        outL[i] += acc.L[i];
        outR[i] += acc.R[i];
      }
    }

    // 4. Master chain and fader.
    if (this.masterChain) {
      this.masterChain.process(outL, outR, frames);
      const g = dbToGain(project.master.volumeDb);
      if (g !== 1) {
        for (let i = 0; i < frames; i++) {
          outL[i] *= g;
          outR[i] *= g;
        }
      }
    }
    this.capturePeak('master', outL, outR, frames);
  }

  private capturePeak(id: string, L: Float32Array, R: Float32Array, n: number): void {
    let peakL = 0;
    let peakR = 0;
    for (let i = 0; i < n; i++) {
      const al = Math.abs(L[i]);
      const ar = Math.abs(R[i]);
      if (al > peakL) peakL = al;
      if (ar > peakR) peakR = ar;
    }
    const previous = this.channelPeaks.get(id);
    this.channelPeaks.set(id, {
      L: Math.max(peakL, (previous?.L ?? 0) * 0.82),
      R: Math.max(peakR, (previous?.R ?? 0) * 0.82),
    });
  }

  peakSnapshot(): Record<string, { L: number; R: number }> {
    const out: Record<string, { L: number; R: number }> = {};
    for (const [id, peak] of this.channelPeaks) out[id] = { ...peak };
    return out;
  }

  private emptyTrack(id: string): TrackState {
    return {
      id, name: '', kind: 'bus', color: '', volumeDb: 0, pan: 0, muted: false, soloed: false,
      polarity: false, mono: false, output: null, sends: [], processors: [], automation: [], clips: [], height: 0,
    };
  }

  meterSnapshot(): Record<string, Record<string, { reduction?: number }>> {
    const out: Record<string, Record<string, { reduction?: number }>> = {};
    for (const [id, path] of this.trackPaths) out[id] = path.chain.meters();
    for (const [id, path] of this.busPaths) out[id] = path.chain.meters();
    if (this.masterChain) out.master = this.masterChain.meters();
    this.meterRefs = out;
    return out;
  }

  get timelineEndSeconds(): number {
    const project = this.project;
    if (!project) return 0;
    let end = 0;
    for (const track of project.tracks) {
      for (const clip of track.clips) end = Math.max(end, clip.start + clip.duration);
    }
    return end;
  }

  get lastMeters(): Record<string, Record<string, { reduction?: number }>> {
    return this.meterRefs;
  }

  get projectState(): ProjectState | null {
    return this.project;
  }

  get sampleRate(): number {
    return this.sr;
  }
}

void (undefined as unknown as BusState);
