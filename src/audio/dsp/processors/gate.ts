import { DbBallistics, EnvelopeFollower } from '../envelope';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain, gainToDb } from '../util';

/**
 * Downward expander with independent L/R detectors and stereo linking.
 *
 * Below threshold, the output level follows the configured expansion ratio.
 * A soft knee makes the transition gradual; hold and release prevent rapid
 * flutter. At 100% link a shared envelope applies identical gain reduction to
 * both channels. At 0% each side follows its own detector and envelope.
 */
export class Gate implements AudioProcessor {
  readonly type = 'gate';
  readonly latency = 0;
  private sr = 48000;
  private values: ParamValues = {};
  private detectorL = new EnvelopeFollower(48000, 1, 80);
  private detectorR = new EnvelopeFollower(48000, 1, 80);
  private ballisticsL = new DbBallistics(48000, 1, 80, 10);
  private ballisticsR = new DbBallistics(48000, 1, 80, 10);
  private ballisticsLinked = new DbBallistics(48000, 1, 80, 10);
  private reductionL = 0;
  private reductionR = 0;
  private reduction = 0;
  private mix = 1;
  private mixTarget = 1;
  private mixStep = 0;
  private mixRemaining = 0;
  private outputGain = 1;
  private outputGainTarget = 1;
  private outputGainStep = 0;
  private outputGainRemaining = 0;

  prepare(sampleRate: number): void {
    this.sr = sampleRate;
    this.detectorL = new EnvelopeFollower(sampleRate, 1, 80, 'peak');
    this.detectorR = new EnvelopeFollower(sampleRate, 1, 80, 'peak');
    this.ballisticsL = new DbBallistics(sampleRate, 1, 80, 10);
    this.ballisticsR = new DbBallistics(sampleRate, 1, 80, 10);
    this.ballisticsLinked = new DbBallistics(sampleRate, 1, 80, 10);
    this.reset();
  }

  setValues(values: ParamValues): void {
    this.values = values;
    const attack = clamp(values.attack ?? 1, 0.1, 200);
    const release = clamp(values.release ?? 120, 10, 2000);
    const hold = clamp(values.hold ?? 30, 0, 500);
    this.ballisticsL.setTimes(attack, release, this.sr, hold);
    this.ballisticsR.setTimes(attack, release, this.sr, hold);
    this.ballisticsLinked.setTimes(attack, release, this.sr, hold);
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

  private expansionReduction(levelDb: number, threshold: number, ratio: number, range: number, knee: number): number {
    const below = threshold - levelDb;
    if (below <= 0) return 0;
    const slope = Math.max(0, ratio - 1);
    let reduction: number;
    if (knee > 0 && below < knee) {
      // Continuous quadratic soft knee: zero slope at threshold and the
      // full expansion slope at the far edge of the knee.
      reduction = slope * below * below / (2 * knee);
    } else {
      reduction = slope * (below - knee * 0.5);
    }
    return clamp(reduction, 0, range);
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    const threshold = clamp(this.values.threshold ?? -45, -80, 0);
    const range = clamp(this.values.range ?? 40, 0, 80);
    const ratio = clamp(this.values.ratio ?? 4, 1, 20);
    const knee = clamp(this.values.knee ?? 6, 0, 24);
    const link = clamp((this.values.link ?? 100) / 100, 0, 1);
    const mix = clamp((this.values.mix ?? 100) / 100, 0, 1);
    let maximumReduction = 0;

    for (let i = 0; i < n; i++) {
      const detectedL = this.detectorL.process(L[i]);
      const detectedR = this.detectorR.process(R[i]);
      const linkedLevel = Math.max(detectedL, detectedR);
      const keyL = detectedL + (linkedLevel - detectedL) * link;
      const keyR = detectedR + (linkedLevel - detectedR) * link;
      const targetL = this.expansionReduction(gainToDb(Math.max(keyL, 1e-8)), threshold, ratio, range, knee);
      const targetR = this.expansionReduction(gainToDb(Math.max(keyR, 1e-8)), threshold, ratio, range, knee);

      if (link >= 0.999) {
        const shared = this.ballisticsLinked.process(Math.max(targetL, targetR));
        this.reductionL = shared;
        this.reductionR = shared;
      } else {
        this.reductionL = this.ballisticsL.process(targetL);
        this.reductionR = this.ballisticsR.process(targetR);
      }

      const gainL = dbToGain(-this.reductionL);
      const gainR = dbToGain(-this.reductionR);
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
      L[i] = (L[i] * (1 - this.mix) + L[i] * gainL * this.mix) * this.outputGain;
      R[i] = (R[i] * (1 - this.mix) + R[i] * gainR * this.mix) * this.outputGain;
      maximumReduction = Math.max(maximumReduction, this.reductionL, this.reductionR);
    }
    this.reduction = maximumReduction;
  }

  reset(): void {
    this.detectorL.reset();
    this.detectorR.reset();
    this.ballisticsL.reset();
    this.ballisticsR.reset();
    this.ballisticsLinked.reset();
    this.reductionL = 0;
    this.reductionR = 0;
    this.reduction = 0;
    this.mix = this.mixTarget;
    this.mixRemaining = 0;
    this.outputGain = this.outputGainTarget;
    this.outputGainRemaining = 0;
  }

  meter(): ProcessorMeter {
    return { reduction: this.reduction, bands: [-this.reductionL, -this.reductionR] };
  }
}

export const gateDefinition: ProcessorDefinition = {
  type: 'gate',
  name: 'Gate / Expander',
  shortName: 'GATE',
  category: 'dynamics',
  description: 'Downward expander with soft knee, stereo linking, hold, range and independent channel detection.',
  purpose: 'Reduces bleed and noise below a threshold with predictable expansion ratios, smooth transitions and stereo-safe linking.',
  params: [
    { key: 'threshold', label: 'Threshold', kind: 'float', min: -80, max: 0, step: 0.5, default: -45, unit: 'dB', group: 'Detection' },
    { key: 'ratio', label: 'Ratio', kind: 'float', min: 1, max: 20, step: 0.1, default: 4, unit: ':1', group: 'Dynamics' },
    { key: 'knee', label: 'Knee', kind: 'float', min: 0, max: 24, step: 0.1, default: 6, unit: 'dB', group: 'Dynamics' },
    { key: 'range', label: 'Range', kind: 'float', min: 0, max: 80, step: 1, default: 40, unit: 'dB', group: 'Dynamics' },
    { key: 'attack', label: 'Attack', kind: 'float', min: 0.1, max: 200, step: 0.1, default: 1, unit: 'ms', group: 'Timing' },
    { key: 'hold', label: 'Hold', kind: 'float', min: 0, max: 500, step: 1, default: 30, unit: 'ms', group: 'Timing' },
    { key: 'release', label: 'Release', kind: 'float', min: 10, max: 2000, step: 1, default: 120, unit: 'ms', group: 'Timing' },
    { key: 'link', label: 'Stereo link', kind: 'float', min: 0, max: 100, step: 1, default: 100, unit: '%', advanced: true, group: 'Stereo' },
    { key: 'mix', label: 'Dry/wet', kind: 'float', min: 0, max: 100, step: 1, default: 100, unit: '%', group: 'Output' },
    { key: 'output', label: 'Output', kind: 'float', min: -18, max: 18, step: 0.1, default: 0, unit: 'dB', group: 'Output' },
  ],
  create: () => new Gate(),
};

export interface GatePreset {
  id: string;
  name: string;
  description: string;
  values: ParamValues;
}

function gatePreset(id: string, name: string, description: string, overrides: ParamValues): GatePreset {
  const values: ParamValues = {};
  for (const param of gateDefinition.params) values[param.key] = param.default;
  return { id, name, description, values: { ...values, ...overrides } };
}

export const GATE_PRESETS: GatePreset[] = [
  gatePreset('gentle-expander', 'Gentle expander', 'Subtle downward expansion to reduce background noise without closing the gate abruptly.', {
    threshold: -48, ratio: 1.7, knee: 12, range: 18, attack: 4, hold: 80, release: 240, link: 100,
  }),
  gatePreset('tight-drum-gate', 'Tight drum gate', 'A faster, firmer setting for reducing spill between drum hits.', {
    threshold: -38, ratio: 4, knee: 3, range: 35, attack: 0.5, hold: 35, release: 110, link: 100,
  }),
  gatePreset('vocal-noise-control', 'Vocal noise control', 'A moderate expander with a longer release to reduce room noise between phrases.', {
    threshold: -52, ratio: 1.8, knee: 10, range: 16, attack: 8, hold: 120, release: 320, link: 100,
  }),
  gatePreset('strong-cleanup', 'Strong cleanup', 'A stronger starting point for isolated sources with clear separation from bleed.', {
    threshold: -42, ratio: 6, knee: 2, range: 55, attack: 0.3, hold: 25, release: 90, link: 100,
  }),
];
