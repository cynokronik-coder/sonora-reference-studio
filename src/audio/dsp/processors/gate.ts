import { DbBallistics, EnvelopeFollower } from '../envelope';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain, gainToDb } from '../util';

/** Gate / downward expander with hold, range and ratio. */
export class Gate implements AudioProcessor {
  readonly type = 'gate';
  readonly latency = 0;
  private sr = 48000;
  private values: ParamValues = {};
  private detectorL = new EnvelopeFollower(48000, 1, 80, 'peak');
  private detectorR = new EnvelopeFollower(48000, 1, 80, 'peak');
  private ballistics = new DbBallistics(48000, 1, 80, 10);
  private reduction = 0;

  prepare(sampleRate: number): void {
    this.sr = sampleRate;
    this.detectorL = new EnvelopeFollower(sampleRate, 1, 80);
    this.detectorR = new EnvelopeFollower(sampleRate, 1, 80);
    this.ballistics = new DbBallistics(sampleRate, 1, 80, 10);
  }

  setValues(values: ParamValues): void {
    this.values = values;
    this.ballistics.setTimes(
      clamp(values.attack ?? 1, 0.1, 200),
      clamp(values.release ?? 120, 10, 2000),
      this.sr,
      clamp(values.hold ?? 30, 0, 500),
    );
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    const threshold = this.values.threshold ?? -45;
    const range = Math.max(0, this.values.range ?? 40);
    const ratio = Math.max(1, this.values.ratio ?? 4);
    const mix = clamp((this.values.mix ?? 100) / 100, 0, 1);
    let maxReduction = 0;

    for (let i = 0; i < n; i++) {
      const detect = Math.max(this.detectorL.process(L[i]), this.detectorR.process(R[i]));
      const levelDb = gainToDb(Math.max(detect, 1e-8));
      const below = threshold - levelDb;
      let target = 0;
      if (below > 0) target = Math.min(range, below * (ratio - 1) / ratio + below * 0.15);
      const reduction = this.ballistics.process(target);
      if (reduction > maxReduction) maxReduction = reduction;
      const gain = dbToGain(-reduction);
      L[i] = L[i] * (1 - mix) + L[i] * gain * mix;
      R[i] = R[i] * (1 - mix) + R[i] * gain * mix;
    }
    this.reduction = maxReduction;
  }

  reset(): void {
    this.detectorL.reset();
    this.detectorR.reset();
    this.ballistics.reset();
    this.reduction = 0;
  }

  meter(): ProcessorMeter {
    return { reduction: this.reduction };
  }
}

export const gateDefinition: ProcessorDefinition = {
  type: 'gate',
  name: 'Gate / Expander',
  shortName: 'GATE',
  category: 'dynamics',
  description: 'Downward expander with adjustable ratio, hold, range and dry/wet.',
  purpose: 'Removes bleed and noise between phrases, or tightens loosely played drums.',
  params: [
    { key: 'threshold', label: 'Threshold', kind: 'float', min: -80, max: 0, step: 0.5, default: -45, unit: 'dB' },
    { key: 'ratio', label: 'Ratio', kind: 'float', min: 1, max: 20, step: 0.1, default: 4, unit: ':1' },
    { key: 'range', label: 'Range', kind: 'float', min: 0, max: 80, step: 1, default: 40, unit: 'dB' },
    { key: 'attack', label: 'Attack', kind: 'float', min: 0.1, max: 200, step: 0.1, default: 1, unit: 'ms' },
    { key: 'hold', label: 'Hold', kind: 'float', min: 0, max: 500, step: 1, default: 30, unit: 'ms' },
    { key: 'release', label: 'Release', kind: 'float', min: 10, max: 2000, step: 1, default: 120, unit: 'ms' },
    { key: 'mix', label: 'Dry/wet', kind: 'float', min: 0, max: 100, step: 1, default: 100, unit: '%' },
  ],
  create: () => new Gate(),
};
