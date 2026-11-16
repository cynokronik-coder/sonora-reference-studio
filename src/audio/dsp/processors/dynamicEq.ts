import { Biquad } from '../biquad';
import { DbBallistics } from '../envelope';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain, gainToDb, SmoothedValue } from '../util';

export const DYN_EQ_BANDS = 4;
export const DYN_EQ_DETECTOR_MODES = ['Peak', 'RMS'] as const;
const DEFAULT_FREQUENCIES = [120, 400, 2500, 7000];
const DETECTOR_SMOOTH_MS = 20;
const GAIN_SMOOTH_MS = 5;
const OUTPUT_SMOOTH_MS = 20;
const PASSTHROUGH = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

const BAND_PARAMETER_KEYS = Array.from({ length: DYN_EQ_BANDS }, (_, index) => {
  const prefix = `b${index}_`;
  return {
    enabled: `${prefix}on`,
    frequency: `${prefix}freq`,
    q: `${prefix}q`,
    threshold: `${prefix}threshold`,
    range: `${prefix}range`,
    ratio: `${prefix}ratio`,
    knee: `${prefix}knee`,
    attack: `${prefix}attack`,
    release: `${prefix}release`,
    stereoLink: `${prefix}link`,
    detectorMode: `${prefix}mode`,
    rmsWindow: `${prefix}rmsWindow`,
  };
});

interface DynBandControls {
  enabled: boolean;
  frequency: number;
  q: number;
  threshold: number;
  range: number;
  ratio: number;
  knee: number;
  attack: number;
  release: number;
  stereoLink: number;
  detectorMode: number;
  rmsWindow: number;
}

interface DynBand {
  detectorL: Biquad;
  detectorR: Biquad;
  filterL: Biquad;
  filterR: Biquad;
  ballisticsL: DbBallistics;
  ballisticsR: DbBallistics;
  ballisticsLinked: DbBallistics;
  rmsStateL: number;
  rmsStateR: number;
  reductionL: number;
  reductionR: number;
  lastFreq: number;
  lastQ: number;
  lastGainL: number;
  lastGainR: number;
  active: boolean;
}

function finiteValue(values: ParamValues, key: string, fallback: number): number {
  const value = values[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function targetReduction(levelDb: number, threshold: number, ratio: number, knee: number, range: number): number {
  const over = levelDb - threshold;
  if (range <= 0 || over <= -knee * 0.5) return 0;
  const slope = 1 - 1 / ratio;
  if (knee > 0 && over < knee * 0.5) {
    const normalized = over + knee * 0.5;
    return clamp((slope * normalized * normalized) / (2 * knee), 0, range);
  }
  return clamp(slope * over, 0, range);
}

/** Four-band dynamic EQ with per-channel detection and frequency-aware keying. */
export class DynamicEq implements AudioProcessor {
  readonly type = 'dynamicEq';
  readonly latency = 0;
  private sr = 48000;
  private maxBlock = 512;
  private bands: DynBand[] = [];
  private controls: DynBandControls[] = [];
  private meterBands = new Array<number>(DYN_EQ_BANDS).fill(0);
  private overallReduction = 0;
  private sidechainL: Float32Array | null = null;
  private sidechainR: Float32Array | null = null;
  private detectorInputL = new Float32Array(512);
  private detectorInputR = new Float32Array(512);
  private readonly outputGain = new SmoothedValue(1, OUTPUT_SMOOTH_MS, 48000);

  constructor() {
    for (let i = 0; i < DYN_EQ_BANDS; i++) {
      this.controls.push({
        enabled: false,
        frequency: DEFAULT_FREQUENCIES[i],
        q: 1.4,
        threshold: -30,
        range: 6,
        ratio: 4,
        knee: 0,
        attack: 8,
        release: 120,
        stereoLink: 1,
        detectorMode: 0,
        rmsWindow: 10,
      });
      this.bands.push({
        detectorL: new Biquad(),
        detectorR: new Biquad(),
        filterL: new Biquad(),
        filterR: new Biquad(),
        ballisticsL: new DbBallistics(48000, 8, 120),
        ballisticsR: new DbBallistics(48000, 8, 120),
        ballisticsLinked: new DbBallistics(48000, 8, 120),
        rmsStateL: 0,
        rmsStateR: 0,
        reductionL: 0,
        reductionR: 0,
        lastFreq: 0,
        lastQ: 0,
        lastGainL: Number.NaN,
        lastGainR: Number.NaN,
        active: false,
      });
    }
  }

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = Number.isFinite(sampleRate) ? Math.max(8000, sampleRate) : 48000;
    this.maxBlock = Number.isFinite(maxBlock) ? Math.max(1, Math.floor(maxBlock)) : 512;
    this.detectorInputL = new Float32Array(this.maxBlock);
    this.detectorInputR = new Float32Array(this.maxBlock);
    this.outputGain.setTimeConstant(OUTPUT_SMOOTH_MS, this.sr);
    for (const band of this.bands) {
      band.ballisticsL.setTimes(8, 120, this.sr);
      band.ballisticsR.setTimes(8, 120, this.sr);
      band.ballisticsLinked.setTimes(8, 120, this.sr);
    }
    this.reset();
  }

  setValues(values: ParamValues): void {
    const maxFrequency = Math.max(20, Math.min(20_000, this.sr * 0.45));
    for (let i = 0; i < DYN_EQ_BANDS; i++) {
      const keys = BAND_PARAMETER_KEYS[i];
      const controls = this.controls[i];
      controls.enabled = finiteValue(values, keys.enabled, 0) > 0.5;
      controls.frequency = clamp(finiteValue(values, keys.frequency, DEFAULT_FREQUENCIES[i]), 20, maxFrequency);
      controls.q = clamp(finiteValue(values, keys.q, 1.4), 0.3, 12);
      controls.threshold = clamp(finiteValue(values, keys.threshold, -30), -60, 0);
      controls.range = clamp(finiteValue(values, keys.range, 6), 0, 18);
      controls.ratio = clamp(finiteValue(values, keys.ratio, 4), 1, 20);
      controls.knee = clamp(finiteValue(values, keys.knee, 0), 0, 24);
      controls.attack = clamp(finiteValue(values, keys.attack, 8), 0.1, 100);
      controls.release = clamp(finiteValue(values, keys.release, 120), 10, 1000);
      controls.stereoLink = clamp(finiteValue(values, keys.stereoLink, 100), 0, 100) / 100;
      controls.detectorMode = clamp(finiteValue(values, keys.detectorMode, 0), 0, 1);
      controls.rmsWindow = clamp(finiteValue(values, keys.rmsWindow, 10), 1, 100);
    }
    this.outputGain.set(dbToGain(clamp(finiteValue(values, 'output', 0), -18, 18)));
  }

  setSidechain(L: Float32Array | null, R: Float32Array | null): void {
    if ((L === null) !== (R === null)) {
      throw new RangeError('DynamicEq requires both external sidechain channels or neither');
    }
    this.sidechainL = L;
    this.sidechainR = R;
  }

  private targetFor(level: number, controls: DynBandControls): number {
    const levelDb = gainToDb(Math.max(level, 1e-8));
    return targetReduction(levelDb, controls.threshold, controls.ratio, controls.knee, controls.range);
  }

  private configureBandShape(band: DynBand, frequency: number, q: number): void {
    if (Math.abs(frequency - band.lastFreq) < 0.25 && Math.abs(q - band.lastQ) < 0.002) return;
    const shapeSamples = Math.max(1, Math.round(this.sr * DETECTOR_SMOOTH_MS / 1000));
    const gainL = Number.isFinite(band.lastGainL) ? band.lastGainL : 0;
    const gainR = Number.isFinite(band.lastGainR) ? band.lastGainR : 0;
    band.detectorL.configureSmoothed('bandpass', frequency, 0, q, this.sr, shapeSamples);
    band.detectorR.configureSmoothed('bandpass', frequency, 0, q, this.sr, shapeSamples);
    band.filterL.configureSmoothed('peak', frequency, gainL, q, this.sr, shapeSamples);
    band.filterR.configureSmoothed('peak', frequency, gainR, q, this.sr, shapeSamples);
    band.lastFreq = frequency;
    band.lastQ = q;
    band.lastGainL = gainL;
    band.lastGainR = gainR;
  }

  private updateGainFilter(band: DynBand, left: boolean, frequency: number, q: number, reduction: number): void {
    const filter = left ? band.filterL : band.filterR;
    const lastGain = left ? band.lastGainL : band.lastGainR;
    const gainDb = -reduction;
    if (!filter.isSmoothing && Math.abs(gainDb - lastGain) >= 0.05) {
      filter.configureSmoothed(
        'peak',
        frequency,
        gainDb,
        q,
        this.sr,
        Math.max(1, Math.round(this.sr * GAIN_SMOOTH_MS / 1000)),
      );
      if (left) band.lastGainL = gainDb;
      else band.lastGainR = gainDb;
    }
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    if (n > this.maxBlock || n > L.length || n > R.length) {
      throw new RangeError(`DynamicEq received ${n} frames; prepared capacity is ${this.maxBlock}`);
    }
    const hasExternalKey = this.sidechainL !== null && this.sidechainR !== null;
    if (hasExternalKey && (n > this.sidechainL!.length || n > this.sidechainR!.length)) {
      throw new RangeError('DynamicEq sidechain buffers must contain the requested frame count');
    }
    if (!hasExternalKey) {
      for (let sample = 0; sample < n; sample++) {
        this.detectorInputL[sample] = L[sample];
        this.detectorInputR[sample] = R[sample];
      }
    }

    let overallReduction = 0;
    for (let bandIndex = 0; bandIndex < DYN_EQ_BANDS; bandIndex++) {
      const band = this.bands[bandIndex];
      const controls = this.controls[bandIndex];
      if (!controls.enabled) {
        this.meterBands[bandIndex] = 0;
        if (band.active) {
          const bypassSamples = Math.max(1, Math.round(this.sr * GAIN_SMOOTH_MS / 1000));
          band.filterL.setSmoothed(PASSTHROUGH, bypassSamples);
          band.filterR.setSmoothed(PASSTHROUGH, bypassSamples);
          band.detectorL.reset();
          band.detectorR.reset();
          band.ballisticsL.reset();
          band.ballisticsR.reset();
          band.ballisticsLinked.reset();
          band.rmsStateL = 0;
          band.rmsStateR = 0;
          band.reductionL = 0;
          band.reductionR = 0;
          band.lastFreq = 0;
          band.lastQ = 0;
          band.lastGainL = Number.NaN;
          band.lastGainR = Number.NaN;
          band.active = false;
        }
        if (band.filterL.isSmoothing || band.filterR.isSmoothing) {
          for (let sample = 0; sample < n; sample++) {
            L[sample] = band.filterL.process(L[sample]);
            R[sample] = band.filterR.process(R[sample]);
          }
        }
        continue;
      }

      this.configureBandShape(band, controls.frequency, controls.q);
      band.active = true;
      band.ballisticsL.setTimes(controls.attack, controls.release, this.sr);
      band.ballisticsR.setTimes(controls.attack, controls.release, this.sr);
      band.ballisticsLinked.setTimes(controls.attack, controls.release, this.sr);
      const rmsCoefficient = 1 - Math.exp(-1 / (controls.rmsWindow * 0.001 * this.sr));
      const keyL = hasExternalKey ? this.sidechainL! : this.detectorInputL;
      const keyR = hasExternalKey ? this.sidechainR! : this.detectorInputR;
      let maxReduction = 0;

      for (let sample = 0; sample < n; sample++) {
        const detectorL = band.detectorL.process(keyL[sample]);
        const detectorR = band.detectorR.process(keyR[sample]);
        const peakL = Math.abs(detectorL);
        const peakR = Math.abs(detectorR);
        band.rmsStateL += (detectorL * detectorL - band.rmsStateL) * rmsCoefficient;
        band.rmsStateR += (detectorR * detectorR - band.rmsStateR) * rmsCoefficient;
        const levelL = controls.detectorMode < 0.5
          ? peakL
          : Math.sqrt(Math.max(0, band.rmsStateL));
        const levelR = controls.detectorMode < 0.5
          ? peakR
          : Math.sqrt(Math.max(0, band.rmsStateR));
        const linkedLevel = Math.max(levelL, levelR);
        const linkedTarget = this.targetFor(linkedLevel, controls);
        const reductionLinked = band.ballisticsLinked.process(linkedTarget);
        const keyLevelL = levelL + (linkedLevel - levelL) * controls.stereoLink;
        const keyLevelR = levelR + (linkedLevel - levelR) * controls.stereoLink;
        band.reductionL = controls.stereoLink >= 0.999
          ? reductionLinked
          : band.ballisticsL.process(this.targetFor(keyLevelL, controls));
        band.reductionR = controls.stereoLink >= 0.999
          ? reductionLinked
          : band.ballisticsR.process(this.targetFor(keyLevelR, controls));
        maxReduction = Math.max(maxReduction, band.reductionL, band.reductionR);

        this.updateGainFilter(band, true, controls.frequency, controls.q, band.reductionL);
        this.updateGainFilter(band, false, controls.frequency, controls.q, band.reductionR);
        L[sample] = band.filterL.process(L[sample]);
        R[sample] = band.filterR.process(R[sample]);
      }
      this.meterBands[bandIndex] = -maxReduction;
      overallReduction = Math.max(overallReduction, maxReduction);
    }

    for (let sample = 0; sample < n; sample++) {
      const gain = this.outputGain.next();
      L[sample] *= gain;
      R[sample] *= gain;
    }
    this.overallReduction = overallReduction;
  }

  reset(): void {
    for (const band of this.bands) {
      band.detectorL.reset();
      band.detectorR.reset();
      band.filterL.reset();
      band.filterR.reset();
      band.ballisticsL.reset();
      band.ballisticsR.reset();
      band.ballisticsLinked.reset();
      band.rmsStateL = 0;
      band.rmsStateR = 0;
      band.reductionL = 0;
      band.reductionR = 0;
      band.lastFreq = 0;
      band.lastQ = 0;
      band.lastGainL = Number.NaN;
      band.lastGainR = Number.NaN;
      band.active = false;
    }
    this.detectorInputL.fill(0);
    this.detectorInputR.fill(0);
    this.meterBands.fill(0);
    this.overallReduction = 0;
  }

  meter(): ProcessorMeter {
    return { reduction: this.overallReduction, bands: this.meterBands.slice() };
  }
}

function bandObject(i: number) {
  const group = `Band ${i + 1}`;
  return [
    { key: `b${i}_on`, label: 'Enabled', kind: 'bool' as const, default: 0, group },
    {
      key: `b${i}_freq`, label: 'Frequency', kind: 'float' as const, min: 20, max: 20000, step: 1,
      default: DEFAULT_FREQUENCIES[i], unit: 'Hz', scale: 'log' as const, group,
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
    { key: `b${i}_knee`, label: 'Knee', kind: 'float' as const, min: 0, max: 24, step: 0.1, default: 0, unit: 'dB', advanced: true, group },
    { key: `b${i}_link`, label: 'Stereo link', kind: 'float' as const, min: 0, max: 100, step: 1, default: 100, unit: '%', advanced: true, group },
    { key: `b${i}_mode`, label: 'Detector mode', kind: 'enum' as const, options: [...DYN_EQ_DETECTOR_MODES], default: 0, advanced: true, group },
    { key: `b${i}_rmsWindow`, label: 'RMS window', kind: 'float' as const, min: 1, max: 100, step: 0.5, default: 10, unit: 'ms', advanced: true, group },
  ];
}

export const dynamicEqDefinition: ProcessorDefinition = {
  type: 'dynamicEq',
  name: 'Dynamic EQ',
  shortName: 'DYN EQ',
  category: 'eq',
  description: 'Four-band dynamic EQ with Peak/RMS detection, adjustable stereo linking, external keys and smooth gain changes.',
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
  const values: ParamValues = {};
  for (const param of dynamicEqDefinition.params) values[param.key] = param.default;
  return { id, name, description, values: { ...values, ...overrides } };
}

/** Conservative editable starting points, not automatic resonance diagnosis. */
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
