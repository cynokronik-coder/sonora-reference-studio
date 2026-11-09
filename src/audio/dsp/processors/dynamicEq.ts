import { Biquad, designBiquad } from '../biquad';
import { DbBallistics } from '../envelope';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain, gainToDb } from '../util';

export const DYN_EQ_BANDS = 4;
export const DYN_EQ_DETECTOR_MODES = ['Peak', 'RMS'] as const;

interface DynBand {
  detectorL: Biquad;
  detectorR: Biquad;
  filterL: Biquad;
  filterR: Biquad;
  ballisticsL: DbBallistics;
  ballisticsR: DbBallistics;
  rmsStateL: number;
  rmsStateR: number;
  reductionL: number;
  reductionR: number;
  lastFreq: number;
  lastQ: number;
  lastGainL: number;
  lastGainR: number;
}

function finiteValue(values: ParamValues, key: string, fallback: number): number {
  const value = values[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bandValue(values: ParamValues, band: number, key: string, fallback: number): number {
  return finiteValue(values, `b${band}_${key}`, fallback);
}

/** Soft-knee downward expansion in dB, with a hard maximum-cut range. */
function targetReduction(levelDb: number, threshold: number, ratio: number, knee: number, range: number): number {
  const over = levelDb - threshold;
  if (over <= 0 || range <= 0) return 0;
  const slope = 1 - 1 / ratio;
  const reduction = knee > 0 && over < knee
    ? (slope * over * over) / (2 * knee)
    : slope * over;
  return clamp(reduction, 0, range);
}

/**
 * Four-band dynamic equalizer.
 *
 * Each detector has independent left/right band-pass filter state. Peak or
 * RMS detection can be selected per band, then linked between stereo channels
 * from 0% (dual mono) to 100% (stronger detector controls both). A track key
 * can be supplied through AudioProcessor.setSidechain; when present, its
 * frequency content drives the gain envelope while the programme is filtered.
 *
 * Gain reduction uses per-channel dB ballistics. The dynamic bell's coefficients
 * are refreshed only after a small gain step, avoiding needless redesign on
 * every sample while keeping the gain movement smooth and measurable.
 */
export class DynamicEq implements AudioProcessor {
  readonly type = 'dynamicEq';
  readonly latency = 0;
  private sr = 48000;
  private maxBlock = 512;
  private values: ParamValues = {};
  private bands: DynBand[] = [];
  private meterBands = new Float32Array(DYN_EQ_BANDS);
  private overallReduction = 0;
  private sidechainL: Float32Array | null = null;
  private sidechainR: Float32Array | null = null;
  private detectorInputL = new Float32Array(512);
  private detectorInputR = new Float32Array(512);
  private outputGain = 1;

  constructor() {
    for (let i = 0; i < DYN_EQ_BANDS; i++) {
      this.bands.push({
        detectorL: new Biquad(),
        detectorR: new Biquad(),
        filterL: new Biquad(),
        filterR: new Biquad(),
        ballisticsL: new DbBallistics(48000, 8, 120),
        ballisticsR: new DbBallistics(48000, 8, 120),
        rmsStateL: 0,
        rmsStateR: 0,
        reductionL: 0,
        reductionR: 0,
        lastFreq: 0,
        lastQ: 0,
        lastGainL: 999,
        lastGainR: 999,
      });
    }
  }

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = Math.max(8000, Number.isFinite(sampleRate) ? sampleRate : 48000);
    this.maxBlock = Math.max(1, maxBlock);
    this.detectorInputL = new Float32Array(this.maxBlock);
    this.detectorInputR = new Float32Array(this.maxBlock);
    for (const band of this.bands) {
      band.ballisticsL = new DbBallistics(this.sr, 8, 120);
      band.ballisticsR = new DbBallistics(this.sr, 8, 120);
    }
    this.reset();
  }

  setValues(values: ParamValues): void {
    this.values = values;
    this.outputGain = dbToGain(clamp(finiteValue(values, 'output', 0), -18, 18));
  }

  setSidechain(L: Float32Array | null, R: Float32Array | null): void {
    this.sidechainL = L;
    this.sidechainR = R;
  }

  private detectorLevel(sample: number, mode: number, windowMs: number, band: DynBand, channel: 'L' | 'R'): number {
    const absolute = Math.abs(sample);
    if (mode < 0.5) return absolute;
    const coefficient = 1 - Math.exp(-1 / (Math.max(1, windowMs) * 0.001 * this.sr));
    if (channel === 'L') {
      band.rmsStateL += (sample * sample - band.rmsStateL) * coefficient;
      return Math.sqrt(Math.max(0, band.rmsStateL));
    }
    band.rmsStateR += (sample * sample - band.rmsStateR) * coefficient;
    return Math.sqrt(Math.max(0, band.rmsStateR));
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    if (n > this.maxBlock) {
      this.prepare(this.sr, n);
    }

    this.detectorInputL.set(L.subarray(0, n), 0);
    this.detectorInputR.set(R.subarray(0, n), 0);
    const hasExternalKey = this.sidechainL !== null && this.sidechainR !== null;
    const keyL = hasExternalKey ? this.sidechainL! : this.detectorInputL;
    const keyR = hasExternalKey ? this.sidechainR! : this.detectorInputR;
    let overallReduction = 0;

    for (let bandIndex = 0; bandIndex < DYN_EQ_BANDS; bandIndex++) {
      const on = bandValue(this.values, bandIndex, 'on', 0) > 0.5;
      if (!on) {
        this.meterBands[bandIndex] = 0;
        this.bands[bandIndex].reductionL = 0;
        this.bands[bandIndex].reductionR = 0;
        continue;
      }

      const frequency = clamp(bandValue(this.values, bandIndex, 'freq', [120, 400, 2500, 7000][bandIndex]), 20, this.sr * 0.45);
      const q = clamp(bandValue(this.values, bandIndex, 'q', 1.4), 0.3, 12);
      const threshold = clamp(bandValue(this.values, bandIndex, 'threshold', -30), -60, 0);
      const range = clamp(bandValue(this.values, bandIndex, 'range', 6), 0, 18);
      const ratio = clamp(bandValue(this.values, bandIndex, 'ratio', 4), 1, 20);
      const knee = clamp(bandValue(this.values, bandIndex, 'knee', 6), 0, 24);
      const attack = clamp(bandValue(this.values, bandIndex, 'attack', 8), 0.1, 100);
      const release = clamp(bandValue(this.values, bandIndex, 'release', 120), 10, 1000);
      const stereoLink = clamp(bandValue(this.values, bandIndex, 'link', 100), 0, 100) / 100;
      const detectorMode = clamp(bandValue(this.values, bandIndex, 'mode', 0), 0, 1);
      const rmsWindow = clamp(bandValue(this.values, bandIndex, 'rmsWindow', 10), 1, 100);
      const band = this.bands[bandIndex];

      if (Math.abs(frequency - band.lastFreq) > 0.25 || Math.abs(q - band.lastQ) > 0.002) {
        band.detectorL.configure('bandpass', frequency, 0, q, this.sr);
        band.detectorR.configure('bandpass', frequency, 0, q, this.sr);
        band.lastFreq = frequency;
        band.lastQ = q;
      }
      band.ballisticsL.setTimes(attack, release, this.sr);
      band.ballisticsR.setTimes(attack, release, this.sr);

      let maxReduction = 0;
      for (let sample = 0; sample < n; sample++) {
        // The detector filters the signed key signal before rectification. This
        // avoids creating a rectified waveform before the band-pass detector.
        const detectorL = band.detectorL.process(keyL[sample] ?? 0);
        const detectorR = band.detectorR.process(keyR[sample] ?? 0);
        let levelL = this.detectorLevel(detectorL, detectorMode, rmsWindow, band, 'L');
        let levelR = this.detectorLevel(detectorR, detectorMode, rmsWindow, band, 'R');

        const linkedLevel = Math.max(levelL, levelR);
        levelL += (linkedLevel - levelL) * stereoLink;
        levelR += (linkedLevel - levelR) * stereoLink;

        const targetL = targetReduction(gainToDb(Math.max(levelL, 1e-8)), threshold, ratio, knee, range);
        const targetR = targetReduction(gainToDb(Math.max(levelR, 1e-8)), threshold, ratio, knee, range);
        band.reductionL = band.ballisticsL.process(targetL);
        band.reductionR = band.ballisticsR.process(targetR);
        const reduction = Math.max(band.reductionL, band.reductionR);
        if (reduction > maxReduction) maxReduction = reduction;

        const gainL = -band.reductionL;
        const gainR = -band.reductionR;
        if (Math.abs(gainL - band.lastGainL) >= 0.05) {
          band.filterL.set(designBiquad('peak', frequency, gainL, q, this.sr));
          band.lastGainL = gainL;
        }
        if (Math.abs(gainR - band.lastGainR) >= 0.05) {
          band.filterR.set(designBiquad('peak', frequency, gainR, q, this.sr));
          band.lastGainR = gainR;
        }

        L[sample] = band.filterL.process(L[sample]);
        R[sample] = band.filterR.process(R[sample]);
      }

      this.meterBands[bandIndex] = -maxReduction;
      if (maxReduction > overallReduction) overallReduction = maxReduction;
    }

    if (this.outputGain !== 1) {
      for (let sample = 0; sample < n; sample++) {
        L[sample] *= this.outputGain;
        R[sample] *= this.outputGain;
      }
    }

    this.overallReduction = overallReduction;
  }

  reset(): void {
    this.detectorInputL.fill(0);
    this.detectorInputR.fill(0);
    for (const band of this.bands) {
      band.detectorL.reset();
      band.detectorR.reset();
      band.filterL.reset();
      band.filterR.reset();
      band.ballisticsL.reset();
      band.ballisticsR.reset();
      band.rmsStateL = 0;
      band.rmsStateR = 0;
      band.reductionL = 0;
      band.reductionR = 0;
      band.lastGainL = 999;
      band.lastGainR = 999;
      band.lastFreq = 0;
      band.lastQ = 0;
    }
    this.meterBands.fill(0);
    this.overallReduction = 0;
  }

  meter(): ProcessorMeter {
    return { reduction: this.overallReduction, bands: Array.from(this.meterBands) };
  }
}

function bandObject(i: number) {
  const group = `Band ${i + 1}`;
  return [
    { key: `b${i}_on`, label: 'Enabled', kind: 'bool' as const, default: 0, group },
    {
      key: `b${i}_freq`, label: 'Frequency', kind: 'float' as const, min: 20, max: 20000, step: 1,
      default: [120, 400, 2500, 7000][i], unit: 'Hz', scale: 'log' as const, group,
    },
    { key: `b${i}_q`, label: 'Q', kind: 'float' as const, min: 0.3, max: 12, step: 0.01, default: 1.4, group },
    {
      key: `b${i}_threshold`, label: 'Threshold', kind: 'float' as const, min: -60, max: 0, step: 0.5,
      default: -30, unit: 'dB', group,
    },
    { key: `b${i}_range`, label: 'Max cut', kind: 'float' as const, min: 0, max: 18, step: 0.1, default: 6, unit: 'dB', group },
    { key: `b${i}_attack`, label: 'Attack', kind: 'float' as const, min: 0.1, max: 100, step: 0.1, default: 8, unit: 'ms', group },
    { key: `b${i}_release`, label: 'Release', kind: 'float' as const, min: 10, max: 1000, step: 1, default: 120, unit: 'ms', group },
    { key: `b${i}_ratio`, label: 'Ratio', kind: 'float' as const, min: 1, max: 20, step: 0.1, default: 4, unit: ':1', advanced: true, group },
    { key: `b${i}_knee`, label: 'Knee', kind: 'float' as const, min: 0, max: 24, step: 0.1, default: 6, unit: 'dB', advanced: true, group },
    { key: `b${i}_link`, label: 'Stereo link', kind: 'float' as const, min: 0, max: 100, step: 1, default: 100, unit: '%', advanced: true, group },
    { key: `b${i}_mode`, label: 'Detector mode', kind: 'enum' as const, options: ['Peak', 'RMS'], default: 0, advanced: true, group },
    { key: `b${i}_rmsWindow`, label: 'RMS window', kind: 'float' as const, min: 1, max: 100, step: 0.5, default: 10, unit: 'ms', advanced: true, group },
  ];
}

export const dynamicEqDefinition: ProcessorDefinition = {
  type: 'dynamicEq',
  name: 'Dynamic EQ',
  shortName: 'DYN EQ',
  category: 'eq',
  description: 'Four-band dynamic EQ with peak/RMS detection, adjustable stereo linking, external sidechain keys and per-band gain reduction.',
  purpose: 'Controls resonances and boomy or harsh notes only when they occur, leaving the rest of the mix untouched.',
  params: [
    ...bandObject(0), ...bandObject(1), ...bandObject(2), ...bandObject(3),
    { key: 'output', label: 'Output', kind: 'float', min: -18, max: 18, step: 0.1, default: 0, unit: 'dB', group: 'Output' },
  ],
  create: () => new DynamicEq(),
};

export interface DynamicEqPreset {
  id: string;
  name: string;
  description: string;
  values: ParamValues;
}

function makeDynamicEqPreset(id: string, name: string, description: string, overrides: ParamValues): DynamicEqPreset {
  const values: ParamValues = { output: 0 };
  for (let band = 0; band < DYN_EQ_BANDS; band++) {
    values[`b${band}_on`] = 0;
    values[`b${band}_freq`] = [120, 400, 2500, 7000][band];
    values[`b${band}_q`] = 1.4;
    values[`b${band}_threshold`] = -30;
    values[`b${band}_range`] = 6;
    values[`b${band}_attack`] = 8;
    values[`b${band}_release`] = 120;
    values[`b${band}_ratio`] = 4;
    values[`b${band}_knee`] = 6;
    values[`b${band}_link`] = 100;
    values[`b${band}_mode`] = 0;
    values[`b${band}_rmsWindow`] = 10;
  }
  return { id, name, description, values: { ...values, ...overrides } };
}

/** Full parameter snapshots; presets remain ordinary editable detector/band controls. */
export const DYNAMIC_EQ_PRESETS: DynamicEqPreset[] = [
  makeDynamicEqPreset('vocal-harshness', 'Vocal harshness', 'Catch upper-mid spikes only when they rise above the threshold.', {
    b0_on: 1, b0_freq: 4200, b0_q: 2.2, b0_threshold: -28, b0_range: 5, b0_attack: 3, b0_release: 95,
    b1_on: 1, b1_freq: 7200, b1_q: 2.6, b1_threshold: -32, b1_range: 4, b1_attack: 1, b1_release: 70,
  }),
  makeDynamicEqPreset('low-frequency-control', 'Low-frequency control', 'Reduce resonant bass notes without permanently thinning the low end.', {
    b0_on: 1, b0_freq: 85, b0_q: 1.1, b0_threshold: -26, b0_range: 5, b0_attack: 16, b0_release: 180, b0_mode: 1,
    b1_on: 1, b1_freq: 180, b1_q: 1.3, b1_threshold: -30, b1_range: 3, b1_attack: 10, b1_release: 150,
  }),
  makeDynamicEqPreset('resonance-control', 'Resonance control', 'Use narrow, dynamic cuts to catch ringing notes and resonant peaks.', {
    b0_on: 1, b0_freq: 650, b0_q: 4.5, b0_threshold: -33, b0_range: 7, b0_attack: 5, b0_release: 140,
    b1_on: 1, b1_freq: 1800, b1_q: 4, b1_threshold: -31, b1_range: 6, b1_attack: 4, b1_release: 120,
    b2_on: 1, b2_freq: 4600, b2_q: 3.2, b2_threshold: -34, b2_range: 5, b2_attack: 2, b2_release: 100,
  }),
  makeDynamicEqPreset('smooth-highs', 'Smooth high frequencies', 'Control bright peaks while retaining the average high-frequency balance.', {
    b0_on: 1, b0_freq: 8200, b0_q: 1.5, b0_threshold: -30, b0_range: 5, b0_attack: 2, b0_release: 110, b0_mode: 1,
  }),
  makeDynamicEqPreset('mix-density', 'Dynamic mix density', 'Gentle level-dependent control across low mids and presence.', {
    b0_on: 1, b0_freq: 220, b0_q: 1, b0_threshold: -26, b0_range: 3, b0_attack: 18, b0_release: 180, b0_ratio: 2,
    b1_on: 1, b1_freq: 3200, b1_q: 1.1, b1_threshold: -26, b1_range: 2.5, b1_attack: 12, b1_release: 150, b1_ratio: 2,
  }),
];
