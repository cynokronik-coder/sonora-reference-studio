import { Biquad, designBiquad } from '../biquad';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain } from '../util';

interface Comb {
  buffer: Float32Array;
  index: number;
  filterStore: number;
  feedback: number;
  feedbackTarget: number;
  feedbackStep: number;
  feedbackRemaining: number;
}

interface Allpass {
  buffer: Float32Array;
  index: number;
}

interface ReverbStyleSettings {
  dampingScale: number;
  diffusion: number;
  defaultPredelay: number;
}

const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNING = [556, 441, 341, 225];
const STEREO_SPREAD = 23;
const CONTROL_RAMP_MS = 20;

/**
 * Stereo Freeverb-derived algorithmic reverb.
 *
 * Eight parallel damped feedback combs per channel feed four series
 * Schroeder allpass diffusers. Each comb feedback coefficient is derived from
 * its actual delay length and the target RT60, so the decay control represents
 * a decay time in seconds instead of an arbitrary room-size scalar.
 *
 * The two channels own independent delay/filter histories. Predelay uses
 * fractional-sample interpolation and a buffer long enough for the full 250 ms
 * parameter range. This is a synthetic algorithmic space, not convolution.
 */
export class Reverb implements AudioProcessor {
  readonly type = 'reverb';
  readonly latency = 0;
  private sr = 48000;
  private maxBlock = 512;
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
  private lastLowCut = Number.NaN;
  private lastHighCut = Number.NaN;

  private decaySeconds = 2.4;
  private decayTarget = 2.4;
  private decayStep = 0;
  private decayRemaining = 0;
  private damping = 0.35;
  private dampingTarget = 0.35;
  private dampingStep = 0;
  private dampingRemaining = 0;
  private diffusion = 0.75;
  private diffusionTarget = 0.75;
  private diffusionStep = 0;
  private diffusionRemaining = 0;
  private predelaySamples = 960;
  private predelayTarget = 960;
  private predelayStep = 0;
  private predelayRemaining = 0;
  private wet = 0.25;
  private wetTarget = 0.25;
  private wetStep = 0;
  private wetRemaining = 0;
  private width = 1;
  private widthTarget = 1;
  private widthStep = 0;
  private widthRemaining = 0;
  private output = 1;
  private outputTarget = 1;
  private outputStep = 0;
  private outputRemaining = 0;
  private peakL = 0;
  private peakR = 0;
  private hasProcessed = false;

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = sampleRate;
    this.maxBlock = Math.max(1, maxBlock);
    this.buildBuffers();
    // +2 ensures that a full 250 ms delay is representable without reading the
    // sample currently being written into the same ring-buffer slot.
    const predelayCapacity = Math.ceil(sampleRate * 0.25) + 2;
    this.preDelayL = new Float32Array(predelayCapacity);
    this.preDelayR = new Float32Array(predelayCapacity);
    this.preIndex = 0;
    this.configureFilters(120, 8000, true);
    this.reset();
    this.setValues(this.values);
  }

  private makeComb(length: number): Comb {
    return {
      buffer: new Float32Array(Math.max(8, Math.round(length * (this.sr / 44100)))),
      index: 0,
      filterStore: 0,
      feedback: 0.8,
      feedbackTarget: 0.8,
      feedbackStep: 0,
      feedbackRemaining: 0,
    };
  }

  private buildBuffers(): void {
    this.combsL = COMB_TUNING.map((length) => this.makeComb(length));
    this.combsR = COMB_TUNING.map((length) => this.makeComb(length + STEREO_SPREAD));
    this.allpassL = ALLPASS_TUNING.map((length) => ({
      buffer: new Float32Array(Math.max(4, Math.round(length * (this.sr / 44100)))),
      index: 0,
    }));
    this.allpassR = ALLPASS_TUNING.map((length) => ({
      buffer: new Float32Array(Math.max(4, Math.round((length + STEREO_SPREAD) * (this.sr / 44100)))),
      index: 0,
    }));
  }

  private styleSettings(values: ParamValues): ReverbStyleSettings {
    const style = clamp(Math.round(values.style ?? 1), 0, 3);
    switch (style) {
      case 0: // Room: shorter, more damped and less diffuse.
        return { dampingScale: 1.1, diffusion: 0.6, defaultPredelay: 5 };
      case 1: // Hall: longer and more diffuse.
        return { dampingScale: 0.8, diffusion: 0.75, defaultPredelay: 20 };
      case 2: // Plate: bright, dense and moderately long.
        return { dampingScale: 0.55, diffusion: 0.86, defaultPredelay: 0 };
      case 3: // Spring-style algorithmic character: brighter, shorter and less diffuse.
        return { dampingScale: 0.45, diffusion: 0.45, defaultPredelay: 12 };
      default:
        return { dampingScale: 1, diffusion: 0.7, defaultPredelay: 10 };
    }
  }

  private setScalarRamp(
    current: number,
    target: number,
    kind: 'decay' | 'damping' | 'diffusion' | 'predelay' | 'wet' | 'width' | 'output',
  ): void {
    const remaining = Math.max(1, Math.round(this.sr * CONTROL_RAMP_MS / 1000));
    const step = (target - current) / remaining;
    switch (kind) {
      case 'decay': this.decayTarget = target; this.decayStep = step; this.decayRemaining = remaining; break;
      case 'damping': this.dampingTarget = target; this.dampingStep = step; this.dampingRemaining = remaining; break;
      case 'diffusion': this.diffusionTarget = target; this.diffusionStep = step; this.diffusionRemaining = remaining; break;
      case 'predelay': this.predelayTarget = target; this.predelayStep = step; this.predelayRemaining = remaining; break;
      case 'wet': this.wetTarget = target; this.wetStep = step; this.wetRemaining = remaining; break;
      case 'width': this.widthTarget = target; this.widthStep = step; this.widthRemaining = remaining; break;
      case 'output': this.outputTarget = target; this.outputStep = step; this.outputRemaining = remaining; break;
    }
  }

  private configureFilters(lowCut: number, highCut: number, immediate = false): void {
    const low = clamp(lowCut, 20, Math.min(1000, this.sr * 0.4));
    const high = clamp(highCut, 1000, this.sr * 0.45);
    if (!immediate && low === this.lastLowCut && high === this.lastHighCut) return;
    this.lastLowCut = low;
    this.lastHighCut = high;
    const lowCoefficients = designBiquad('highpass', low, 0, 0.707, this.sr);
    const highCoefficients = designBiquad('lowpass', high, 0, 0.707, this.sr);
    const samples = Math.max(1, Math.round(this.sr * CONTROL_RAMP_MS / 1000));
    for (const filter of [this.hpL, this.hpR]) {
      if (immediate) filter.set(lowCoefficients);
      else filter.setSmoothed(lowCoefficients, samples);
    }
    for (const filter of [this.lpL, this.lpR]) {
      if (immediate) filter.set(highCoefficients);
      else filter.setSmoothed(highCoefficients, samples);
    }
  }

  setValues(values: ParamValues): void {
    this.values = values;
    const style = this.styleSettings(values);
    // Decay is a real RT60 time in seconds regardless of character preset.
    const targetDecay = clamp(values.decay ?? 2.4, 0.2, 10);
    const targetDamping = clamp((values.damping ?? 0.35) * style.dampingScale, 0, 0.95);
    const targetDiffusion = clamp((values.diffusion ?? 0.75) * (style.diffusion / 0.75), 0.2, 0.95);
    const targetPredelay = clamp(values.predelay ?? style.defaultPredelay, 0, 250) * 0.001 * this.sr;
    const targetWet = clamp((values.mix ?? 25) / 100, 0, 1);
    const targetWidth = clamp((values.width ?? 100) / 100, 0, 1.5);
    const targetOutput = dbToGain(clamp(values.output ?? 0, -12, 12));

    // The first parameter snapshot arrives after prepare() in the normal
    // processor-chain lifecycle. Apply that initial state immediately so a
    // source impulse is not lost while a pre-delay glide moves its read head.
    // Subsequent automation/UI edits use 20 ms ramps.
    const immediate = !this.hasProcessed;
    if (immediate) {
      this.decaySeconds = this.decayTarget = targetDecay;
      this.damping = this.dampingTarget = targetDamping;
      this.diffusion = this.diffusionTarget = targetDiffusion;
      this.predelaySamples = this.predelayTarget = targetPredelay;
      this.wet = this.wetTarget = targetWet;
      this.width = this.widthTarget = targetWidth;
      this.output = this.outputTarget = targetOutput;
      this.decayRemaining = this.dampingRemaining = this.diffusionRemaining = 0;
      this.predelayRemaining = this.wetRemaining = this.widthRemaining = this.outputRemaining = 0;
    } else {
      if (targetDecay !== this.decayTarget) this.setScalarRamp(this.decaySeconds, targetDecay, 'decay');
      if (targetDamping !== this.dampingTarget) this.setScalarRamp(this.damping, targetDamping, 'damping');
      if (targetDiffusion !== this.diffusionTarget) this.setScalarRamp(this.diffusion, targetDiffusion, 'diffusion');
      if (targetPredelay !== this.predelayTarget) this.setScalarRamp(this.predelaySamples, targetPredelay, 'predelay');
      if (targetWet !== this.wetTarget) this.setScalarRamp(this.wet, targetWet, 'wet');
      if (targetWidth !== this.widthTarget) this.setScalarRamp(this.width, targetWidth, 'width');
      if (targetOutput !== this.outputTarget) this.setScalarRamp(this.output, targetOutput, 'output');
    }

    this.configureFilters(values.lowCut ?? 120, values.highCut ?? 8000, immediate);
    this.updateCombFeedbackTargets(targetDecay, immediate);
  }

  private updateCombFeedbackTargets(decaySeconds: number, immediate = false): void {
    const rampSamples = Math.max(1, Math.round(this.sr * CONTROL_RAMP_MS / 1000));
    const update = (comb: Comb) => {
      const delaySeconds = comb.buffer.length / this.sr;
      const target = clamp(Math.pow(10, (-3 * delaySeconds) / decaySeconds), 0.05, 0.9995);
      comb.feedbackTarget = target;
      if (immediate) {
        comb.feedback = target;
        comb.feedbackRemaining = 0;
        comb.feedbackStep = 0;
      } else {
        comb.feedbackRemaining = rampSamples;
        comb.feedbackStep = (target - comb.feedback) / rampSamples;
      }
    };
    for (const comb of this.combsL) update(comb);
    for (const comb of this.combsR) update(comb);
  }

  private advanceControls(): void {
    if (this.decayRemaining > 0) { this.decaySeconds += this.decayStep; if (--this.decayRemaining === 0) this.decaySeconds = this.decayTarget; }
    if (this.dampingRemaining > 0) { this.damping += this.dampingStep; if (--this.dampingRemaining === 0) this.damping = this.dampingTarget; }
    if (this.diffusionRemaining > 0) { this.diffusion += this.diffusionStep; if (--this.diffusionRemaining === 0) this.diffusion = this.diffusionTarget; }
    if (this.predelayRemaining > 0) { this.predelaySamples += this.predelayStep; if (--this.predelayRemaining === 0) this.predelaySamples = this.predelayTarget; }
    if (this.wetRemaining > 0) { this.wet += this.wetStep; if (--this.wetRemaining === 0) this.wet = this.wetTarget; }
    if (this.widthRemaining > 0) { this.width += this.widthStep; if (--this.widthRemaining === 0) this.width = this.widthTarget; }
    if (this.outputRemaining > 0) { this.output += this.outputStep; if (--this.outputRemaining === 0) this.output = this.outputTarget; }
  }

  private advanceFeedback(comb: Comb): void {
    if (comb.feedbackRemaining > 0) {
      comb.feedback += comb.feedbackStep;
      comb.feedbackRemaining--;
      if (comb.feedbackRemaining === 0) comb.feedback = comb.feedbackTarget;
    }
  }

  private readPredelay(buffer: Float32Array, delaySamples: number): number {
    const length = buffer.length;
    const whole = Math.floor(delaySamples);
    const fraction = delaySamples - whole;
    let a = this.preIndex - whole;
    let b = a - 1;
    if (a < 0) a += length;
    if (b < 0) b += length;
    return buffer[a] * (1 - fraction) + buffer[b] * fraction;
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    if (n > this.maxBlock) throw new RangeError(`Reverb block size ${n} exceeds prepared capacity ${this.maxBlock}`);

    if (n > 0) this.hasProcessed = true;
    let peakL = 0;
    let peakR = 0;
    for (let i = 0; i < n; i++) {
      this.advanceControls();
      const dryL = L[i];
      const dryR = R[i];
      this.preDelayL[this.preIndex] = dryL;
      this.preDelayR[this.preIndex] = dryR;
      const inL = this.readPredelay(this.preDelayL, this.predelaySamples);
      const inR = this.readPredelay(this.preDelayR, this.predelaySamples);
      this.preIndex = (this.preIndex + 1) % this.preDelayL.length;

      const input = (inL + inR) * 0.5 * 0.015;
      let accL = 0;
      let accR = 0;
      for (let c = 0; c < this.combsL.length; c++) {
        const combL = this.combsL[c];
        this.advanceFeedback(combL);
        const yL = combL.buffer[combL.index];
        combL.filterStore = yL * (1 - this.damping) + combL.filterStore * this.damping;
        combL.buffer[combL.index] = input + combL.filterStore * combL.feedback;
        combL.index = (combL.index + 1) % combL.buffer.length;
        accL += yL;

        const combR = this.combsR[c];
        this.advanceFeedback(combR);
        const yR = combR.buffer[combR.index];
        combR.filterStore = yR * (1 - this.damping) + combR.filterStore * this.damping;
        combR.buffer[combR.index] = input + combR.filterStore * combR.feedback;
        combR.index = (combR.index + 1) % combR.buffer.length;
        accR += yR;
      }

      for (let a = 0; a < this.allpassL.length; a++) {
        const ap = this.allpassL[a];
        const buffered = ap.buffer[ap.index];
        const outAp = -accL + buffered;
        ap.buffer[ap.index] = accL + buffered * this.diffusion;
        ap.index = (ap.index + 1) % ap.buffer.length;
        accL = outAp;

        const apR = this.allpassR[a];
        const bufferedR = apR.buffer[apR.index];
        const outApR = -accR + bufferedR;
        apR.buffer[apR.index] = accR + bufferedR * this.diffusion;
        apR.index = (apR.index + 1) % apR.buffer.length;
        accR = outApR;
      }

      let wetL = this.hpL.process(accL);
      wetL = this.lpL.process(wetL);
      let wetR = this.hpR.process(accR);
      wetR = this.lpR.process(wetR);
      const mid = (wetL + wetR) * 0.5;
      const side = (wetL - wetR) * 0.5 * this.width;
      wetL = mid + side;
      wetR = mid - side;

      L[i] = (dryL * (1 - this.wet) + wetL * this.wet) * this.output;
      R[i] = (dryR * (1 - this.wet) + wetR * this.wet) * this.output;
      peakL = Math.max(peakL, Math.abs(L[i]));
      peakR = Math.max(peakR, Math.abs(R[i]));
    }
    this.peakL = Math.max(peakL, this.peakL * 0.97);
    this.peakR = Math.max(peakR, this.peakR * 0.97);
  }

  reset(): void {
    for (const comb of this.combsL) {
      comb.buffer.fill(0); comb.filterStore = 0; comb.index = 0;
      comb.feedback = comb.feedbackTarget; comb.feedbackRemaining = 0;
    }
    for (const comb of this.combsR) {
      comb.buffer.fill(0); comb.filterStore = 0; comb.index = 0;
      comb.feedback = comb.feedbackTarget; comb.feedbackRemaining = 0;
    }
    for (const allpass of this.allpassL) { allpass.buffer.fill(0); allpass.index = 0; }
    for (const allpass of this.allpassR) { allpass.buffer.fill(0); allpass.index = 0; }
    this.preDelayL.fill(0);
    this.preDelayR.fill(0);
    this.preIndex = 0;
    this.hpL.reset(); this.hpR.reset(); this.lpL.reset(); this.lpR.reset();
    this.configureFilters(this.lastLowCut || 120, this.lastHighCut || 8000, true);
    this.decaySeconds = this.decayTarget;
    this.damping = this.dampingTarget;
    this.diffusion = this.diffusionTarget;
    this.predelaySamples = this.predelayTarget;
    this.wet = this.wetTarget;
    this.width = this.widthTarget;
    this.output = this.outputTarget;
    this.decayRemaining = this.dampingRemaining = this.diffusionRemaining = 0;
    this.predelayRemaining = this.wetRemaining = this.widthRemaining = this.outputRemaining = 0;
    this.peakL = 0;
    this.peakR = 0;
    this.hasProcessed = false;
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
  description: 'Algorithmic stereo reverb with per-comb RT60 decay, room, hall, plate and spring characters.',
  purpose: 'Adds synthetic space and depth. Use on tracks, buses or sends; the algorithm is not convolution of a captured room.',
  params: [
    { key: 'style', label: 'Character', kind: 'enum', options: ['Room', 'Hall', 'Plate', 'Spring'], default: 1 },
    { key: 'predelay', label: 'Pre-delay', kind: 'float', min: 0, max: 250, step: 1, default: 20, unit: 'ms', group: 'Timing' },
    { key: 'decay', label: 'Decay (RT60)', kind: 'float', min: 0.2, max: 10, step: 0.1, default: 2.4, unit: 's', group: 'Decay' },
    { key: 'damping', label: 'Damping', kind: 'float', min: 0, max: 0.95, step: 0.01, default: 0.35, group: 'Decay' },
    { key: 'diffusion', label: 'Diffusion', kind: 'float', min: 0.2, max: 0.95, step: 0.01, default: 0.75, group: 'Character' },
    { key: 'width', label: 'Width', kind: 'float', min: 0, max: 150, step: 1, default: 100, unit: '%', group: 'Stereo' },
    { key: 'lowCut', label: 'Low cut', kind: 'float', min: 20, max: 1000, step: 1, default: 120, unit: 'Hz', scale: 'log', advanced: true, group: 'Tone' },
    { key: 'highCut', label: 'High cut', kind: 'float', min: 1000, max: 20000, step: 10, default: 8000, unit: 'Hz', scale: 'log', advanced: true, group: 'Tone' },
    { key: 'mix', label: 'Wet mix', kind: 'float', min: 0, max: 100, step: 1, default: 25, unit: '%', group: 'Output' },
    { key: 'output', label: 'Output', kind: 'float', min: -12, max: 12, step: 0.1, default: 0, unit: 'dB', group: 'Output' },
  ],
  create: () => new Reverb(),
};

export interface ReverbPreset {
  id: string;
  name: string;
  description: string;
  values: ParamValues;
}

function reverbPreset(id: string, name: string, description: string, overrides: ParamValues): ReverbPreset {
  const values: ParamValues = {};
  for (const param of reverbDefinition.params) values[param.key] = param.default;
  return { id, name, description, values: { ...values, ...overrides } };
}

export const REVERB_PRESETS: ReverbPreset[] = [
  reverbPreset('small-room', 'Small room', 'Short, controlled early space for close vocals, guitars and percussion.', {
    style: 0, predelay: 4, decay: 0.8, damping: 0.48, diffusion: 0.58, width: 85, lowCut: 140, highCut: 9_000, mix: 18,
  }),
  reverbPreset('vocal-plate', 'Vocal plate', 'Dense, bright plate-style tail with enough pre-delay to keep the dry vocal forward.', {
    style: 2, predelay: 35, decay: 2.2, damping: 0.25, diffusion: 0.88, width: 120, lowCut: 180, highCut: 12_000, mix: 22,
  }),
  reverbPreset('large-hall', 'Large hall', 'Longer, more diffuse space for sustained sources and broad arrangements.', {
    style: 1, predelay: 45, decay: 4.8, damping: 0.35, diffusion: 0.8, width: 120, lowCut: 100, highCut: 10_000, mix: 22,
  }),
  reverbPreset('spring-amp', 'Spring amp', 'Shorter, brighter and more characterful tail for guitar or creative sends.', {
    style: 3, predelay: 12, decay: 1.4, damping: 0.2, diffusion: 0.48, width: 110, lowCut: 160, highCut: 8_500, mix: 25,
  }),
  reverbPreset('ambient-wash', 'Ambient wash', 'A long, wide tail intended for pads and textures rather than transparent depth.', {
    style: 1, predelay: 70, decay: 8, damping: 0.22, diffusion: 0.92, width: 145, lowCut: 100, highCut: 14_000, mix: 38,
  }),
];
