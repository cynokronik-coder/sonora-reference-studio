import { Biquad } from '../biquad';
import { DbBallistics } from '../envelope';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain, gainToDb } from '../util';

const CONTROL_SMOOTH_MS = 20;

/**
 * Fourth-order Linkwitz-Riley split-band de-esser. The high band drives
 * independent channel detectors; split-band mode reduces only that band.
 */
export class DeEsser implements AudioProcessor {
  readonly type = 'deesser';
  readonly latency = 0;
  private sr = 48000;
  private maxBlock = 512;
  private values: ParamValues = {};
  private hpL = new Biquad();
  private hpR = new Biquad();
  private hpL2 = new Biquad();
  private hpR2 = new Biquad();
  private lpL = new Biquad();
  private lpR = new Biquad();
  private lpL2 = new Biquad();
  private lpR2 = new Biquad();
  private ballisticsL = new DbBallistics(48000, 0.5, 60);
  private ballisticsR = new DbBallistics(48000, 0.5, 60);
  private ballisticsLinked = new DbBallistics(48000, 0.5, 60);
  private dryL = new Float32Array(512);
  private dryR = new Float32Array(512);
  private reduction = 0;
  private lastFreq = 0;
  private stereoLink = 1;
  private stereoLinkTarget = 1;
  private stereoLinkStep = 0;
  private stereoLinkRemaining = 0;
  private mix = 1;
  private mixTarget = 1;
  private mixStep = 0;
  private mixRemaining = 0;
  private outputGain = 1;
  private outputGainTarget = 1;
  private outputGainStep = 0;
  private outputGainRemaining = 0;
  private modeBlend = 0;
  private modeTarget = 0;
  private modeStep = 0;
  private modeRemaining = 0;

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = sampleRate;
    this.maxBlock = Math.max(1, Math.floor(maxBlock));
    this.dryL = new Float32Array(this.maxBlock);
    this.dryR = new Float32Array(this.maxBlock);
    this.ballisticsL = new DbBallistics(sampleRate, 0.5, 60);
    this.ballisticsR = new DbBallistics(sampleRate, 0.5, 60);
    this.ballisticsLinked = new DbBallistics(sampleRate, 0.5, 60);
    this.lastFreq = 0;
    this.reset();
    this.configure(6500, true);
  }

  setValues(values: ParamValues): void {
    this.values = values;
    const minFrequency = Math.min(2500, this.sr * 0.1);
    const maxFrequency = Math.min(12000, this.sr * 0.45);
    const frequency = clamp(values.frequency ?? 6500, minFrequency, maxFrequency);
    if (Math.abs(frequency - this.lastFreq) > 0.5) this.configure(frequency);

    const attack = clamp(values.attack ?? 0.5, 0.1, 20);
    const release = clamp(values.release ?? 60, 10, 500);
    this.ballisticsL.setTimes(attack, release, this.sr);
    this.ballisticsR.setTimes(attack, release, this.sr);
    this.ballisticsLinked.setTimes(attack, release, this.sr);

    const nextLink = clamp((values.link ?? 100) / 100, 0, 1);
    if (nextLink !== this.stereoLinkTarget) {
      this.stereoLinkTarget = nextLink;
      this.stereoLinkRemaining = Math.max(1, Math.round(this.sr * CONTROL_SMOOTH_MS / 1000));
      this.stereoLinkStep = (nextLink - this.stereoLink) / this.stereoLinkRemaining;
    }

    const nextMix = clamp((values.mix ?? 100) / 100, 0, 1);
    if (nextMix !== this.mixTarget) {
      this.mixTarget = nextMix;
      this.mixRemaining = Math.max(1, Math.round(this.sr * CONTROL_SMOOTH_MS / 1000));
      this.mixStep = (nextMix - this.mix) / this.mixRemaining;
    }

    const nextOutput = dbToGain(clamp(values.output ?? 0, -12, 12));
    if (nextOutput !== this.outputGainTarget) {
      this.outputGainTarget = nextOutput;
      this.outputGainRemaining = Math.max(1, Math.round(this.sr * CONTROL_SMOOTH_MS / 1000));
      this.outputGainStep = (nextOutput - this.outputGain) / this.outputGainRemaining;
    }

    const nextMode = (values.mode ?? 0) > 0.5 ? 1 : 0;
    if (nextMode !== this.modeTarget) {
      this.modeTarget = nextMode;
      this.modeRemaining = Math.max(1, Math.round(this.sr * CONTROL_SMOOTH_MS / 1000));
      this.modeStep = (nextMode - this.modeBlend) / this.modeRemaining;
    }
  }

  private configure(frequency: number, immediate = false): void {
    this.lastFreq = frequency;
    const samples = Math.max(1, Math.round(this.sr * CONTROL_SMOOTH_MS / 1000));
    this.configureFilter(this.hpL, 'highpass', frequency, samples, immediate);
    this.configureFilter(this.hpR, 'highpass', frequency, samples, immediate);
    this.configureFilter(this.hpL2, 'highpass', frequency, samples, immediate);
    this.configureFilter(this.hpR2, 'highpass', frequency, samples, immediate);
    this.configureFilter(this.lpL, 'lowpass', frequency, samples, immediate);
    this.configureFilter(this.lpR, 'lowpass', frequency, samples, immediate);
    this.configureFilter(this.lpL2, 'lowpass', frequency, samples, immediate);
    this.configureFilter(this.lpR2, 'lowpass', frequency, samples, immediate);
  }

  private configureFilter(
    filter: Biquad,
    type: 'highpass' | 'lowpass',
    frequency: number,
    samples: number,
    immediate: boolean,
  ): void {
    if (immediate) filter.configure(type, frequency, 0, 0.7071067811865476, this.sr);
    else filter.configureSmoothed(type, frequency, 0, 0.7071067811865476, this.sr, samples);
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    if (!Number.isInteger(n) || n < 0 || n > this.dryL.length || n > L.length || n > R.length) {
      throw new RangeError(`De-esser block length ${n} exceeds its prepared buffers`);
    }

    for (let i = 0; i < n; i++) {
      this.dryL[i] = L[i];
      this.dryR[i] = R[i];
    }

    const threshold = clamp(this.values.threshold ?? -28, -60, 0);
    const range = clamp(this.values.range ?? 8, 0, 18);
    const ratio = clamp(this.values.ratio ?? 5, 1, 12);
    let maxReduction = 0;

    for (let i = 0; i < n; i++) {
      const inputL = L[i];
      const inputR = R[i];
      const lowL = this.lpL2.process(this.lpL.process(inputL));
      const lowR = this.lpR2.process(this.lpR.process(inputR));
      const highL = this.hpL2.process(this.hpL.process(inputL));
      const highR = this.hpR2.process(this.hpR.process(inputR));

      if (this.stereoLinkRemaining > 0) {
        this.stereoLink += this.stereoLinkStep;
        this.stereoLinkRemaining--;
        if (this.stereoLinkRemaining === 0) this.stereoLink = this.stereoLinkTarget;
      }
      const detectedL = Math.abs(highL);
      const detectedR = Math.abs(highR);
      const linkedDetection = Math.max(detectedL, detectedR);
      const keyL = detectedL + (linkedDetection - detectedL) * this.stereoLink;
      const keyR = detectedR + (linkedDetection - detectedR) * this.stereoLink;
      const targetL = Math.min(range, Math.max(0, gainToDb(Math.max(keyL, 1e-7)) - threshold) * (1 - 1 / ratio));
      const targetR = Math.min(range, Math.max(0, gainToDb(Math.max(keyR, 1e-7)) - threshold) * (1 - 1 / ratio));
      const independentL = this.ballisticsL.process(targetL);
      const independentR = this.ballisticsR.process(targetR);
      const linked = this.ballisticsLinked.process(Math.max(targetL, targetR));
      const reductionL = this.stereoLink >= 0.999 ? linked : independentL;
      const reductionR = this.stereoLink >= 0.999 ? linked : independentR;
      maxReduction = Math.max(maxReduction, reductionL, reductionR);

      const gainL = dbToGain(-reductionL);
      const gainR = dbToGain(-reductionR);
      const splitL = lowL + highL * gainL;
      const splitR = lowR + highR * gainR;
      const wideL = (lowL + highL) * gainL;
      const wideR = (lowR + highR) * gainR;

      if (this.modeRemaining > 0) {
        this.modeBlend += this.modeStep;
        this.modeRemaining--;
        if (this.modeRemaining === 0) this.modeBlend = this.modeTarget;
      }
      if (this.mixRemaining > 0) {
        this.mix += this.mixStep;
        this.mixRemaining--;
        if (this.mixRemaining === 0) this.mix = this.mixTarget;
      }
      if (this.outputGainRemaining > 0) {
        this.outputGain += this.outputGainStep;
        this.outputGainRemaining--;
        if (this.outputGainRemaining === 0) this.outputGain = this.outputGainTarget;
      }

      const wetL = splitL + (wideL - splitL) * this.modeBlend;
      const wetR = splitR + (wideR - splitR) * this.modeBlend;
      L[i] = (this.dryL[i] * (1 - this.mix) + wetL * this.mix) * this.outputGain;
      R[i] = (this.dryR[i] * (1 - this.mix) + wetR * this.mix) * this.outputGain;
    }

    this.reduction = maxReduction;
  }

  reset(): void {
    this.hpL.reset(); this.hpR.reset(); this.hpL2.reset(); this.hpR2.reset();
    this.lpL.reset(); this.lpR.reset(); this.lpL2.reset(); this.lpR2.reset();
    this.ballisticsL.reset();
    this.ballisticsR.reset();
    this.ballisticsLinked.reset();
    this.reduction = 0;
    this.mix = this.mixTarget;
    this.mixRemaining = 0;
    this.outputGain = this.outputGainTarget;
    this.outputGainRemaining = 0;
    this.modeBlend = this.modeTarget;
    this.modeRemaining = 0;
    this.stereoLink = this.stereoLinkTarget;
    this.stereoLinkRemaining = 0;
    if (this.lastFreq > 0) this.configure(this.lastFreq, true);
  }

  meter(): ProcessorMeter {
    return { reduction: this.reduction };
  }
}

export const deEsserDefinition: ProcessorDefinition = {
  type: 'deesser',
  name: 'De-esser',
  shortName: 'DE-ESS',
  category: 'vocal',
  description: 'Fourth-order split-band sibilance control with wideband mode, stereo linking and true dry/wet blending.',
  purpose: 'Reduces sharp sibilant energy only when it becomes prominent, with an optional wideband mode for very sibilant material.',
  params: [
    { key: 'frequency', label: 'Crossover frequency', kind: 'float', min: 2500, max: 12000, step: 10, default: 6500, unit: 'Hz', scale: 'log' },
    { key: 'threshold', label: 'Threshold', kind: 'float', min: -60, max: 0, step: 0.5, default: -28, unit: 'dB' },
    { key: 'range', label: 'Max reduction', kind: 'float', min: 0, max: 18, step: 0.1, default: 8, unit: 'dB' },
    { key: 'ratio', label: 'Ratio', kind: 'float', min: 1, max: 12, step: 0.1, default: 5, unit: ':1', advanced: true, group: 'Detection' },
    { key: 'attack', label: 'Attack', kind: 'float', min: 0.1, max: 20, step: 0.1, default: 0.5, unit: 'ms', advanced: true, group: 'Detection' },
    { key: 'release', label: 'Release', kind: 'float', min: 10, max: 500, step: 1, default: 60, unit: 'ms', advanced: true, group: 'Detection' },
    { key: 'link', label: 'Stereo link', kind: 'float', min: 0, max: 100, step: 1, default: 100, unit: '%', advanced: true, group: 'Detection' },
    { key: 'mode', label: 'Mode', kind: 'enum', options: ['Split band', 'Wideband'], default: 0, group: 'Output' },
    { key: 'mix', label: 'Dry/wet', kind: 'float', min: 0, max: 100, step: 1, default: 100, unit: '%', group: 'Output' },
    { key: 'output', label: 'Output', kind: 'float', min: -12, max: 12, step: 0.1, default: 0, unit: 'dB', group: 'Output' },
  ],
  create: () => new DeEsser(),
};

export interface DeEsserPreset {
  id: string;
  name: string;
  description: string;
  values: ParamValues;
}

function deEsserPreset(id: string, name: string, description: string, overrides: ParamValues): DeEsserPreset {
  const values: ParamValues = {};
  for (const param of deEsserDefinition.params) values[param.key] = param.default;
  return { id, name, description, values: { ...values, ...overrides } };
}

export const DEESSER_PRESETS: DeEsserPreset[] = [
  deEsserPreset('gentle-sibilance', 'Gentle sibilance', 'Light split-band control that keeps the overall vocal tone natural.', {
    frequency: 7000, threshold: -24, range: 3, ratio: 2.5, attack: 0.5, release: 80, link: 100, mode: 0, mix: 100,
  }),
  deEsserPreset('bright-vocal', 'Bright vocal', 'Catches sharper consonants while retaining air and presence.', {
    frequency: 6800, threshold: -30, range: 5, ratio: 4, attack: 0.3, release: 65, link: 100, mode: 0, mix: 100,
  }),
  deEsserPreset('strong-sibilance', 'Strong sibilance', 'A firmer starting point for recordings with persistent sharp sibilants.', {
    frequency: 6200, threshold: -34, range: 8, ratio: 6, attack: 0.2, release: 55, link: 100, mode: 0, mix: 85,
  }),
  deEsserPreset('wideband-control', 'Wideband control', 'Applies the detector envelope to the entire signal for especially intrusive sibilance.', {
    frequency: 7200, threshold: -32, range: 4, ratio: 4, attack: 0.5, release: 90, link: 100, mode: 1, mix: 100,
  }),
];
