import { EnvelopeFollower } from '../envelope';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain } from '../util';

/**
 * Envelope-differential transient shaper with independent L/R envelopes.
 *
 * Fast-minus-slow energy estimates transient emphasis; the slow envelope
 * estimates body. Attack and sustain are expressed as bounded dB adjustments,
 * not unconstrained linear multipliers, so negative settings never invert the
 * waveform. Stereo Link blends each channel's envelope features towards the
 * stronger side, and a shared linked gain preserves stereo image at 100%.
 */
export class TransientShaper implements AudioProcessor {
  readonly type = 'transient';
  readonly latency = 0;
  private sr = 48000;
  private values: ParamValues = {};
  private fastL = new EnvelopeFollower(48000, 0.4, 30);
  private fastR = new EnvelopeFollower(48000, 0.4, 30);
  private slowL = new EnvelopeFollower(48000, 25, 180);
  private slowR = new EnvelopeFollower(48000, 25, 180);
  private gainL = 1;
  private gainR = 1;
  private mix = 1;
  private mixTarget = 1;
  private mixStep = 0;
  private mixRemaining = 0;
  private outputGain = 1;
  private outputGainTarget = 1;
  private outputGainStep = 0;
  private outputGainRemaining = 0;
  private peakL = 0;
  private peakR = 0;
  private maxGain = 1;

  prepare(sampleRate: number): void {
    this.sr = sampleRate;
    this.fastL = new EnvelopeFollower(sampleRate, 0.4, 30);
    this.fastR = new EnvelopeFollower(sampleRate, 0.4, 30);
    this.slowL = new EnvelopeFollower(sampleRate, 25, 180);
    this.slowR = new EnvelopeFollower(sampleRate, 25, 180);
    this.reset();
  }

  setValues(values: ParamValues): void {
    this.values = values;
    const nextMix = clamp((values.mix ?? 100) / 100, 0, 1);
    if (nextMix !== this.mixTarget) {
      this.mixTarget = nextMix;
      this.mixRemaining = Math.max(1, Math.round(this.sr * 0.02));
      this.mixStep = (nextMix - this.mix) / this.mixRemaining;
    }
    const nextOutput = dbToGain(clamp(values.output ?? 0, -18, 18));
    if (nextOutput !== this.outputGainTarget) {
      this.outputGainTarget = nextOutput;
      this.outputGainRemaining = Math.max(1, Math.round(this.sr * 0.02));
      this.outputGainStep = (nextOutput - this.outputGain) / this.outputGainRemaining;
    }
  }

  private transientWeight(fast: number, slow: number, sensitivity: number): number {
    const residual = Math.max(0, fast - slow * (1 - sensitivity * 0.3));
    return clamp(residual / Math.max(fast, 1e-6), 0, 1);
  }

  private bodyWeight(slow: number): number {
    return clamp(slow / (slow + 0.02), 0, 1);
  }

  private gainFor(fast: number, slow: number, attackDb: number, sustainDb: number, sensitivity: number): number {
    const transient = this.transientWeight(fast, slow, sensitivity);
    const body = this.bodyWeight(slow);
    const totalDb = attackDb * transient + sustainDb * body;
    // Explicit bounded gain range prevents polarity inversion and runaway boosts.
    return dbToGain(clamp(totalDb, -18, 18));
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    const attackDb = clamp(this.values.attack ?? 0, -100, 100) * 0.12;
    const sustainDb = clamp(this.values.sustain ?? 0, -100, 100) * 0.06;
    const sensitivity = clamp((this.values.sensitivity ?? 50) / 100, 0.05, 1);
    const link = clamp((this.values.link ?? 100) / 100, 0, 1);
    const smoothing = 1 - Math.exp(-1 / (0.003 * this.sr));
    let peakL = 0;
    let peakR = 0;
    let maxGain = 1;

    for (let i = 0; i < n; i++) {
      const inputL = L[i];
      const inputR = R[i];
      const fastL = this.fastL.process(inputL);
      const fastR = this.fastR.process(inputR);
      const slowL = this.slowL.process(inputL);
      const slowR = this.slowR.process(inputR);

      const linkedFast = Math.max(fastL, fastR);
      const linkedSlow = Math.max(slowL, slowR);
      const effectiveFastL = fastL + (linkedFast - fastL) * link;
      const effectiveFastR = fastR + (linkedFast - fastR) * link;
      const effectiveSlowL = slowL + (linkedSlow - slowL) * link;
      const effectiveSlowR = slowR + (linkedSlow - slowR) * link;

      const targetL = this.gainFor(effectiveFastL, effectiveSlowL, attackDb, sustainDb, sensitivity);
      const targetR = this.gainFor(effectiveFastR, effectiveSlowR, attackDb, sustainDb, sensitivity);
      this.gainL += (targetL - this.gainL) * smoothing;
      this.gainR += (targetR - this.gainR) * smoothing;
      if (link >= 0.999) this.gainR = this.gainL;

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

      const wetL = inputL * this.gainL * this.outputGain;
      const wetR = inputR * this.gainR * this.outputGain;
      L[i] = inputL * (1 - this.mix) + wetL * this.mix;
      R[i] = inputR * (1 - this.mix) + wetR * this.mix;
      peakL = Math.max(peakL, Math.abs(L[i]));
      peakR = Math.max(peakR, Math.abs(R[i]));
      maxGain = Math.max(maxGain, this.gainL, this.gainR);
    }

    this.peakL = Math.max(peakL, this.peakL * 0.97);
    this.peakR = Math.max(peakR, this.peakR * 0.97);
    this.maxGain = maxGain;
  }

  reset(): void {
    this.fastL.reset(); this.fastR.reset();
    this.slowL.reset(); this.slowR.reset();
    this.gainL = 1;
    this.gainR = 1;
    this.mix = this.mixTarget;
    this.mixRemaining = 0;
    this.outputGain = this.outputGainTarget;
    this.outputGainRemaining = 0;
    this.peakL = 0;
    this.peakR = 0;
    this.maxGain = 1;
  }

  meter(): ProcessorMeter {
    return { peakL: this.peakL, peakR: this.peakR, gain: this.maxGain };
  }
}

export const transientDefinition: ProcessorDefinition = {
  type: 'transient',
  name: 'Transient Shaper',
  shortName: 'TRANSIENT',
  category: 'dynamics',
  description: 'Envelope-differential attack and sustain shaping with independent stereo detection and adjustable linking.',
  purpose: 'Adds punch or softens transients while controlling body independently, without polarity inversion or unbounded gain.',
  params: [
    { key: 'attack', label: 'Attack', kind: 'float', min: -100, max: 100, step: 1, default: 0, unit: '%' },
    { key: 'sustain', label: 'Sustain', kind: 'float', min: -100, max: 100, step: 1, default: 0, unit: '%' },
    { key: 'sensitivity', label: 'Sensitivity', kind: 'float', min: 0, max: 100, step: 1, default: 50, unit: '%', advanced: true },
    { key: 'link', label: 'Stereo link', kind: 'float', min: 0, max: 100, step: 1, default: 100, unit: '%', advanced: true },
    { key: 'mix', label: 'Dry/wet', kind: 'float', min: 0, max: 100, step: 1, default: 100, unit: '%' },
    { key: 'output', label: 'Output', kind: 'float', min: -18, max: 18, step: 0.1, default: 0, unit: 'dB' },
  ],
  create: () => new TransientShaper(),
};

export interface TransientPreset {
  id: string;
  name: string;
  description: string;
  values: ParamValues;
}

function transientPreset(id: string, name: string, description: string, overrides: ParamValues): TransientPreset {
  const values: ParamValues = {};
  for (const param of transientDefinition.params) values[param.key] = param.default;
  return { id, name, description, values: { ...values, ...overrides } };
}

export const TRANSIENT_PRESETS: TransientPreset[] = [
  transientPreset('punch-and-attack', 'Punch and attack', 'Adds controlled transient emphasis while leaving sustained body close to its original level.', {
    attack: 45, sustain: -5, sensitivity: 60, link: 100, mix: 100,
  }),
  transientPreset('soften-transients', 'Soften transients', 'Reduces the initial edge of sharp hits without hard gating or clipping.', {
    attack: -45, sustain: 8, sensitivity: 55, link: 100, mix: 85,
  }),
  transientPreset('longer-sustain', 'Longer sustain', 'Brings up the body of notes and drum tails with restrained attack emphasis.', {
    attack: -5, sustain: 40, sensitivity: 50, link: 100, mix: 75,
  }),
  transientPreset('drum-snap', 'Drum snap', 'A stronger transient starting point for close-miked drums and percussion.', {
    attack: 65, sustain: -12, sensitivity: 70, link: 100, mix: 100,
  }),
  transientPreset('gentle-dynamics', 'Gentle dynamics', 'A subtle parallel starting point for small changes in punch and body.', {
    attack: 18, sustain: 10, sensitivity: 45, link: 100, mix: 60,
  }),
];
