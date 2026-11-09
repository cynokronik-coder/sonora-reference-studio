import { Biquad } from '../biquad';
import { DbBallistics } from '../envelope';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain, gainToDb } from '../util';

/**
 * Fourth-order Linkwitz-Riley split-band de-esser.
 *
 * Left/right filters are independent. Their high-pass outputs are measured
 * after frequency selection, then detector envelopes are either independent
 * (dual-mono) or shared according to Stereo Link. Split-band mode attenuates
 * only the high band; wideband mode applies the same envelope to the complete
 * recombined signal. A preserved dry copy provides a genuine parallel mix.
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
  private reductionL = 0;
  private reductionR = 0;
  private lastFreq = 0;
  private mix = 1;
  private mixTarget = 1;
  private mixStep = 0;
  private mixRemaining = 0;
  private outputGain = 1;
  private outputGainTarget = 1;
  private outputGainStep = 0;
  private outputGainRemaining = 0;

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = sampleRate;
    this.maxBlock = Math.max(1, maxBlock);
    this.dryL = new Float32Array(this.maxBlock);
    this.dryR = new Float32Array(this.maxBlock);
    this.ballisticsL = new DbBallistics(sampleRate, 0.5, 60);
    this.ballisticsR = new DbBallistics(sampleRate, 0.5, 60);
    this.ballisticsLinked = new DbBallistics(sampleRate, 0.5, 60);
    this.configure(clamp(6500, 2500, sampleRate * 0.45));
    this.mix = this.mixTarget;
    this.outputGain = this.outputGainTarget;
    this.reset();
  }

  setValues(values: ParamValues): void {
    this.values = values;
    const frequency = clamp(values.frequency ?? 6500, 2500, this.sr * 0.45);
    if (Math.abs(frequency - this.lastFreq) > 0.5) this.configure(frequency);

    const attack = clamp(values.attack ?? 0.5, 0.1, 20);
    const release = clamp(values.release ?? 60, 10, 500);
    this.ballisticsL.setTimes(attack, release, this.sr);
    this.ballisticsR.setTimes(attack, release, this.sr);
    this.ballisticsLinked.setTimes(attack, release, this.sr);

    const nextMix = clamp((values.mix ?? 100) / 100, 0, 1);
    if (nextMix !== this.mixTarget) {
      this.mixTarget = nextMix;
      this.mixRemaining = Math.max(1, Math.round(this.sr * 0.02));
      this.mixStep = (nextMix - this.mix) / this.mixRemaining;
    }

    const nextOutput = dbToGain(clamp(values.output ?? 0, -12, 12));
    if (nextOutput !== this.outputGainTarget) {
      this.outputGainTarget = nextOutput;
      this.outputGainRemaining = Math.max(1, Math.round(this.sr * 0.02));
      this.outputGainStep = (nextOutput - this.outputGain) / this.outputGainRemaining;
    }
  }

  private configure(frequency: number): void {
    this.lastFreq = frequency;
    const samples = Math.max(1, Math.round(this.sr * 0.02));
    for (const filter of [this.hpL, this.hpR, this.hpL2, this.hpR2]) {
      filter.setSmoothed(
        // Use the second-order Butterworth sections in cascade for an LR4 split.
        this.highpassCoefficients(frequency),
        samples,
      );
    }
    for (const filter of [this.lpL, this.lpR, this.lpL2, this.lpR2]) {
      filter.setSmoothed(this.lowpassCoefficients(frequency), samples);
    }
  }

  private highpassCoefficients(frequency: number) {
    return this.designFilter('highpass', frequency);
  }

  private lowpassCoefficients(frequency: number) {
    return this.designFilter('lowpass', frequency);
  }

  private designFilter(type: 'highpass' | 'lowpass', frequency: number) {
    // Kept local to avoid shared filter state; coefficients are the same for
    // both channels but each Biquad owns its own delay history.
    const w0 = (2 * Math.PI * frequency) / this.sr;
    const cosw = Math.cos(w0);
    const sinw = Math.sin(w0);
    const alpha = sinw / (2 * 0.7071067811865476);
    let b0: number, b1: number, b2: number;
    if (type === 'lowpass') {
      b0 = (1 - cosw) / 2;
      b1 = 1 - cosw;
      b2 = (1 - cosw) / 2;
    } else {
      b0 = (1 + cosw) / 2;
      b1 = -(1 + cosw);
      b2 = (1 + cosw) / 2;
    }
    const a0 = 1 + alpha;
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cosw) / a0, a2: (1 - alpha) / a0 };
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    if (n > this.dryL.length) {
      this.dryL = new Float32Array(n);
      this.dryR = new Float32Array(n);
      this.maxBlock = n;
    }
    this.dryL.set(L.subarray(0, n));
    this.dryR.set(R.subarray(0, n));

    const threshold = clamp(this.values.threshold ?? -28, -60, 0);
    const range = clamp(this.values.range ?? 8, 0, 18);
    const ratio = clamp(this.values.ratio ?? 4, 1, 12);
    const wideband = (this.values.mode ?? 0) > 0.5;
    const link = clamp((this.values.link ?? 100) / 100, 0, 1);
    let maxReduction = 0;

    for (let i = 0; i < n; i++) {
      const inputL = L[i];
      const inputR = R[i];
      const lowL = this.lpL2.process(this.lpL.process(inputL));
      const lowR = this.lpR2.process(this.lpR.process(inputR));
      const highL = this.hpL2.process(this.hpL.process(inputL));
      const highR = this.hpR2.process(this.hpR.process(inputR));

      const detectL = Math.abs(highL);
      const detectR = Math.abs(highR);
      const linkedDetect = Math.max(detectL, detectR);
      const keyL = detectL + (linkedDetect - detectL) * link;
      const keyR = detectR + (linkedDetect - detectR) * link;
      const targetL = Math.min(range, Math.max(0, gainToDb(Math.max(keyL, 1e-7)) - threshold) * (1 - 1 / ratio));
      const targetR = Math.min(range, Math.max(0, gainToDb(Math.max(keyR, 1e-7)) - threshold) * (1 - 1 / ratio));

      if (link >= 0.999) {
        const shared = this.ballisticsLinked.process(Math.max(targetL, targetR));
        this.reductionL = shared;
        this.reductionR = shared;
      } else {
        this.reductionL = this.ballisticsL.process(targetL);
        this.reductionR = this.ballisticsR.process(targetR);
      }
      maxReduction = Math.max(maxReduction, this.reductionL, this.reductionR);

      const gainL = dbToGain(-this.reductionL);
      const gainR = dbToGain(-this.reductionR);
      const wetL = wideband ? (lowL + highL) * gainL : lowL + highL * gainL;
      const wetR = wideband ? (lowR + highR) * gainR : lowR + highR * gainR;

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
    this.reductionL = 0;
    this.reductionR = 0;
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
    { key: 'ratio', label: 'Ratio', kind: 'float', min: 1, max: 12, step: 0.1, default: 4, unit: ':1', advanced: true, group: 'Detection' },
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
    frequency: 7_000, threshold: -24, range: 3, ratio: 2.5, attack: 0.5, release: 80, link: 100, mode: 0, mix: 100,
  }),
  deEsserPreset('bright-vocal', 'Bright vocal', 'Catches sharper consonants while retaining air and presence.', {
    frequency: 6_800, threshold: -30, range: 5, ratio: 4, attack: 0.3, release: 65, link: 100, mode: 0, mix: 100,
  }),
  deEsserPreset('strong-sibilance', 'Strong sibilance', 'A firmer starting point for recordings with persistent sharp sibilants.', {
    frequency: 6_200, threshold: -34, range: 8, ratio: 6, attack: 0.2, release: 55, link: 100, mode: 0, mix: 85,
  }),
  deEsserPreset('wideband-control', 'Wideband control', 'Applies the detector envelope to the entire signal for especially intrusive sibilance.', {
    frequency: 7_200, threshold: -32, range: 4, ratio: 4, attack: 0.5, release: 90, link: 100, mode: 1, mix: 100,
  }),
];
