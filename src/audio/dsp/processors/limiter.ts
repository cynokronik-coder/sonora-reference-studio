import { TruePeakMeter, Oversampler } from '../oversample';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain, gainToDb } from '../util';

const TRUE_PEAK_SAFETY_GAIN = dbToGain(-0.5);

/** Monotonic sliding maximum over a fixed window (O(1) amortised). */
class SlidingMax {
  private values: Float32Array;
  private indices: Int32Array;
  private head = 0;
  private tail = 0;
  private count = 0;
  private position = 0;
  private readonly size: number;
  private readonly capacity: number;

  constructor(size: number) {
    this.size = Math.max(1, size);
    this.capacity = this.size + 2;
    this.values = new Float32Array(this.capacity);
    this.indices = new Int32Array(this.capacity);
  }

  reset(): void {
    this.head = this.tail = this.count = this.position = 0;
  }

  push(v: number, windowSize = this.size): number {
    // Pop smaller values from the back.
    while (this.count > 0) {
      const back = (this.tail - 1 + this.capacity) % this.capacity;
      if (this.values[back] <= v) {
        this.tail = back;
        this.count--;
      } else break;
    }
    this.values[this.tail] = v;
    this.indices[this.tail] = this.position;
    this.tail = (this.tail + 1) % this.capacity;
    this.count++;
    // Expire old entries.
    const activeWindow = Math.max(1, Math.min(this.size, Math.floor(windowSize)));
    while (this.count > 0 && this.indices[this.head] <= this.position - activeWindow) {
      this.head = (this.head + 1) % this.capacity;
      this.count--;
    }
    this.position++;
    return this.count > 0 ? this.values[this.head] : 0;
  }
}

/**
 * Look-ahead brickwall limiter.
 *
 * A sliding maximum looks ahead over the attack window and pre-computes the
 * required gain before the transient arrives, so no sample is clipped and no
 * distortion is introduced by the gain envelope. True-peak awareness is real:
 * each block is 4x oversampled and the effective ceiling is tightened by the
 * inter-sample peak ratio. This makes exported masters meet a dBTP ceiling
 * instead of only a sample-peak ceiling.
 */
export class Limiter implements AudioProcessor {
  readonly type = 'limiter';
  private sr = 48000;
  private values: ParamValues = {};
  private delayL = new Float32Array(0);
  private delayR = new Float32Array(0);
  private delayIndex = 0;
  private maxDelay = 1;
  private sliding = new SlidingMax(1);
  private env = 1;
  private tp: TruePeakMeter | null = null;
  private reduction = 0;
  private outPeakL = 0;
  private outPeakR = 0;
  private inputGain = 1;
  private inputGainTarget = 1;
  private inputGainStep = 0;
  private inputGainRemaining = 0;
  private outputGain = 1;
  private outputGainTarget = 1;
  private outputGainStep = 0;
  private outputGainRemaining = 0;
  private ceiling = dbToGain(-1);
  private ceilingTarget = dbToGain(-1);
  private ceilingStep = 0;
  private ceilingRemaining = 0;

  get latency(): number {
    return Math.round((clamp(this.values.lookahead ?? 4, 0, 10) / 1000) * this.sr);
  }

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = sampleRate;
    this.maxDelay = Math.ceil(sampleRate * 0.012) + 4;
    this.delayL = new Float32Array(this.maxDelay);
    this.delayR = new Float32Array(this.maxDelay);
    this.delayIndex = 0;
    this.sliding = new SlidingMax(Math.ceil(sampleRate * 0.012) + 1);
    this.tp = new TruePeakMeter(sampleRate, 2, maxBlock);
    this.reset();
  }

  setValues(values: ParamValues): void {
    this.values = values;
    const rampSamples = Math.max(1, Math.round(this.sr * 0.02));
    const nextInput = dbToGain(clamp(values.input ?? 0, -12, 24));
    if (nextInput !== this.inputGainTarget) {
      this.inputGainTarget = nextInput;
      this.inputGainRemaining = rampSamples;
      this.inputGainStep = (nextInput - this.inputGain) / rampSamples;
    }
    const nextOutput = dbToGain(clamp(values.output ?? 0, -12, 12));
    if (nextOutput !== this.outputGainTarget) {
      this.outputGainTarget = nextOutput;
      this.outputGainRemaining = rampSamples;
      this.outputGainStep = (nextOutput - this.outputGain) / rampSamples;
    }
    const nextCeiling = dbToGain(clamp(values.ceiling ?? -1, -12, 0));
    if (nextCeiling !== this.ceilingTarget) {
      this.ceilingTarget = nextCeiling;
      this.ceilingRemaining = rampSamples;
      this.ceilingStep = (nextCeiling - this.ceiling) / rampSamples;
    }
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    if (this.delayL.length === 0) this.prepare(this.sr, n);
    const lookahead = clamp(this.values.lookahead ?? 4, 0, 10);
    const lookSamples = Math.round((lookahead / 1000) * this.sr);
    const detectorWindow = lookSamples + 1;
    const releaseMs = clamp(this.values.release ?? 80, 10, 1000);
    const releaseCoeff = 1 - Math.exp(-1 / ((releaseMs / 1000) * this.sr));
    const truePeak = (this.values.truePeak ?? 1) > 0.5;

    // True-peak adjustment per block: tighten the ceiling when the block's
    // inter-sample peak exceeds its sample peak.
    // Advance the streaming true-peak meter on every block so disabling then
    // re-enabling true-peak mode never reuses stale interpolation history.
    const tpPeak = this.tp?.process(L, R, n) ?? 0;
    let samplePeak = 0;
    for (let i = 0; i < n; i++) {
      const sample = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      if (sample > samplePeak) samplePeak = sample;
    }
    const truePeakRatio = truePeak && samplePeak > 1e-6
      ? Math.max(1, tpPeak / samplePeak)
      : 1;

    let maxGr = 0;
    let peakL = 0;
    let peakR = 0;
    const windowLen = lookSamples;

    for (let i = 0; i < n; i++) {
      if (this.inputGainRemaining > 0) {
        this.inputGain += this.inputGainStep;
        this.inputGainRemaining--;
        if (this.inputGainRemaining === 0) this.inputGain = this.inputGainTarget;
      }
      if (this.outputGainRemaining > 0) {
        this.outputGain += this.outputGainStep;
        this.outputGainRemaining--;
        if (this.outputGainRemaining === 0) this.outputGain = this.outputGainTarget;
      }
      if (this.ceilingRemaining > 0) {
        this.ceiling += this.ceilingStep;
        this.ceilingRemaining--;
        if (this.ceilingRemaining === 0) this.ceiling = this.ceilingTarget;
      }

      const inL = L[i] * this.inputGain;
      const inR = R[i] * this.inputGain;
      this.delayL[this.delayIndex] = inL;
      this.delayR[this.delayIndex] = inR;

      const abs = Math.max(Math.abs(inL), Math.abs(inR));
      const windowMax = this.sliding.push(abs, detectorWindow);
      // Add a conservative half-dB safety margin when true-peak mode is
      // active. The IIR interpolator is block based while programme audio is
      // delayed by look-ahead; this guard absorbs small block-boundary and
      // reconstruction discrepancies rather than claiming sample-perfect
      // reconstruction from the estimate.
      const truePeakGuard = truePeak ? TRUE_PEAK_SAFETY_GAIN : 1;
      const effectiveCeiling = this.ceiling * truePeakGuard / truePeakRatio;
      const target = windowMax > effectiveCeiling ? effectiveCeiling / windowMax : 1;
      if (target < this.env) this.env = target;
      else this.env += (target - this.env) * releaseCoeff;

      let readIdx = this.delayIndex - windowLen;
      if (readIdx < 0) readIdx += this.maxDelay;
      const outL = this.delayL[readIdx] * this.env * this.outputGain;
      const outR = this.delayR[readIdx] * this.env * this.outputGain;
      L[i] = outL;
      R[i] = outR;
      const gr = -gainToDb(this.env);
      if (gr > maxGr) maxGr = gr;
      peakL = Math.max(peakL, Math.abs(outL));
      peakR = Math.max(peakR, Math.abs(outR));
      this.delayIndex = (this.delayIndex + 1) % this.maxDelay;
    }
    this.reduction = maxGr;
    this.outPeakL = peakL;
    this.outPeakR = peakR;
  }

  reset(): void {
    this.delayL.fill(0);
    this.delayR.fill(0);
    this.delayIndex = 0;
    this.sliding.reset();
    this.env = 1;
    this.tp?.reset();
    this.inputGain = this.inputGainTarget;
    this.inputGainRemaining = 0;
    this.outputGain = this.outputGainTarget;
    this.outputGainRemaining = 0;
    this.ceiling = this.ceilingTarget;
    this.ceilingRemaining = 0;
    this.reduction = 0;
    this.outPeakL = 0;
    this.outPeakR = 0;
  }

  meter(): ProcessorMeter {
    return { reduction: this.reduction, peakL: this.outPeakL, peakR: this.outPeakR };
  }
}

export const limiterDefinition: ProcessorDefinition = {
  type: 'limiter',
  name: 'Limiter',
  shortName: 'LIMIT',
  category: 'mastering',
  description: 'Look-ahead brickwall limiter with true-peak ceiling control and programme-dependent release.',
  purpose: 'Raises the final level safely. The loudest stage in the mastering chain and the last line of defence against clipping.',
  params: [
    { key: 'input', label: 'Input gain', kind: 'float', min: -12, max: 24, step: 0.1, default: 0, unit: 'dB' },
    { key: 'ceiling', label: 'Ceiling', kind: 'float', min: -12, max: 0, step: 0.1, default: -0.3, unit: 'dBTP' },
    { key: 'release', label: 'Release', kind: 'float', min: 10, max: 1000, step: 1, default: 80, unit: 'ms' },
    { key: 'lookahead', label: 'Lookahead', kind: 'float', min: 0, max: 10, step: 0.1, default: 4, unit: 'ms', advanced: true },
    { key: 'truePeak', label: 'True peak ceiling', kind: 'bool', default: 1, advanced: true },
    { key: 'output', label: 'Output', kind: 'float', min: -12, max: 12, step: 0.1, default: 0, unit: 'dB' },
  ],
  create: () => new Limiter(),
};

export interface LimiterPreset {
  id: string;
  name: string;
  description: string;
  values: ParamValues;
}

function limiterPreset(id: string, name: string, description: string, overrides: ParamValues): LimiterPreset {
  const values: ParamValues = {};
  for (const param of limiterDefinition.params) values[param.key] = param.default;
  return { id, name, description, values: { ...values, ...overrides } };
}

/** Conservative editable starting points; output trim remains post-ceiling. */
export const LIMITER_PRESETS: LimiterPreset[] = [
  limiterPreset('transparent-true-peak', 'Transparent true-peak', 'A restrained final safety limiter with moderate look-ahead and a conservative ceiling.', {
    input: 0, ceiling: -1, release: 140, lookahead: 5, truePeak: 1, output: 0,
  }),
  limiterPreset('punch-preservation', 'Punch preservation', 'A quicker release and shorter look-ahead for transient-rich material; monitor pumping and distortion.', {
    input: 1.5, ceiling: -1, release: 55, lookahead: 3, truePeak: 1, output: 0,
  }),
  limiterPreset('loudness-push', 'Loudness push', 'A louder starting point with more input drive; judge it at matched loudness and watch gain reduction.', {
    input: 4, ceiling: -1, release: 80, lookahead: 5, truePeak: 1, output: 0,
  }),
  limiterPreset('safe-delivery', 'Safe delivery', 'A lower ceiling and longer look-ahead for conservative peak management before export.', {
    input: 0, ceiling: -2, release: 180, lookahead: 10, truePeak: 1, output: 0,
  }),
  limiterPreset('low-latency-sample-peak', 'Low-latency sample peak', 'Disables true-peak estimation and look-ahead for a zero-look-ahead sample-peak limiter.', {
    input: 0, ceiling: -1, release: 80, lookahead: 0, truePeak: 0, output: 0,
  }),
];

export const CLIPPER_MODES = ['Soft', 'Hard', 'Tanh'] as const;

/**
 * Oversampled peak clipper with independent stereo processing and a matched
 * IIR dry reference for parallel blending. The soft curve is an odd cubic
 * that has unity slope at zero, reaches the ceiling and has zero slope at the
 * transition. The hard mode clamps exactly; tanh approaches the ceiling
 * asymptotically. Output trim is post clip and can therefore raise the output
 * above the internal clipping ceiling.
 */
export class Clipper implements AudioProcessor {
  readonly type = 'clipper';
  readonly latency = 0;
  private sr = 48000;
  private maxBlock = 512;
  private values: ParamValues = {};
  private osFactor: 1 | 2 | 4 = 1;
  private osPreparedBlock = 0;
  private osPreparedSampleRate = 0;
  private os: Oversampler | null = null;
  private dryOs: Oversampler | null = null;
  private dryL = new Float32Array(512);
  private dryR = new Float32Array(512);
  private wetL = new Float32Array(512);
  private wetR = new Float32Array(512);
  private alignedDryL = new Float32Array(512);
  private alignedDryR = new Float32Array(512);
  private drive = 1;
  private driveTarget = 1;
  private driveStep = 0;
  private ceiling = dbToGain(-0.3);
  private ceilingTarget = dbToGain(-0.3);
  private ceilingStep = 0;
  private nonlinearRemaining = 0;
  private modeFrom = 0;
  private modeTo = 0;
  private modeBlend = 1;
  private modeStep = 0;
  private modeRemaining = 0;
  private mix = 1;
  private mixTarget = 1;
  private mixStep = 0;
  private mixRemaining = 0;
  private output = 1;
  private outputTarget = 1;
  private outputStep = 0;
  private outputRemaining = 0;
  private meterReduction = 0;
  private reductionL = 0;
  private reductionR = 0;
  private peakL = 0;
  private peakR = 0;

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = sampleRate;
    this.maxBlock = Math.max(1, maxBlock);
    this.dryL = new Float32Array(this.maxBlock);
    this.dryR = new Float32Array(this.maxBlock);
    this.wetL = new Float32Array(this.maxBlock);
    this.wetR = new Float32Array(this.maxBlock);
    this.alignedDryL = new Float32Array(this.maxBlock);
    this.alignedDryR = new Float32Array(this.maxBlock);
    this.buildOversampler();
    this.reset();
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

  setValues(values: ParamValues): void {
    this.values = values;
    const nextDrive = dbToGain(clamp(values.drive ?? 3, 0, 18));
    const nextCeiling = dbToGain(clamp(values.ceiling ?? -0.3, -12, 0));
    if (nextDrive !== this.driveTarget || nextCeiling !== this.ceilingTarget) {
      this.driveTarget = nextDrive;
      this.ceilingTarget = nextCeiling;
      this.nonlinearRemaining = Math.max(1, Math.round(this.sr * 0.02 * this.osFactor));
      this.driveStep = (nextDrive - this.drive) / this.nonlinearRemaining;
      this.ceilingStep = (nextCeiling - this.ceiling) / this.nonlinearRemaining;
    }

    const nextMode = clamp(Math.round(values.mode ?? 0), 0, CLIPPER_MODES.length - 1);
    if (nextMode !== this.modeTo) {
      this.modeFrom = this.modeTo;
      this.modeTo = nextMode;
      this.modeBlend = 0;
      this.modeRemaining = Math.max(1, Math.round(this.sr * 0.01 * this.osFactor));
      this.modeStep = 1 / this.modeRemaining;
    }

    const nextMix = clamp((values.mix ?? 100) / 100, 0, 1);
    if (nextMix !== this.mixTarget) {
      this.mixTarget = nextMix;
      this.mixRemaining = Math.max(1, Math.round(this.sr * 0.02));
      this.mixStep = (nextMix - this.mix) / this.mixRemaining;
    }

    const nextOutput = dbToGain(clamp(values.output ?? 0, -12, 12));
    if (nextOutput !== this.outputTarget) {
      this.outputTarget = nextOutput;
      this.outputRemaining = Math.max(1, Math.round(this.sr * 0.02));
      this.outputStep = (nextOutput - this.output) / this.outputRemaining;
    }

    this.buildOversampler();
  }

  private advanceControls(): void {
    if (this.nonlinearRemaining > 0) {
      this.drive += this.driveStep;
      this.ceiling += this.ceilingStep;
      this.nonlinearRemaining--;
      if (this.nonlinearRemaining === 0) {
        this.drive = this.driveTarget;
        this.ceiling = this.ceilingTarget;
      }
    }
    if (this.modeRemaining > 0) {
      this.modeBlend = Math.min(1, this.modeBlend + this.modeStep);
      this.modeRemaining--;
      if (this.modeRemaining === 0) this.modeBlend = 1;
    }
  }

  private shape(sample: number, mode: number, ceiling: number): number {
    const normalized = sample / Math.max(ceiling, 1e-8);
    switch (mode) {
      case 1:
        return clamp(normalized, -1, 1) * ceiling;
      case 2:
        return Math.tanh(normalized) * ceiling;
      default: {
        const magnitude = Math.min(1, Math.abs(normalized));
        const soft = magnitude + magnitude * magnitude - magnitude * magnitude * magnitude;
        return Math.sign(normalized) * soft * ceiling;
      }
    }
  }

  private shapePair(L: Float32Array, R: Float32Array, count: number): void {
    for (let i = 0; i < count; i++) {
      this.advanceControls();
      const inputL = L[i] * this.drive;
      const inputR = R[i] * this.drive;
      const oldL = this.shape(inputL, this.modeFrom, this.ceiling);
      const oldR = this.shape(inputR, this.modeFrom, this.ceiling);
      const newL = this.shape(inputL, this.modeTo, this.ceiling);
      const newR = this.shape(inputR, this.modeTo, this.ceiling);
      L[i] = oldL + (newL - oldL) * this.modeBlend;
      R[i] = oldR + (newR - oldR) * this.modeBlend;
    }
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    if (n > this.maxBlock) {
      throw new RangeError(`Clipper block size ${n} exceeds prepared capacity ${this.maxBlock}`);
    }
    this.dryL.set(L.subarray(0, n));
    this.dryR.set(R.subarray(0, n));

    if (this.osFactor > 1 && this.os && this.dryOs) {
      const wetUpL = this.os.upsample(this.dryL, n, 0);
      const wetUpR = this.os.upsample(this.dryR, n, 1);
      this.shapePair(wetUpL, wetUpR, n * this.osFactor);
      this.os.downsample(wetUpL, n, this.wetL, 0);
      this.os.downsample(wetUpR, n, this.wetR, 1);

      // Keep the parallel reference at the exact same IIR phase/filter history.
      const dryUpL = this.dryOs.upsample(this.dryL, n, 0);
      const dryUpR = this.dryOs.upsample(this.dryR, n, 1);
      this.dryOs.downsample(dryUpL, n, this.alignedDryL, 0);
      this.dryOs.downsample(dryUpR, n, this.alignedDryR, 1);
    } else {
      this.wetL.set(this.dryL.subarray(0, n));
      this.wetR.set(this.dryR.subarray(0, n));
      this.shapePair(this.wetL, this.wetR, n);
      this.alignedDryL.set(this.dryL.subarray(0, n));
      this.alignedDryR.set(this.dryR.subarray(0, n));
    }

    let maxReductionL = 0;
    let maxReductionR = 0;
    let peakL = 0;
    let peakR = 0;
    for (let i = 0; i < n; i++) {
      if (this.mixRemaining > 0) {
        this.mix += this.mixStep;
        this.mixRemaining--;
        if (this.mixRemaining === 0) this.mix = this.mixTarget;
      }
      if (this.outputRemaining > 0) {
        this.output += this.outputStep;
        this.outputRemaining--;
        if (this.outputRemaining === 0) this.output = this.outputTarget;
      }

      const dryL = this.mix <= 0 ? this.dryL[i] : this.osFactor > 1 ? this.alignedDryL[i] : this.dryL[i];
      const dryR = this.mix <= 0 ? this.dryR[i] : this.osFactor > 1 ? this.alignedDryR[i] : this.dryR[i];
      const wetL = this.wetL[i];
      const wetR = this.wetR[i];
      const outL = (dryL * (1 - this.mix) + wetL * this.mix) * this.output;
      const outR = (dryR * (1 - this.mix) + wetR * this.mix) * this.output;

      const referenceL = this.osFactor > 1 ? this.alignedDryL[i] : this.dryL[i];
      const referenceR = this.osFactor > 1 ? this.alignedDryR[i] : this.dryR[i];
      const reductionL = Math.abs(referenceL) > 1e-9 && Math.abs(wetL) > 1e-9
        ? Math.max(0, 20 * Math.log10(Math.abs(referenceL * this.driveTarget) / Math.abs(wetL)))
        : 0;
      const reductionR = Math.abs(referenceR) > 1e-9 && Math.abs(wetR) > 1e-9
        ? Math.max(0, 20 * Math.log10(Math.abs(referenceR * this.driveTarget) / Math.abs(wetR)))
        : 0;
      maxReductionL = Math.max(maxReductionL, reductionL);
      maxReductionR = Math.max(maxReductionR, reductionR);
      peakL = Math.max(peakL, Math.abs(outL));
      peakR = Math.max(peakR, Math.abs(outR));
      L[i] = outL;
      R[i] = outR;
    }

    this.reductionL = maxReductionL;
    this.reductionR = maxReductionR;
    this.meterReduction = Math.max(maxReductionL, maxReductionR);
    this.peakL = Math.max(peakL, this.peakL * 0.97);
    this.peakR = Math.max(peakR, this.peakR * 0.97);
  }

  reset(): void {
    this.os?.reset();
    this.dryOs?.reset();
    this.drive = this.driveTarget;
    this.ceiling = this.ceilingTarget;
    this.nonlinearRemaining = 0;
    this.modeFrom = this.modeTo;
    this.modeBlend = 1;
    this.modeRemaining = 0;
    this.mix = this.mixTarget;
    this.mixRemaining = 0;
    this.output = this.outputTarget;
    this.outputRemaining = 0;
    this.meterReduction = 0;
    this.reductionL = 0;
    this.reductionR = 0;
    this.peakL = 0;
    this.peakR = 0;
  }

  meter(): ProcessorMeter {
    return {
      reduction: this.meterReduction,
      peakL: this.peakL,
      peakR: this.peakR,
      bands: [-this.reductionL, -this.reductionR],
    };
  }
}

export const clipperDefinition: ProcessorDefinition = {
  type: 'clipper',
  name: 'Clipper',
  shortName: 'CLIP',
  category: 'mastering',
  description: 'Soft, hard or tanh clip curves with adjustable internal ceiling, stereo metering and 1x/2x/4x oversampling.',
  purpose: 'Shaves transient peaks and adds harmonics before the limiter. Output trim is post clip and can raise the final level above the internal clipping ceiling.',
  params: [
    { key: 'mode', label: 'Mode', kind: 'enum', options: [...CLIPPER_MODES], default: 0 },
    { key: 'drive', label: 'Drive', kind: 'float', min: 0, max: 18, step: 0.1, default: 3, unit: 'dB' },
    { key: 'ceiling', label: 'Clip ceiling', kind: 'float', min: -12, max: 0, step: 0.1, default: -0.3, unit: 'dBFS' },
    { key: 'mix', label: 'Dry/wet', kind: 'float', min: 0, max: 100, step: 1, default: 100, unit: '%' },
    { key: 'output', label: 'Output', kind: 'float', min: -12, max: 12, step: 0.1, default: 0, unit: 'dB' },
    { key: 'oversample', label: 'Oversampling', kind: 'enum', options: ['Off', '2x', '4x'], default: 2, advanced: true },
  ],
  create: () => new Clipper(),
};

export interface ClipperPreset {
  id: string;
  name: string;
  description: string;
  values: ParamValues;
}

function clipperPreset(id: string, name: string, description: string, overrides: ParamValues): ClipperPreset {
  const values: ParamValues = {};
  for (const param of clipperDefinition.params) values[param.key] = param.default;
  return { id, name, description, values: { ...values, ...overrides } };
}

/** Editable peak-shaping starting points; always level-match against bypass. */
export const CLIPPER_PRESETS: ClipperPreset[] = [
  clipperPreset('soft-peak-rounding', 'Soft peak rounding', 'A restrained soft curve for shaving transient edges before final limiting.', {
    mode: 0, drive: 4, ceiling: -0.5, mix: 65, output: -0.5, oversample: 2,
  }),
  clipperPreset('drum-impact', 'Drum impact', 'A firmer clipper setting for drum transients; listen for added grit and cymbal distortion.', {
    mode: 1, drive: 7, ceiling: -1, mix: 60, output: -1.5, oversample: 2,
  }),
  clipperPreset('tanh-smoothness', 'Tanh smoothness', 'A rounded nonlinear curve for softer peak shaping and harmonic density.', {
    mode: 2, drive: 6, ceiling: -1, mix: 55, output: -1.2, oversample: 2,
  }),
  clipperPreset('mastering-peak-shave', 'Mastering peak shave', 'A low-drive parallel starting point for catching occasional peaks before the limiter.', {
    mode: 0, drive: 2.5, ceiling: -0.8, mix: 30, output: -0.3, oversample: 2,
  }),
  clipperPreset('hard-creative-clip', 'Hard creative clip', 'An assertive hard clip for deliberate sound design rather than transparent mastering.', {
    mode: 1, drive: 12, ceiling: -1.5, mix: 100, output: -3, oversample: 2,
  }),
];
