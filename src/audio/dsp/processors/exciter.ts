import { Biquad, designBiquad } from '../biquad';
import { Oversampler } from '../oversample';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain } from '../util';
import { shapeSample } from './saturation';

export const EXCITER_MODES = ['Tape', 'Tube', 'Console', 'Soft clip', 'Wavefold'] as const;

/**
 * High-band parallel harmonic exciter.
 *
 * A fourth-order high-pass isolates the selected upper band. Only that band
 * enters the nonlinear stage; the processor adds the difference between the
 * shaped and phase-aligned linear high-band signals back to the untouched
 * programme. This preserves the original low-frequency path and makes 0%
 * Amount an exact dry output once the control ramp settles.
 */
export class Exciter implements AudioProcessor {
  readonly type = 'exciter';
  readonly latency = 0;
  private sr = 48000;
  private maxBlock = 512;
  private values: ParamValues = {};
  private hpL = new Biquad();
  private hpR = new Biquad();
  private hpL2 = new Biquad();
  private hpR2 = new Biquad();
  private os: Oversampler | null = null;
  private dryOs: Oversampler | null = null;
  private osFactor: 1 | 2 | 4 = 1;
  private osPreparedBlock = 0;
  private osPreparedSampleRate = 0;
  private originalL = new Float32Array(512);
  private originalR = new Float32Array(512);
  private highL = new Float32Array(512);
  private highR = new Float32Array(512);
  private alignedHighL = new Float32Array(512);
  private alignedHighR = new Float32Array(512);
  private wetHighL = new Float32Array(512);
  private wetHighR = new Float32Array(512);
  private lastFreq = Number.NaN;
  private drive = 1;
  private driveTarget = 1;
  private driveStep = 0;
  private comp = 1;
  private compTarget = 1;
  private compStep = 0;
  private nonlinearRemaining = 0;
  private modeFrom = 1;
  private modeTo = 1;
  private modeBlend = 1;
  private modeStep = 0;
  private modeRemaining = 0;
  private amount = 0.3;
  private amountTarget = 0.3;
  private amountStep = 0;
  private amountRemaining = 0;
  private output = 1;
  private outputTarget = 1;
  private outputStep = 0;
  private outputRemaining = 0;
  private peakL = 0;
  private peakR = 0;

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = sampleRate;
    this.maxBlock = Math.max(1, maxBlock);
    this.originalL = new Float32Array(this.maxBlock);
    this.originalR = new Float32Array(this.maxBlock);
    this.highL = new Float32Array(this.maxBlock);
    this.highR = new Float32Array(this.maxBlock);
    this.alignedHighL = new Float32Array(this.maxBlock);
    this.alignedHighR = new Float32Array(this.maxBlock);
    this.wetHighL = new Float32Array(this.maxBlock);
    this.wetHighR = new Float32Array(this.maxBlock);
    this.buildOversampler();
    this.reset();
    this.configure(this.values.frequency ?? 6000, true);
  }

  private oversamplingChoice(): 1 | 2 | 4 {
    const choice = clamp(Math.round(this.values.oversample ?? 2), 0, 2);
    return choice === 0 ? 1 : choice === 1 ? 2 : 4;
  }

  private buildOversampler(): void {
    const chosen = this.oversamplingChoice();
    if (chosen === this.osFactor && this.os
      && this.osPreparedBlock === this.maxBlock && this.osPreparedSampleRate === this.sr) return;
    this.osFactor = chosen;
    this.osPreparedBlock = this.maxBlock;
    this.osPreparedSampleRate = this.sr;
    this.os = new Oversampler(chosen, 2, this.maxBlock);
    this.dryOs = chosen > 1 ? new Oversampler(chosen, 2, this.maxBlock) : null;
    this.os.prepare(this.sr);
    this.dryOs?.prepare(this.sr);
  }

  private configure(frequency: number, immediate = false): void {
    const next = clamp(frequency, 2000, Math.min(14_000, this.sr * 0.45));
    if (!immediate && Math.abs(next - this.lastFreq) < 0.5) return;
    this.lastFreq = next;
    const coefficients = designBiquad('highpass', next, 0, 0.7071067811865476, this.sr);
    const samples = Math.max(1, Math.round(this.sr * 0.02));
    for (const filter of [this.hpL, this.hpR, this.hpL2, this.hpR2]) {
      if (immediate) filter.set(coefficients);
      else filter.setSmoothed(coefficients, samples);
    }
  }

  setValues(values: ParamValues): void {
    this.values = values;
    this.configure(values.frequency ?? 6000);

    const driveDb = clamp(values.drive ?? 6, 0, 24);
    const nextDrive = dbToGain(driveDb);
    const nextComp = 1 / Math.max(1, nextDrive * 0.5);
    if (nextDrive !== this.driveTarget || nextComp !== this.compTarget) {
      this.driveTarget = nextDrive;
      this.compTarget = nextComp;
      this.nonlinearRemaining = Math.max(1, Math.round(this.sr * 0.02 * this.osFactor));
      this.driveStep = (nextDrive - this.drive) / this.nonlinearRemaining;
      this.compStep = (nextComp - this.comp) / this.nonlinearRemaining;
    }

    const mode = clamp(Math.round(values.mode ?? 1), 0, EXCITER_MODES.length - 1);
    if (mode !== this.modeTo) {
      this.modeFrom = this.modeTo;
      this.modeTo = mode;
      this.modeBlend = 0;
      this.modeRemaining = Math.max(1, Math.round(this.sr * 0.01 * this.osFactor));
      this.modeStep = 1 / this.modeRemaining;
    }

    const nextAmount = clamp((values.mix ?? 30) / 100, 0, 1);
    if (nextAmount !== this.amountTarget) {
      this.amountTarget = nextAmount;
      this.amountRemaining = Math.max(1, Math.round(this.sr * 0.02));
      this.amountStep = (nextAmount - this.amount) / this.amountRemaining;
    }

    const nextOutput = dbToGain(clamp(values.output ?? 0, -12, 12));
    if (nextOutput !== this.outputTarget) {
      this.outputTarget = nextOutput;
      this.outputRemaining = Math.max(1, Math.round(this.sr * 0.02));
      this.outputStep = (nextOutput - this.output) / this.outputRemaining;
    }

    this.buildOversampler();
  }

  private advanceNonlinearControls(): void {
    if (this.nonlinearRemaining > 0) {
      this.drive += this.driveStep;
      this.comp += this.compStep;
      this.nonlinearRemaining--;
      if (this.nonlinearRemaining === 0) {
        this.drive = this.driveTarget;
        this.comp = this.compTarget;
      }
    }
    if (this.modeRemaining > 0) {
      this.modeBlend = Math.min(1, this.modeBlend + this.modeStep);
      this.modeRemaining--;
      if (this.modeRemaining === 0) this.modeBlend = 1;
    }
  }

  private shapeHighBand(L: Float32Array, R: Float32Array, count: number): void {
    for (let i = 0; i < count; i++) {
      this.advanceNonlinearControls();
      const inputL = L[i] * this.drive;
      const inputR = R[i] * this.drive;
      const oldL = shapeSample(inputL, this.modeFrom);
      const oldR = shapeSample(inputR, this.modeFrom);
      const newL = shapeSample(inputL, this.modeTo);
      const newR = shapeSample(inputR, this.modeTo);
      L[i] = (oldL + (newL - oldL) * this.modeBlend) * this.comp;
      R[i] = (oldR + (newR - oldR) * this.modeBlend) * this.comp;
    }
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    if (n > this.maxBlock) {
      throw new RangeError(`Exciter block size ${n} exceeds prepared capacity ${this.maxBlock}`);
    }
    this.originalL.set(L.subarray(0, n));
    this.originalR.set(R.subarray(0, n));

    // The LR4 high-pass pair isolates only the band that will generate harmonics.
    this.hpL2.processBlock(L, n);
    this.hpL.processBlock(L, n);
    this.hpR2.processBlock(R, n);
    this.hpR.processBlock(R, n);
    this.highL.set(L.subarray(0, n));
    this.highR.set(R.subarray(0, n));

    if (this.osFactor > 1 && this.os && this.dryOs) {
      const wetUpL = this.os.upsample(this.highL, n, 0);
      const wetUpR = this.os.upsample(this.highR, n, 1);
      this.shapeHighBand(wetUpL, wetUpR, n * this.osFactor);
      this.os.downsample(wetUpL, n, this.wetHighL, 0);
      this.os.downsample(wetUpR, n, this.wetHighR, 1);

      // Match IIR interpolation/decimation history so the delta is harmonic
      // content, not a phase-shifted copy of the original high band.
      const dryUpL = this.dryOs.upsample(this.highL, n, 0);
      const dryUpR = this.dryOs.upsample(this.highR, n, 1);
      this.dryOs.downsample(dryUpL, n, this.alignedHighL, 0);
      this.dryOs.downsample(dryUpR, n, this.alignedHighR, 1);
    } else {
      this.wetHighL.set(this.highL.subarray(0, n));
      this.wetHighR.set(this.highR.subarray(0, n));
      this.shapeHighBand(this.wetHighL, this.wetHighR, n);
      this.alignedHighL.set(this.highL.subarray(0, n));
      this.alignedHighR.set(this.highR.subarray(0, n));
    }

    let peakL = 0;
    let peakR = 0;
    for (let i = 0; i < n; i++) {
      if (this.amountRemaining > 0) {
        this.amount += this.amountStep;
        this.amountRemaining--;
        if (this.amountRemaining === 0) this.amount = this.amountTarget;
      }
      if (this.outputRemaining > 0) {
        this.output += this.outputStep;
        this.outputRemaining--;
        if (this.outputRemaining === 0) this.output = this.outputTarget;
      }

      const deltaL = this.wetHighL[i] - this.alignedHighL[i];
      const deltaR = this.wetHighR[i] - this.alignedHighR[i];
      L[i] = (this.originalL[i] + deltaL * this.amount) * this.output;
      R[i] = (this.originalR[i] + deltaR * this.amount) * this.output;
      peakL = Math.max(peakL, Math.abs(L[i]));
      peakR = Math.max(peakR, Math.abs(R[i]));
    }
    this.peakL = Math.max(peakL, this.peakL * 0.97);
    this.peakR = Math.max(peakR, this.peakR * 0.97);
  }

  reset(): void {
    this.os?.reset();
    this.dryOs?.reset();
    this.hpL.reset(); this.hpR.reset(); this.hpL2.reset(); this.hpR2.reset();
    this.configure(this.values.frequency ?? 6000, true);
    this.drive = this.driveTarget;
    this.comp = this.compTarget;
    this.nonlinearRemaining = 0;
    this.modeFrom = this.modeTo;
    this.modeBlend = 1;
    this.modeRemaining = 0;
    this.amount = this.amountTarget;
    this.amountRemaining = 0;
    this.output = this.outputTarget;
    this.outputRemaining = 0;
    this.peakL = 0;
    this.peakR = 0;
  }

  meter(): ProcessorMeter {
    return { peakL: this.peakL, peakR: this.peakR, gain: this.drive };
  }
}

export interface ExciterPreset {
  id: string;
  name: string;
  description: string;
  values: ParamValues;
}

export const exciterDefinition: ProcessorDefinition = {
  type: 'exciter',
  name: 'Exciter',
  shortName: 'EXCITE',
  category: 'saturation',
  description: 'High-band harmonic generation with a fourth-order crossover, stereo-isolated processing and 1x/2x/4x oversampling.',
  purpose: 'Adds harmonics above a tunable crossover without driving the low-frequency programme through the nonlinear stage.',
  params: [
    { key: 'frequency', label: 'Crossover', kind: 'float', min: 2000, max: 14000, step: 10, default: 6000, unit: 'Hz', scale: 'log' },
    { key: 'drive', label: 'Drive', kind: 'float', min: 0, max: 24, step: 0.1, default: 6, unit: 'dB' },
    { key: 'mode', label: 'Style', kind: 'enum', options: [...EXCITER_MODES], default: 1 },
    { key: 'mix', label: 'Amount', kind: 'float', min: 0, max: 100, step: 1, default: 30, unit: '%' },
    { key: 'output', label: 'Output', kind: 'float', min: -12, max: 12, step: 0.1, default: 0, unit: 'dB' },
    { key: 'oversample', label: 'Oversampling', kind: 'enum', options: ['Off', '2x', '4x'], default: 2, advanced: true },
  ],
  create: () => new Exciter(),
};

function exciterPreset(id: string, name: string, description: string, overrides: ParamValues): ExciterPreset {
  const values: ParamValues = {};
  for (const param of exciterDefinition.params) values[param.key] = param.default;
  return { id, name, description, values: { ...values, ...overrides } };
}

/** Editable harmonic starting points, not claims of hardware emulation. */
export const EXCITER_PRESETS: ExciterPreset[] = [
  exciterPreset('vocal-air', 'Vocal air', 'Adds a restrained high-band sheen above the vocal presence range.', {
    frequency: 7_500, drive: 4, mode: 1, mix: 20, output: -0.3, oversample: 2,
  }),
  exciterPreset('high-end-sparkle', 'High-end sparkle', 'Adds a little upper-band energy for dull sources; check for hiss and sibilance.', {
    frequency: 9_000, drive: 5, mode: 0, mix: 25, output: -0.5, oversample: 2,
  }),
  exciterPreset('drum-cymbal-detail', 'Drum and cymbal detail', 'A brighter harmonic layer for cymbals and percussion.', {
    frequency: 5_500, drive: 7, mode: 2, mix: 35, output: -0.8, oversample: 2,
  }),
  exciterPreset('synth-presence', 'Synth presence', 'A more pronounced high-band harmonic layer for sustained synth parts.', {
    frequency: 4_000, drive: 8, mode: 3, mix: 30, output: -1, oversample: 2,
  }),
  exciterPreset('subtle-mastering-air', 'Subtle mastering air', 'A very low-level parallel starting point. Level-match against bypass.', {
    frequency: 10_000, drive: 2, mode: 0, mix: 12, output: 0, oversample: 2,
  }),
];
