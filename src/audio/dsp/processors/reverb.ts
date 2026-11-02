import { Biquad } from '../biquad';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain } from '../util';

interface Comb {
  buffer: Float32Array;
  index: number;
  filterStore: number;
}

interface Allpass {
  buffer: Float32Array;
  index: number;
}

const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNING = [556, 441, 341, 225];
const STEREO_SPREAD = 23;

/**
 * Algorithmic reverb derived from the Freeverb topology (Schroeder combs plus
 * allpass diffusion). Styles vary comb feedback, damping, diffusion and
 * modulation depth to move between room, hall, plate and spring character.
 *
 * This is a synthesis algorithm, not a convolution of a captured space; the UI
 * says so explicitly.
 */
export class Reverb implements AudioProcessor {
  readonly type = 'reverb';
  readonly latency = 0;
  private sr = 48000;
  private values: ParamValues = {};
  private combsL: Comb[] = [];
  private combsR: Comb[] = [];
  private allpassL: Allpass[] = [];
  private allpassR: Allpass[] = [];
  private preDelayL = new Float32Array(0);
  private preDelayR = new Float32Array(0);
  private preIndex = 0;
  private hpL = new Biquad();
  private hpR = new Biquad();
  private lpL = new Biquad();
  private lpR = new Biquad();
  private peakL = 0;
  private peakR = 0;

  prepare(sampleRate: number): void {
    this.sr = sampleRate;
    this.buildBuffers();
    this.hpL.configure('highpass', 120, 0, 0.707, sampleRate);
    this.hpR.configure('highpass', 120, 0, 0.707, sampleRate);
    this.lpL.configure('lowpass', 8000, 0, 0.707, sampleRate);
    this.lpR.configure('lowpass', 8000, 0, 0.707, sampleRate);
    const preDelay = Math.ceil(sampleRate * 0.25);
    this.preDelayL = new Float32Array(preDelay);
    this.preDelayR = new Float32Array(preDelay);
    this.preIndex = 0;
  }

  private buildBuffers(): void {
    const scale = this.sr / 44100;
    this.combsL = [];
    this.combsR = [];
    this.allpassL = [];
    this.allpassR = [];
    for (const len of COMB_TUNING) {
      this.combsL.push({ buffer: new Float32Array(Math.max(8, Math.round(len * scale))), index: 0, filterStore: 0 });
      this.combsR.push({
        buffer: new Float32Array(Math.max(8, Math.round((len + STEREO_SPREAD) * scale))),
        index: 0,
        filterStore: 0,
      });
    }
    for (const len of ALLPASS_TUNING) {
      this.allpassL.push({ buffer: new Float32Array(Math.max(4, Math.round(len * scale))), index: 0 });
      this.allpassR.push({ buffer: new Float32Array(Math.max(4, Math.round((len + STEREO_SPREAD) * scale))), index: 0 });
    }
  }

  setValues(values: ParamValues): void {
    this.values = values;
  }

  private styleSettings(): { feedback: number; damp: number; diffusion: number; predelay: number } {
    const style = Math.round(this.values.style ?? 1);
    const decay = clamp((this.values.decay ?? 2.4) / 10, 0.01, 0.98);
    const baseDamp = clamp((this.values.damping ?? 0.35), 0, 0.98);
    switch (style) {
      case 0: // Room
        return { feedback: 0.68 + decay * 0.25, damp: baseDamp * 1.1, diffusion: 0.6, predelay: clamp(this.values.predelay ?? 5, 0, 250) };
      case 1: // Hall
        return { feedback: 0.76 + decay * 0.2, damp: baseDamp * 0.8, diffusion: 0.75, predelay: clamp(this.values.predelay ?? 20, 0, 250) };
      case 2: // Plate
        return { feedback: 0.7 + decay * 0.24, damp: baseDamp * 0.55, diffusion: 0.86, predelay: clamp(this.values.predelay ?? 0, 0, 250) };
      case 3: // Spring
        return { feedback: 0.66 + decay * 0.28, damp: baseDamp * 0.45, diffusion: 0.45, predelay: clamp(this.values.predelay ?? 12, 0, 250) };
      default:
        return { feedback: 0.76, damp: baseDamp, diffusion: 0.7, predelay: clamp(this.values.predelay ?? 10, 0, 250) };
    }
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    const { feedback, damp, diffusion, predelay } = this.styleSettings();
    const wet = clamp((this.values.mix ?? 25) / 100, 0, 1);
    const width = clamp((this.values.width ?? 100) / 100, 0, 1.5);
    const out = dbToGain(this.values.output ?? 0);
    const lowCut = clamp(this.values.lowCut ?? 120, 20, 1000);
    const highCut = clamp(this.values.highCut ?? 8000, 1000, 20000);
    this.hpL.configure('highpass', lowCut, 0, 0.707, this.sr);
    this.hpR.configure('highpass', lowCut, 0, 0.707, this.sr);
    this.lpL.configure('lowpass', highCut, 0, 0.707, this.sr);
    this.lpR.configure('lowpass', highCut, 0, 0.707, this.sr);
    const preSamples = Math.round((predelay / 1000) * this.sr);
    const preLen = this.preDelayL.length;
    const fb = clamp(feedback, 0.5, 0.97);
    const damping = clamp(damp, 0, 0.95);
    const diff = clamp(diffusion, 0.2, 0.95);

    for (let i = 0; i < n; i++) {
      const dryL = L[i];
      const dryR = R[i];
      this.preDelayL[this.preIndex] = dryL;
      this.preDelayR[this.preIndex] = dryR;
      let readIdx = this.preIndex - preSamples;
      if (readIdx < 0) readIdx += preLen;
      const inL = this.preDelayL[readIdx];
      const inR = this.preDelayR[readIdx];
      this.preIndex = (this.preIndex + 1) % preLen;

      const input = (inL + inR) * 0.5 * 0.015;
      let accL = 0;
      let accR = 0;
      for (let c = 0; c < this.combsL.length; c++) {
        const combL = this.combsL[c];
        const yL = combL.buffer[combL.index];
        combL.filterStore = yL * (1 - damping) + combL.filterStore * damping;
        combL.buffer[combL.index] = input + combL.filterStore * fb;
        combL.index = (combL.index + 1) % combL.buffer.length;
        accL += yL;

        const combR = this.combsR[c];
        const yR = combR.buffer[combR.index];
        combR.filterStore = yR * (1 - damping) + combR.filterStore * damping;
        combR.buffer[combR.index] = input + combR.filterStore * fb;
        combR.index = (combR.index + 1) % combR.buffer.length;
        accR += yR;
      }

      for (let a = 0; a < this.allpassL.length; a++) {
        const ap = this.allpassL[a];
        const buffered = ap.buffer[ap.index];
        const outAp = -accL + buffered;
        ap.buffer[ap.index] = accL + buffered * diff;
        ap.index = (ap.index + 1) % ap.buffer.length;
        accL = outAp;

        const apR = this.allpassR[a];
        const bufferedR = apR.buffer[apR.index];
        const outApR = -accR + bufferedR;
        apR.buffer[apR.index] = accR + bufferedR * diff;
        apR.index = (apR.index + 1) % apR.buffer.length;
        accR = outApR;
      }

      let wl = this.hpL.process(accL);
      wl = this.lpL.process(wl);
      let wr = this.hpR.process(accR);
      wr = this.lpR.process(wr);
      const mid = (wl + wr) * 0.5;
      const side = (wl - wr) * 0.5 * width;
      wl = mid + side;
      wr = mid - side;

      L[i] = (dryL * (1 - wet) + wl * wet) * out;
      R[i] = (dryR * (1 - wet) + wr * wet) * out;
      const al = Math.abs(L[i]);
      const ar = Math.abs(R[i]);
      if (al > this.peakL) this.peakL = al;
      if (ar > this.peakR) this.peakR = ar;
    }
    this.peakL *= 0.97;
    this.peakR *= 0.97;
  }

  reset(): void {
    for (const c of this.combsL) { c.buffer.fill(0); c.filterStore = 0; c.index = 0; }
    for (const c of this.combsR) { c.buffer.fill(0); c.filterStore = 0; c.index = 0; }
    for (const a of this.allpassL) { a.buffer.fill(0); a.index = 0; }
    for (const a of this.allpassR) { a.buffer.fill(0); a.index = 0; }
    this.preDelayL.fill(0);
    this.preDelayR.fill(0);
    this.hpL.reset(); this.hpR.reset(); this.lpL.reset(); this.lpR.reset();
  }

  meter(): ProcessorMeter {
    return { peakL: this.peakL, peakR: this.peakR };
  }
}

export const reverbDefinition: ProcessorDefinition = {
  type: 'reverb',
  name: 'Reverb',
  shortName: 'VERB',
  category: 'time',
  description: 'Freeverb-style algorithmic reverb with room, hall, plate and spring characters.',
  purpose: 'Adds space and depth. Kept off the master chain by default; used on tracks, buses and sends.',
  params: [
    { key: 'style', label: 'Character', kind: 'enum', options: ['Room', 'Hall', 'Plate', 'Spring'], default: 1 },
    { key: 'predelay', label: 'Pre-delay', kind: 'float', min: 0, max: 250, step: 1, default: 20, unit: 'ms' },
    { key: 'decay', label: 'Decay', kind: 'float', min: 0.2, max: 10, step: 0.1, default: 2.4, unit: 's' },
    { key: 'damping', label: 'Damping', kind: 'float', min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: 'width', label: 'Width', kind: 'float', min: 0, max: 150, step: 1, default: 100, unit: '%' },
    { key: 'lowCut', label: 'Low cut', kind: 'float', min: 20, max: 1000, step: 1, default: 120, unit: 'Hz', scale: 'log', advanced: true },
    { key: 'highCut', label: 'High cut', kind: 'float', min: 1000, max: 20000, step: 10, default: 8000, unit: 'Hz', scale: 'log', advanced: true },
    { key: 'mix', label: 'Wet mix', kind: 'float', min: 0, max: 100, step: 1, default: 25, unit: '%' },
    { key: 'output', label: 'Output', kind: 'float', min: -12, max: 12, step: 0.1, default: 0, unit: 'dB' },
  ],
  create: () => new Reverb(),
};
