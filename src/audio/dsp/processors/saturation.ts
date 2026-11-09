import { Biquad, designBiquad } from '../biquad';
import { Oversampler } from '../oversample';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain, gainToDb } from '../util';

export const SATURATION_MODES = ['Tape', 'Tube', 'Console', 'Soft clip', 'Hard clip', 'Wavefold'] as const;

/** Asymmetric waveshapers used by the saturator and exciter. */
export function shapeSample(x: number, mode: number, bias = 0.08): number {
  switch (mode) {
    case 0: {
      const b = bias;
      const shaped = Math.tanh(x + b) - Math.tanh(b);
      return shaped / Math.max(0.25, 1 - Math.abs(b));
    }
    case 1:
      return Math.tanh(x + 0.18 * x * x + 0.02);
    case 2: {
      const y = x - (x * x * x) / 3;
      return Math.abs(x) > 1 ? Math.sign(x) * (2 / 3) : y;
    }
    case 3:
      return Math.tanh(x);
    case 4:
      return clamp(x, -1, 1);
    case 5:
      return Math.sin(clamp(x, -8, 8) * 1.4);
    default:
      return Math.tanh(x);
  }
}

/**
 * Stereo saturator with independent filter histories, preallocated render
 * buffers, smoothed nonlinear controls and selectable 1x/2x/4x processing.
 * IIR oversampling minimises delay but has frequency-dependent phase shift;
 * its wet/dry path is therefore passed through a matching oversampling filter
 * pair before blending. This is not advertised as linear-phase processing.
 */
export class Saturator implements AudioProcessor {
  readonly type = 'saturation';
  readonly latency = 0;
  private sr = 48000;
  private maxBlock = 512;
  private values: ParamValues = {};
  private os: Oversampler | null = null;
  private dryOs: Oversampler | null = null;
  private osFactor: 1 | 2 | 4 = 1;
  private osPreparedBlock = 0;
  private osPreparedSampleRate = 0;
  private preFilterL = new Biquad();
  private preFilterR = new Biquad();
  private postToneL = new Biquad();
  private postToneR = new Biquad();
  private dcBlockL = new Biquad();
  private dcBlockR = new Biquad();
  private modeFrom = 0;
  private modeTo = 0;
  private modeBlend = 1;
  private modeStep = 0;
  private modeRemaining = 0;
  private lastPreDriveDb = Number.NaN;
  private lastToneDb = Number.NaN;
  private drive = 1;
  private driveTarget = 1;
  private driveStep = 0;
  private compGain = 1;
  private compGainTarget = 1;
  private compGainStep = 0;
  private nonlinearRemaining = 0;
  private outGain = 1;
  private outGainTarget = 1;
  private outGainStep = 0;
  private outGainRemaining = 0;
  private mix = 1;
  private mixTarget = 1;
  private mixStep = 0;
  private mixRemaining = 0;
  private dryL = new Float32Array(512);
  private dryR = new Float32Array(512);
  private wetL = new Float32Array(512);
  private wetR = new Float32Array(512);
  private alignedDryL = new Float32Array(512);
  private alignedDryR = new Float32Array(512);
  private blockPeakL = 0;
  private blockPeakR = 0;

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = sampleRate;
    this.maxBlock = Math.max(1, maxBlock);
    this.dryL = new Float32Array(this.maxBlock);
    this.dryR = new Float32Array(this.maxBlock);
    this.wetL = new Float32Array(this.maxBlock);
    this.wetR = new Float32Array(this.maxBlock);
    this.alignedDryL = new Float32Array(this.maxBlock);
    this.alignedDryR = new Float32Array(this.maxBlock);
    this.dcBlockL.configure('highpass', 18, 0, 0.707, sampleRate);
    this.dcBlockR.configure('highpass', 18, 0, 0.707, sampleRate);
    this.configureToneFilters(true);
    this.buildOversampler();
    this.reset();
  }

  private oversamplingChoice(): 1 | 2 | 4 {
    const choice = clamp(Math.round(this.values.oversample ?? 2), 0, 2);
    return choice === 0 ? 1 : choice === 1 ? 2 : 4;
  }

  private buildOversampler(): void {
    const chosen = this.oversamplingChoice();
    if (chosen === this.osFactor && this.os && this.osPreparedBlock === this.maxBlock && this.osPreparedSampleRate === this.sr) return;
    this.osFactor = chosen;
    this.osPreparedBlock = this.maxBlock;
    this.osPreparedSampleRate = this.sr;
    this.os = new Oversampler(chosen, 2, this.maxBlock);
    this.dryOs = chosen > 1 ? new Oversampler(chosen, 2, this.maxBlock) : null;
    this.os.prepare(this.sr);
    this.dryOs?.prepare(this.sr);
  }

  private configureToneFilters(immediate = false): void {
    const driveDb = clamp(this.values.drive ?? 4, 0, 30);
    const toneDb = clamp(this.values.tone ?? 0, -10, 10) * 1.5;
    if (!immediate && driveDb === this.lastPreDriveDb && toneDb === this.lastToneDb) return;
    const pre = designBiquad('highshelf', 6000, -driveDb * 0.15, 0.707, this.sr);
    const post = designBiquad('highshelf', 4500, toneDb, 0.707, this.sr);
    this.lastPreDriveDb = driveDb;
    this.lastToneDb = toneDb;
    const samples = Math.max(1, Math.round(this.sr * 0.02));
    for (const filter of [this.preFilterL, this.preFilterR]) {
      if (immediate) filter.set(pre);
      else filter.setSmoothed(pre, samples);
    }
    for (const filter of [this.postToneL, this.postToneR]) {
      if (immediate) filter.set(post);
      else filter.setSmoothed(post, samples);
    }
  }

  setValues(values: ParamValues): void {
    const previousOversampling = this.osFactor;
    this.values = values;
    const nextMode = clamp(Math.round(values.mode ?? 0), 0, SATURATION_MODES.length - 1);
    if (nextMode !== this.modeTo) {
      this.modeFrom = this.modeTo;
      this.modeTo = nextMode;
      this.modeBlend = 0;
      this.modeRemaining = Math.max(1, Math.round(this.sr * 0.01 * this.osFactor));
      this.modeStep = 1 / this.modeRemaining;
    }

    const driveDb = clamp(values.drive ?? 4, 0, 30);
    const nextDrive = dbToGain(driveDb);
    const nextComp = 1 / Math.max(0.15, Math.tanh(nextDrive) * 0.85 + 0.15);
    if (nextDrive !== this.driveTarget || nextComp !== this.compGainTarget) {
      this.driveTarget = nextDrive;
      this.compGainTarget = nextComp;
      this.nonlinearRemaining = Math.max(1, Math.round(this.sr * 0.02 * this.osFactor));
      this.driveStep = (this.driveTarget - this.drive) / this.nonlinearRemaining;
      this.compGainStep = (this.compGainTarget - this.compGain) / this.nonlinearRemaining;
    }

    const nextOutput = dbToGain(clamp(values.output ?? 0, -18, 18));
    if (nextOutput !== this.outGainTarget) {
      this.outGainTarget = nextOutput;
      this.outGainRemaining = Math.max(1, Math.round(this.sr * 0.02));
      this.outGainStep = (nextOutput - this.outGain) / this.outGainRemaining;
    }
    const nextMix = clamp((values.mix ?? 100) / 100, 0, 1);
    if (nextMix !== this.mixTarget) {
      this.mixTarget = nextMix;
      this.mixRemaining = Math.max(1, Math.round(this.sr * 0.02));
      this.mixStep = (nextMix - this.mix) / this.mixRemaining;
    }
    this.configureToneFilters();
    this.buildOversampler();
    if (previousOversampling !== this.osFactor) {
      this.modeRemaining = Math.max(1, Math.round(this.sr * 0.01 * this.osFactor));
      this.modeBlend = 0;
      this.modeFrom = this.modeTo;
      this.modeRemaining = 0;
    }
  }

  private advanceNonlinearControls(): void {
    if (this.nonlinearRemaining > 0) {
      this.drive += this.driveStep;
      this.compGain += this.compGainStep;
      this.nonlinearRemaining--;
      if (this.nonlinearRemaining === 0) {
        this.drive = this.driveTarget;
        this.compGain = this.compGainTarget;
      }
    }
    if (this.modeRemaining > 0) {
      this.modeBlend = Math.min(1, this.modeBlend + this.modeStep);
      this.modeRemaining--;
      if (this.modeRemaining === 0) this.modeBlend = 1;
    }
  }

  private shapePair(L: Float32Array, R: Float32Array, count: number): void {
    for (let i = 0; i < count; i++) {
      this.advanceNonlinearControls();
      const left = L[i] * this.drive;
      const right = R[i] * this.drive;
      const oldL = shapeSample(left, this.modeFrom);
      const oldR = shapeSample(right, this.modeFrom);
      const newL = shapeSample(left, this.modeTo);
      const newR = shapeSample(right, this.modeTo);
      L[i] = (oldL + (newL - oldL) * this.modeBlend) * this.compGain;
      R[i] = (oldR + (newR - oldR) * this.modeBlend) * this.compGain;
    }
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    if (n > this.maxBlock) {
      // The render quantum is prepared by the engine. Fail closed rather than
      // allocate new buffers in the realtime audio callback.
      throw new RangeError(`Saturator block size ${n} exceeds prepared capacity ${this.maxBlock}`);
    }

    this.dryL.set(L.subarray(0, n), 0);
    this.dryR.set(R.subarray(0, n), 0);

    // Pre-emphasis is designed and processed at the host sample rate.
    this.preFilterL.processBlock(L, n);
    this.preFilterR.processBlock(R, n);

    if (this.os && this.osFactor > 1) {
      const upL = this.os.upsample(L, n, 0);
      const upR = this.os.upsample(R, n, 1);
      this.shapePair(upL, upR, n * this.osFactor);
      this.os.downsample(upL, n, this.wetL, 0);
      this.os.downsample(upR, n, this.wetR, 1);

      // Advance the dry oversampler continuously, even at 100% wet, so a
      // later switch to parallel blending has matching filter history.
      const dryUpL = this.dryOs!.upsample(this.dryL, n, 0);
      const dryUpR = this.dryOs!.upsample(this.dryR, n, 1);
      this.dryOs!.downsample(dryUpL, n, this.alignedDryL, 0);
      this.dryOs!.downsample(dryUpR, n, this.alignedDryR, 1);
    } else {
      this.shapePair(L, R, n);
      this.wetL.set(L.subarray(0, n));
      this.wetR.set(R.subarray(0, n));
      this.alignedDryL.set(this.dryL.subarray(0, n));
      this.alignedDryR.set(this.dryR.subarray(0, n));
    }

    this.postToneL.processBlock(this.wetL, n);
    this.postToneR.processBlock(this.wetR, n);
    this.dcBlockL.processBlock(this.wetL, n);
    this.dcBlockR.processBlock(this.wetR, n);

    let peakL = 0;
    let peakR = 0;
    for (let i = 0; i < n; i++) {
      if (this.mixRemaining > 0) {
        this.mix += this.mixStep;
        this.mixRemaining--;
        if (this.mixRemaining === 0) this.mix = this.mixTarget;
      }
      if (this.outGainRemaining > 0) {
        this.outGain += this.outGainStep;
        this.outGainRemaining--;
        if (this.outGainRemaining === 0) this.outGain = this.outGainTarget;
      }
      const dryL = this.mix <= 0 ? this.dryL[i] : this.mix < 1 && this.osFactor > 1 ? this.alignedDryL[i] : this.dryL[i];
      const dryR = this.mix <= 0 ? this.dryR[i] : this.mix < 1 && this.osFactor > 1 ? this.alignedDryR[i] : this.dryR[i];
      L[i] = (dryL * (1 - this.mix) + this.wetL[i] * this.mix) * this.outGain;
      R[i] = (dryR * (1 - this.mix) + this.wetR[i] * this.mix) * this.outGain;
      peakL = Math.max(peakL, Math.abs(L[i]));
      peakR = Math.max(peakR, Math.abs(R[i]));
    }
    this.blockPeakL = Math.max(peakL, this.blockPeakL * 0.97);
    this.blockPeakR = Math.max(peakR, this.blockPeakR * 0.97);
  }

  reset(): void {
    this.os?.reset();
    this.dryOs?.reset();
    this.preFilterL.reset();
    this.preFilterR.reset();
    this.postToneL.reset();
    this.postToneR.reset();
    this.dcBlockL.reset();
    this.dcBlockR.reset();
    this.configureToneFilters(true);
    this.drive = this.driveTarget;
    this.compGain = this.compGainTarget;
    this.nonlinearRemaining = 0;
    this.modeFrom = this.modeTo;
    this.modeBlend = 1;
    this.modeRemaining = 0;
    this.mix = this.mixTarget;
    this.mixRemaining = 0;
    this.outGain = this.outGainTarget;
    this.outGainRemaining = 0;
    this.blockPeakL = 0;
    this.blockPeakR = 0;
  }

  meter(): ProcessorMeter {
    return {
      peakL: this.blockPeakL,
      peakR: this.blockPeakR,
      gain: gainToDb(this.drive),
    };
  }
}

export interface SaturationPreset {
  id: string;
  name: string;
  description: string;
  values: ParamValues;
}

function saturationPreset(id: string, name: string, description: string, overrides: ParamValues): SaturationPreset {
  const values: ParamValues = {};
  for (const param of saturationDefinition.params) values[param.key] = param.default;
  return { id, name, description, values: { ...values, ...overrides } };
}

/** Editable tone and harmonic starting points, not hardware emulations. */
export const SATURATION_PRESETS: SaturationPreset[] = [
  saturationPreset('tape-warmth', 'Tape warmth', 'Gentle asymmetric density with a restrained top-end tilt.', {
    mode: 0, drive: 3.5, tone: -0.8, mix: 55, output: -1.2, oversample: 2,
  }),
  saturationPreset('tube-density', 'Tube density', 'Adds asymmetric harmonic colour and density without requiring a large output lift.', {
    mode: 1, drive: 5, tone: 0.4, mix: 35, output: -1.5, oversample: 2,
  }),
  saturationPreset('console-glue', 'Console glue', 'A subtle cubic curve for a little extra cohesion and harmonic texture.', {
    mode: 2, drive: 2.5, tone: 0, mix: 45, output: -0.8, oversample: 2,
  }),
  saturationPreset('soft-peak-rounding', 'Soft peak rounding', 'Rounds occasional peaks with a smoother transfer curve.', {
    mode: 3, drive: 7, tone: -0.3, mix: 70, output: -2, oversample: 2,
  }),
  saturationPreset('hard-edge', 'Hard edge', 'A more assertive clipped character intended for deliberate sound design and peak shaping.', {
    mode: 4, drive: 9, tone: 0, mix: 45, output: -3, oversample: 2,
  }),
  saturationPreset('wavefold-colour', 'Wavefold colour', 'An overt nonlinear effect for creative harmonic transformation rather than transparent mastering.', {
    mode: 5, drive: 8, tone: 0.5, mix: 30, output: -2, oversample: 2,
  }),
  saturationPreset('subtle-mastering-density', 'Subtle mastering density', 'A low-drive parallel starting point; level-match against bypass before deciding.', {
    mode: 0, drive: 1.5, tone: 0, mix: 25, output: -0.5, oversample: 2,
  }),
];

export const saturationDefinition: ProcessorDefinition = {
  type: 'saturation',
  name: 'Saturation',
  shortName: 'SAT',
  category: 'saturation',
  description: 'Six waveshaping styles with independent stereo filter state, smoothed controls, parallel dry/wet and 1x/2x/4x oversampling.',
  purpose: 'Adds harmonics and density. Always level-match the output and compare at matched loudness; oversampling reduces, but does not eliminate, aliasing.',
  params: [
    { key: 'mode', label: 'Style', kind: 'enum', options: [...SATURATION_MODES], default: 0 },
    { key: 'drive', label: 'Drive', kind: 'float', min: 0, max: 30, step: 0.1, default: 4, unit: 'dB' },
    { key: 'tone', label: 'Tone', kind: 'float', min: -10, max: 10, step: 0.1, default: 0, unit: 'dB' },
    { key: 'mix', label: 'Dry/wet', kind: 'float', min: 0, max: 100, step: 1, default: 100, unit: '%' },
    { key: 'output', label: 'Output', kind: 'float', min: -18, max: 18, step: 0.1, default: 0, unit: 'dB' },
    { key: 'oversample', label: 'Oversampling', kind: 'enum', options: ['Off', '2x', '4x'], default: 2, advanced: true },
  ],
  create: () => new Saturator(),
};
