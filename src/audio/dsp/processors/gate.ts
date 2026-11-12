import { DbBallistics, EnvelopeFollower } from '../envelope';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain, gainToDb } from '../util';

function finiteValue(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

export function expansionReductionDb(levelDb: number, thresholdDb: number, ratio: number, kneeDb: number): number {
  const belowThreshold = thresholdDb - levelDb;
  if (belowThreshold <= 0) return 0;
  const slope = Math.max(0, ratio - 1);
  const knee = Math.max(0, kneeDb);
  if (knee > 0 && belowThreshold < knee) {
    return (slope * belowThreshold * belowThreshold) / (2 * knee);
  }
  return slope * (belowThreshold - knee / 2);
}

export function legacyExpansionReductionDb(levelDb: number, thresholdDb: number, ratio: number): number {
  const belowThreshold = thresholdDb - levelDb;
  if (belowThreshold <= 0) return 0;
  return belowThreshold * ((ratio - 1) / ratio + 0.15);
}

/** Gate / downward expander with per-channel detection, linking and gain. */
export class Gate implements AudioProcessor {
  readonly type = 'gate';
  readonly latency = 0;
  private sr = 48000;
  private values: ParamValues = {};
  private detectorL = new EnvelopeFollower(48000, 1, 80);
  private detectorR = new EnvelopeFollower(48000, 1, 80);
  private ballisticsL = new DbBallistics(48000, 1, 80, 30);
  private ballisticsR = new DbBallistics(48000, 1, 80, 30);
  private mix = 1;
  private outputGain = 1;
  private stereoLink = 1;
  private reductionL = 0;
  private reductionR = 0;

  prepare(sampleRate: number): void {
    this.sr = sampleRate;
    this.detectorL = new EnvelopeFollower(sampleRate, 1, 80);
    this.detectorR = new EnvelopeFollower(sampleRate, 1, 80);
    this.ballisticsL = new DbBallistics(sampleRate, 1, 80, 30);
    this.ballisticsR = new DbBallistics(sampleRate, 1, 80, 30);
    this.setBallisticsTimes();
  }

  setValues(values: ParamValues): void {
    this.values = values;
    this.setBallisticsTimes();
  }

  private setBallisticsTimes(): void {
    const attack = clamp(finiteValue(this.values.attack, 1), 0.1, 200);
    const release = clamp(finiteValue(this.values.release, 120), 10, 2000);
    const hold = clamp(finiteValue(this.values.hold, 30), 0, 500);
    this.ballisticsL.setTimes(attack, release, this.sr, hold);
    this.ballisticsR.setTimes(attack, release, this.sr, hold);
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    const legacyCurve = finiteValue(this.values.curve, 0) >= 0.5;
    const thresholdValue = finiteValue(this.values.threshold, -45);
    const rangeValue = finiteValue(this.values.range, 40);
    const ratioValue = finiteValue(this.values.ratio, 4);
    const threshold = legacyCurve ? thresholdValue : clamp(thresholdValue, -80, 0);
    const range = legacyCurve ? Math.max(0, rangeValue) : clamp(rangeValue, 0, 80);
    const ratio = legacyCurve ? Math.max(1, ratioValue) : clamp(ratioValue, 1, 20);
    const knee = legacyCurve ? 0 : clamp(finiteValue(this.values.knee, 6), 0, 24);
    const targetMix = clamp(finiteValue(this.values.mix, 100), 0, 100) / 100;
    const targetOutput = dbToGain(clamp(finiteValue(this.values.output, 0), -18, 18));
    const targetLink = clamp(finiteValue(this.values.link, 100), 0, 100) / 100;
    const controlSmooth = 1 - Math.exp(-1 / (0.02 * this.sr));
    let maxReductionL = 0;
    let maxReductionR = 0;

    for (let i = 0; i < n; i++) {
      const inputL = L[i];
      const inputR = R[i];
      this.mix += (targetMix - this.mix) * controlSmooth;
      this.outputGain += (targetOutput - this.outputGain) * controlSmooth;
      this.stereoLink += (targetLink - this.stereoLink) * controlSmooth;

      const detectedL = this.detectorL.process(inputL);
      const detectedR = this.detectorR.process(inputR);
      const linkedDetection = Math.max(detectedL, detectedR);
      const levelL = detectedL + (linkedDetection - detectedL) * this.stereoLink;
      const levelR = detectedR + (linkedDetection - detectedR) * this.stereoLink;
      const targetReductionL = Math.min(
        range,
        legacyCurve
          ? legacyExpansionReductionDb(gainToDb(Math.max(levelL, 1e-8)), threshold, ratio)
          : expansionReductionDb(gainToDb(Math.max(levelL, 1e-8)), threshold, ratio, knee),
      );
      const targetReductionR = Math.min(
        range,
        legacyCurve
          ? legacyExpansionReductionDb(gainToDb(Math.max(levelR, 1e-8)), threshold, ratio)
          : expansionReductionDb(gainToDb(Math.max(levelR, 1e-8)), threshold, ratio, knee),
      );
      const reductionL = this.ballisticsL.process(targetReductionL);
      const reductionR = this.ballisticsR.process(targetReductionR);
      if (reductionL > maxReductionL) maxReductionL = reductionL;
      if (reductionR > maxReductionR) maxReductionR = reductionR;

      const wetL = inputL * dbToGain(-reductionL) * this.outputGain;
      const wetR = inputR * dbToGain(-reductionR) * this.outputGain;
      L[i] = inputL + (wetL - inputL) * this.mix;
      R[i] = inputR + (wetR - inputR) * this.mix;
    }

    this.reductionL = maxReductionL;
    this.reductionR = maxReductionR;
  }

  reset(): void {
    this.detectorL.reset();
    this.detectorR.reset();
    this.ballisticsL.reset();
    this.ballisticsR.reset();
    this.mix = clamp(finiteValue(this.values.mix, 100), 0, 100) / 100;
    this.outputGain = dbToGain(clamp(finiteValue(this.values.output, 0), -18, 18));
    this.stereoLink = clamp(finiteValue(this.values.link, 100), 0, 100) / 100;
    this.reductionL = 0;
    this.reductionR = 0;
  }

  meter(): ProcessorMeter {
    const reduction = Math.max(this.reductionL, this.reductionR);
    return { reduction, reductionL: this.reductionL, reductionR: this.reductionR };
  }
}

export const gateDefinition: ProcessorDefinition = {
  type: 'gate',
  name: 'Gate / Expander',
  shortName: 'GATE',
  category: 'dynamics',
  description: 'Stereo-linked downward expander with a soft knee, hold, range and dry/wet.',
  purpose: 'Removes bleed and noise between phrases, or tightens loosely played drums.',
  params: [
    { key: 'threshold', label: 'Threshold', kind: 'float', min: -80, max: 0, step: 0.5, default: -45, unit: 'dB' },
    { key: 'ratio', label: 'Ratio', kind: 'float', min: 1, max: 20, step: 0.1, default: 4, unit: ':1' },
    { key: 'curve', label: 'Expansion curve', kind: 'enum', options: ['Standard', 'Legacy'], default: 0, advanced: true },
    { key: 'range', label: 'Range', kind: 'float', min: 0, max: 80, step: 1, default: 40, unit: 'dB' },
    { key: 'knee', label: 'Knee', kind: 'float', min: 0, max: 24, step: 0.5, default: 6, unit: 'dB' },
    { key: 'attack', label: 'Attack', kind: 'float', min: 0.1, max: 200, step: 0.1, default: 1, unit: 'ms' },
    { key: 'hold', label: 'Hold', kind: 'float', min: 0, max: 500, step: 1, default: 30, unit: 'ms' },
    { key: 'release', label: 'Release', kind: 'float', min: 10, max: 2000, step: 1, default: 120, unit: 'ms' },
    { key: 'link', label: 'Stereo link', kind: 'float', min: 0, max: 100, step: 1, default: 100, unit: '%' },
    { key: 'mix', label: 'Dry/wet', kind: 'float', min: 0, max: 100, step: 1, default: 100, unit: '%' },
    { key: 'output', label: 'Output', kind: 'float', min: -18, max: 18, step: 0.1, default: 0, unit: 'dB' },
  ],
  create: () => new Gate(),
};
