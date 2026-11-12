/* AudioWorklet global scope declarations (not part of lib.dom). */
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}

import { ProjectRenderer, type EngineAsset } from './renderer';
import type { ProjectState } from '../model/types';
import { gainToDb } from '../dsp/util';
import { copyAuditionBlock, type AuditionMode, type AuditionTransition, type StereoAuditionBuffers } from './audition';

interface AssetPayload {
  id: string;
  sampleRate: number;
  length: number;
  L: Float32Array;
  R: Float32Array;
}

/**
 * Realtime host for the production engine.
 *
 * All processing happens here rather than through Web Audio's built-in nodes,
 * so the signal path is identical to the offline renderer. Parameter changes
 * arrive as whole-project updates and are reconciled by processor id, which
 * keeps filter state and avoids clicks while a knob is moving.
 */
class SonoraEngineProcessor extends AudioWorkletProcessor {
  private renderer = new ProjectRenderer();
  private project: ProjectState | null = null;
  private assets: EngineAsset[] = [];
  private playing = false;
  private position = 0;
  private endSample = 0;
  private meterCounter = 0;
  private lastPositionPost = 0;
  private peakL = 0;
  private peakR = 0;
  private staticBlock = 128;
  private loopEnabled = false;
  private loopStartSample = 0;
  private loopEndSample = 0;
  private matchBeforeRenderer: ProjectRenderer | null = null;
  private matchAfterRenderer: ProjectRenderer | null = null;
  private matchAuditionEndSample = 0;
  private matchAuditionBeforeL = new Float32Array(128);
  private matchAuditionBeforeR = new Float32Array(128);
  private matchAuditionAfterL = new Float32Array(128);
  private matchAuditionAfterR = new Float32Array(128);
  private matchAuditionBuffers: StereoAuditionBuffers = {
    beforeL: this.matchAuditionBeforeL, beforeR: this.matchAuditionBeforeR,
    afterL: this.matchAuditionAfterL, afterR: this.matchAuditionAfterR,
  };
  private matchAuditionActive = false;
  private matchAuditionMode: AuditionMode = 'before';
  private matchAuditionTransition: AuditionTransition | null = null;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent) => this.handle(event.data);
    this.port.postMessage({ type: 'ready', sampleRate });
  }

  private handle(message: Record<string, unknown>): void {
    switch (message.type) {
      case 'assets': {
        const assets = (message.assets as AssetPayload[]).map((a) => ({
          id: a.id,
          length: a.length,
          sampleRate: a.sampleRate,
          L: a.L,
          R: a.R,
        })) as EngineAsset[];
        // Merge new assets with existing ones; asset messages arrive
        // incrementally as files are imported.
        const merged = new Map(this.assets.map((a) => [a.id, a]));
        for (const asset of assets) merged.set(asset.id, asset);
        this.assets = [...merged.values()];
        this.renderer.setAssets(this.assets);
        this.matchBeforeRenderer?.setAssets(this.assets);
        this.matchAfterRenderer?.setAssets(this.assets);
        if (this.project) {
          this.renderer.configure(this.project, this.assets, sampleRate, this.staticBlock);
        }
        break;
      }
      case 'configure': {
        this.project = message.project as ProjectState;
        // Always pass the full asset set: configure() rebuilds the renderer, and
        // passing an empty list here would silently mute the session.
        this.renderer.configure(this.project, this.assets, sampleRate, this.staticBlock);
        this.endSample = Math.round(this.renderer.timelineEndSeconds * sampleRate);
        this.port.postMessage({ type: 'configured', endSample: this.endSample });
        break;
      }
      case 'match-audition-projects': {
        const before = message.before as ProjectState;
        const after = message.after as ProjectState;
        this.matchBeforeRenderer = new ProjectRenderer();
        this.matchAfterRenderer = new ProjectRenderer();
        this.matchBeforeRenderer.configure(before, this.assets, sampleRate, this.staticBlock);
        this.matchAfterRenderer.configure(after, this.assets, sampleRate, this.staticBlock);
        this.matchAuditionEndSample = Math.min(
          Math.round(this.matchBeforeRenderer.timelineEndSeconds * sampleRate),
          Math.round(this.matchAfterRenderer.timelineEndSeconds * sampleRate),
        );
        this.matchAuditionTransition = null;
        break;
      }
      case 'match-audition-mode': {
        const nextMode = message.mode === 'after' ? 'after' : 'before';
        const nextActive = Boolean(message.active) && Boolean(this.matchBeforeRenderer) && Boolean(this.matchAfterRenderer);
        if (this.matchAuditionActive && nextActive && nextMode !== this.matchAuditionMode) {
          this.matchAuditionTransition = {
            from: this.matchAuditionMode,
            totalFrames: Math.max(1, Math.round(sampleRate * 0.008)),
            elapsedFrames: 0,
          };
        } else if (!nextActive) {
          this.matchAuditionTransition = null;
        }
        this.matchAuditionMode = nextMode;
        this.matchAuditionActive = nextActive;
        break;
      }
      case 'clear-match-audition': {
        this.matchAuditionActive = false;
        this.matchBeforeRenderer = null;
        this.matchAfterRenderer = null;
        this.matchAuditionEndSample = 0;
        this.matchAuditionTransition = null;
        this.renderer.reset();
        break;
      }
      case 'play': {
        const fromSeconds =
          typeof message.position === 'number' ? message.position : this.position / sampleRate;
        this.position = Math.max(0, Math.round(fromSeconds * sampleRate));
        this.renderer.reset();
        this.matchBeforeRenderer?.reset();
        this.matchAfterRenderer?.reset();
        this.playing = true;
        break;
      }
      case 'pause':
        this.playing = false;
        this.port.postMessage({ type: 'position', position: this.position / sampleRate, playing: false });
        break;
      case 'seek':
        this.position = Math.max(0, Math.round((message.position as number) * sampleRate));
        this.renderer.reset();
        this.matchBeforeRenderer?.reset();
        this.matchAfterRenderer?.reset();
        this.port.postMessage({ type: 'position', position: this.position / sampleRate, playing: this.playing });
        break;
      case 'loop':
        this.loopEnabled = Boolean(message.enabled);
        this.loopStartSample = Math.max(0, Math.round((message.start as number) * sampleRate));
        this.loopEndSample = Math.max(0, Math.round((message.end as number) * sampleRate));
        break;
      case 'stop':
        this.playing = false;
        this.position = 0;
        this.renderer.reset();
        this.matchBeforeRenderer?.reset();
        this.matchAfterRenderer?.reset();
        break;
      default:
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const outL = output[0];
    const outR = output[1] ?? output[0];

    if (!this.playing || !this.project) {
      outL.fill(0);
      outR.fill(0);
      return true;
    }

    const auditionActive = this.matchAuditionActive && this.matchBeforeRenderer !== null && this.matchAfterRenderer !== null;
    if (auditionActive) {
      if (this.matchAuditionBeforeL.length < outL.length) {
        this.matchAuditionBeforeL = new Float32Array(outL.length);
        this.matchAuditionBeforeR = new Float32Array(outL.length);
        this.matchAuditionAfterL = new Float32Array(outL.length);
        this.matchAuditionAfterR = new Float32Array(outL.length);
        this.matchAuditionBuffers = {
          beforeL: this.matchAuditionBeforeL, beforeR: this.matchAuditionBeforeR,
          afterL: this.matchAuditionAfterL, afterR: this.matchAuditionAfterR,
        };
      }
      this.matchBeforeRenderer!.renderBlock(this.position, outL.length, this.matchAuditionBeforeL, this.matchAuditionBeforeR);
      this.matchAfterRenderer!.renderBlock(this.position, outL.length, this.matchAuditionAfterL, this.matchAuditionAfterR);
      const elapsed = copyAuditionBlock(
        this.matchAuditionBuffers, this.matchAuditionMode, 0, outL, outR,
        this.matchAuditionTransition ?? undefined,
      );
      if (this.matchAuditionTransition) {
        this.matchAuditionTransition.elapsedFrames = elapsed;
        if (elapsed >= this.matchAuditionTransition.totalFrames) this.matchAuditionTransition = null;
      }
    } else {
      this.renderer.renderBlock(this.position, outL.length, outL, outR);
    }
    this.position += outL.length;
    if (
      this.loopEnabled &&
      this.loopEndSample > this.loopStartSample &&
      this.position >= this.loopEndSample
    ) {
      this.position = this.loopStartSample;
      this.renderer.reset();
      this.matchBeforeRenderer?.reset();
      this.matchAfterRenderer?.reset();
      this.port.postMessage({ type: 'position', position: this.position / sampleRate, playing: true });
    }

    let pL = 0;
    let pR = 0;
    for (let i = 0; i < outL.length; i++) {
      const al = Math.abs(outL[i]);
      const ar = Math.abs(outR[i]);
      if (al > pL) pL = al;
      if (ar > pR) pR = ar;
    }
    this.peakL = Math.max(pL, this.peakL * 0.85);
    this.peakR = Math.max(pR, this.peakR * 0.85);

    this.meterCounter++;
    if (this.meterCounter % 4 === 0) {
      this.port.postMessage({
        type: 'meter',
        peakL: gainToDb(this.peakL),
        peakR: gainToDb(this.peakR),
        position: this.position / sampleRate,
        playing: true,
        gr: auditionActive ? {} : this.renderer.meterSnapshot(),
        peaks: auditionActive ? {} : this.renderer.peakSnapshot(),
      });
    } else if (this.position - this.lastPositionPost > sampleRate * 0.05) {
      this.lastPositionPost = this.position;
      this.port.postMessage({ type: 'position', position: this.position / sampleRate, playing: true });
    }

    const auditionEnd = auditionActive ? this.matchAuditionEndSample : this.endSample + sampleRate * 0.5;
    if ((auditionActive ? auditionEnd > 0 : this.endSample > 0) && this.position >= auditionEnd) {
      this.playing = false;
      this.position = 0;
      this.port.postMessage({ type: 'ended' });
    }
    return true;
  }
}

registerProcessor('sonora-engine', SonoraEngineProcessor);
