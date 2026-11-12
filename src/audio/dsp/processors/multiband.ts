import { Lr4Crossover } from '../crossover';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain, SmoothedValue } from '../util';
import { Compressor } from './compressor';

const BAND_NAMES = ['Low', 'Mid', 'High'] as const;
const DEFAULT_SPLITS = { low: 200, high: 4000 };
const CROSSOVER_SMOOTH_MS = 100;
const BAND_SMOOTH_MS = 10;

interface StereoBuffers {
  lowL: Float32Array;
  lowR: Float32Array;
  midL: Float32Array;
  midR: Float32Array;
  highL: Float32Array;
  highR: Float32Array;
}

function createStereoBuffers(size: number): StereoBuffers {
  return {
    lowL: new Float32Array(size),
    lowR: new Float32Array(size),
    midL: new Float32Array(size),
    midR: new Float32Array(size),
    highL: new Float32Array(size),
    highR: new Float32Array(size),
  };
}

const finiteOr = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) ? value : fallback;

/**
 * Three-band LR4 compressor with frequency-matched external keying. Band
 * bypass, solo and crossover changes are smoothed to avoid abrupt signal steps.
 */
export class MultibandCompressor implements AudioProcessor {
  readonly type = 'multibandComp';
  readonly latency = 0;
  private sr = 48000;
  private maxBlock = 512;
  private values: ParamValues = {};
  private xover = new Lr4Crossover(48000);
  private keyXover = new Lr4Crossover(48000);
  private bands = [new Compressor(), new Compressor(), new Compressor()];
  private bufs = createStereoBuffers(512);
  private dryBufs = createStereoBuffers(512);
  private keyBufs = createStereoBuffers(512);
  private bandL: Float32Array[] = [this.bufs.lowL, this.bufs.midL, this.bufs.highL];
  private bandR: Float32Array[] = [this.bufs.lowR, this.bufs.midR, this.bufs.highR];
  private dryBandL: Float32Array[] = [this.dryBufs.lowL, this.dryBufs.midL, this.dryBufs.highL];
  private dryBandR: Float32Array[] = [this.dryBufs.lowR, this.dryBufs.midR, this.dryBufs.highR];
  private keyBandL: Float32Array[] = [this.keyBufs.lowL, this.keyBufs.midL, this.keyBufs.highL];
  private keyBandR: Float32Array[] = [this.keyBufs.lowR, this.keyBufs.midR, this.keyBufs.highR];
  private readonly lowFrequency = new SmoothedValue(DEFAULT_SPLITS.low, CROSSOVER_SMOOTH_MS, 48000);
  private readonly highFrequency = new SmoothedValue(DEFAULT_SPLITS.high, CROSSOVER_SMOOTH_MS, 48000);
  private readonly compressionMix = [
    new SmoothedValue(1, BAND_SMOOTH_MS, 48000),
    new SmoothedValue(1, BAND_SMOOTH_MS, 48000),
    new SmoothedValue(1, BAND_SMOOTH_MS, 48000),
  ];
  private readonly soloMix = [
    new SmoothedValue(1, BAND_SMOOTH_MS, 48000),
    new SmoothedValue(1, BAND_SMOOTH_MS, 48000),
    new SmoothedValue(1, BAND_SMOOTH_MS, 48000),
  ];
  private readonly outputGain = new SmoothedValue(1, BAND_SMOOTH_MS, 48000);
  private lowTarget = DEFAULT_SPLITS.low;
  private highTarget = DEFAULT_SPLITS.high;
  private configuredLow = DEFAULT_SPLITS.low;
  private configuredHigh = DEFAULT_SPLITS.high;
  private sidechainL: Float32Array | null = null;
  private sidechainR: Float32Array | null = null;
  private bandReduction = [0, 0, 0];
  private bandEnabled = [true, true, true];
  private overallReduction = 0;
  private meterBands = [0, 0, 0];

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = sampleRate;
    this.maxBlock = Math.max(1, maxBlock);
    this.lowFrequency.setTimeConstant(CROSSOVER_SMOOTH_MS, sampleRate);
    this.highFrequency.setTimeConstant(CROSSOVER_SMOOTH_MS, sampleRate);
    for (let i = 0; i < 3; i++) {
      this.compressionMix[i].setTimeConstant(BAND_SMOOTH_MS, sampleRate);
      this.soloMix[i].setTimeConstant(BAND_SMOOTH_MS, sampleRate);
      this.bands[i].prepare(sampleRate, this.maxBlock);
    }
    this.outputGain.setTimeConstant(BAND_SMOOTH_MS, sampleRate);
    this.xover.prepare(sampleRate, this.maxBlock);
    this.keyXover.prepare(sampleRate, this.maxBlock);
    this.bufs = createStereoBuffers(this.maxBlock);
    this.dryBufs = createStereoBuffers(this.maxBlock);
    this.keyBufs = createStereoBuffers(this.maxBlock);
    this.bindBuffers();
    this.configuredLow = this.lowFrequency.value;
    this.configuredHigh = this.highFrequency.value;
    this.xover.configure(sampleRate, this.configuredLow, this.configuredHigh);
    this.keyXover.configure(sampleRate, this.configuredLow, this.configuredHigh);
    this.setValues(this.values);
    this.reset();
  }

  private bindBuffers(): void {
    this.bandL = [this.bufs.lowL, this.bufs.midL, this.bufs.highL];
    this.bandR = [this.bufs.lowR, this.bufs.midR, this.bufs.highR];
    this.dryBandL = [this.dryBufs.lowL, this.dryBufs.midL, this.dryBufs.highL];
    this.dryBandR = [this.dryBufs.lowR, this.dryBufs.midR, this.dryBufs.highR];
    this.keyBandL = [this.keyBufs.lowL, this.keyBufs.midL, this.keyBufs.highL];
    this.keyBandR = [this.keyBufs.lowR, this.keyBufs.midR, this.keyBufs.highR];
  }

  setSidechain(L: Float32Array | null, R: Float32Array | null): void {
    const keyL = L && R ? L : null;
    const keyR = L && R ? R : null;
    if (keyL !== this.sidechainL || keyR !== this.sidechainR) this.keyXover.reset();
    this.sidechainL = keyL;
    this.sidechainR = keyR;
  }

  setValues(values: ParamValues): void {
    const lowMax = Math.min(600, this.sr * 0.4);
    const highMax = Math.min(12_000, this.sr * 0.45);
    const low = clamp(finiteOr(values.xLow, DEFAULT_SPLITS.low), 40, lowMax);
    const high = Math.min(
      highMax,
      Math.max(Math.min(800, highMax), low + 20, finiteOr(values.xHigh, DEFAULT_SPLITS.high)),
    );
    this.lowTarget = low;
    this.highTarget = high;
    this.lowFrequency.set(low);
    this.highFrequency.set(high);
    this.values = { ...values, xLow: low, xHigh: high };
    const solo0 = finiteOr(values.b0_solo, 0) > 0.5;
    const solo1 = finiteOr(values.b1_solo, 0) > 0.5;
    const solo2 = finiteOr(values.b2_solo, 0) > 0.5;
    const anySolo = solo0 || solo1 || solo2;
    for (let i = 0; i < 3; i++) {
      const on = finiteOr(values[`b${i}_on`], 1) > 0.5;
      this.bandEnabled[i] = on;
      const soloed = i === 0 ? solo0 : i === 1 ? solo1 : solo2;
      this.compressionMix[i].set(on ? 1 : 0);
      this.soloMix[i].set(!anySolo || soloed ? 1 : 0);
      this.bands[i].setValues({
        threshold: finiteOr(values[`b${i}_threshold`], [-22, -20, -24][i]),
        ratio: finiteOr(values[`b${i}_ratio`], 2.5),
        attack: finiteOr(values[`b${i}_attack`], [20, 15, 8][i]),
        release: finiteOr(values[`b${i}_release`], [180, 140, 100][i]),
        knee: finiteOr(values[`b${i}_knee`], 6),
        style: finiteOr(values[`b${i}_style`], 0),
        scHpf: 20,
        link: finiteOr(values[`b${i}_link`], 100),
        makeup: finiteOr(values[`b${i}_makeup`], 0),
        mix: finiteOr(values[`b${i}_mix`], 100),
        lookahead: 0,
        autoMakeup: 0,
      });
    }
    this.outputGain.set(dbToGain(clamp(finiteOr(values.output, 0), -18, 18)));
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    if (n > this.maxBlock || n > L.length || n > R.length) {
      throw new RangeError(`MultibandCompressor received ${n} frames; prepared capacity is ${this.maxBlock}`);
    }
    if (this.sidechainL && this.sidechainR && (n > this.sidechainL.length || n > this.sidechainR.length)) {
      throw new RangeError('MultibandCompressor sidechain buffers must contain the requested frame count');
    }

    const low = this.lowFrequency.value;
    const high = this.highFrequency.value;
    if (Math.abs(low - this.configuredLow) > 0.01 || Math.abs(high - this.configuredHigh) > 0.01) {
      this.configuredLow = low;
      this.configuredHigh = high;
      this.xover.configure(this.sr, low, high);
      this.keyXover.configure(this.sr, low, high);
    }
    this.xover.split(L, R, n, this.bufs);

    const hasExternalKey = this.sidechainL !== null && this.sidechainR !== null;
    if (hasExternalKey) {
      this.keyXover.split(this.sidechainL!, this.sidechainR!, n, this.keyBufs);
    }

    let maxReduction = 0;
    for (let band = 0; band < 3; band++) {
      const left = this.bandL[band];
      const right = this.bandR[band];
      const dryLeft = this.dryBandL[band];
      const dryRight = this.dryBandR[band];
      if (hasExternalKey) {
        this.bands[band].setSidechain(this.keyBandL[band], this.keyBandR[band]);
      } else {
        this.bands[band].setSidechain(null, null);
      }

      for (let sample = 0; sample < n; sample++) {
        dryLeft[sample] = left[sample];
        dryRight[sample] = right[sample];
      }
      this.bands[band].process(left, right, n);

      const reduction = this.bandEnabled[band] ? this.bands[band].gainReductionDb : 0;
      this.bandReduction[band] = reduction;
      if (reduction > maxReduction) maxReduction = reduction;

      const compressionMix = this.compressionMix[band];
      const soloMix = this.soloMix[band];
      for (let sample = 0; sample < n; sample++) {
        const compAmount = compressionMix.next();
        const soloAmount = soloMix.next();
        left[sample] = (dryLeft[sample] + (left[sample] - dryLeft[sample]) * compAmount) * soloAmount;
        right[sample] = (dryRight[sample] + (right[sample] - dryRight[sample]) * compAmount) * soloAmount;
      }
    }

    L.fill(0, 0, n);
    R.fill(0, 0, n);
    for (let band = 0; band < 3; band++) {
      const left = this.bandL[band];
      const right = this.bandR[band];
      for (let sample = 0; sample < n; sample++) {
        L[sample] += left[sample];
        R[sample] += right[sample];
      }
    }

    for (let sample = 0; sample < n; sample++) {
      const gain = this.outputGain.next();
      L[sample] *= gain;
      R[sample] *= gain;
    }
    this.overallReduction = maxReduction;

    for (let sample = 0; sample < n; sample++) {
      this.lowFrequency.next();
      this.highFrequency.next();
    }
    if (Math.abs(this.lowFrequency.value - this.lowTarget) < 0.01) this.lowFrequency.snap(this.lowTarget);
    if (Math.abs(this.highFrequency.value - this.highTarget) < 0.01) this.highFrequency.snap(this.highTarget);
  }

  reset(): void {
    for (let i = 0; i < 3; i++) this.bands[i].reset();
    this.xover.reset();
    this.keyXover.reset();
    this.bandReduction.fill(0);
    this.overallReduction = 0;
  }

  meter(): ProcessorMeter {
    this.meterBands[0] = -this.bandReduction[0];
    this.meterBands[1] = -this.bandReduction[1];
    this.meterBands[2] = -this.bandReduction[2];
    return { reduction: this.overallReduction, bands: this.meterBands };
  }
}

function bandParams(i: number) {
  const group = `${BAND_NAMES[i]} band`;
  return [
    { key: `b${i}_on`, label: 'Compression enabled', kind: 'bool' as const, default: 1, group },
    { key: `b${i}_solo`, label: 'Solo band', kind: 'bool' as const, default: 0, advanced: true, group },
    { key: `b${i}_threshold`, label: 'Threshold', kind: 'float' as const, min: -60, max: 0, step: 0.1, default: [-22, -20, -24][i], unit: 'dB', group },
    { key: `b${i}_ratio`, label: 'Ratio', kind: 'float' as const, min: 1, max: 20, step: 0.1, default: 2.5, unit: ':1', group },
    { key: `b${i}_attack`, label: 'Attack', kind: 'float' as const, min: 0.1, max: 200, step: 0.1, default: [20, 15, 8][i], unit: 'ms', group },
    { key: `b${i}_release`, label: 'Release', kind: 'float' as const, min: 10, max: 2000, step: 1, default: [180, 140, 100][i], unit: 'ms', group },
    { key: `b${i}_knee`, label: 'Knee', kind: 'float' as const, min: 0, max: 24, step: 0.1, default: 6, unit: 'dB', group },
    { key: `b${i}_makeup`, label: 'Makeup', kind: 'float' as const, min: -12, max: 24, step: 0.1, default: 0, unit: 'dB', group },
    { key: `b${i}_mix`, label: 'Dry/wet', kind: 'float' as const, min: 0, max: 100, step: 1, default: 100, unit: '%', advanced: true, group },
    { key: `b${i}_link`, label: 'Stereo link', kind: 'float' as const, min: 0, max: 100, step: 1, default: 100, unit: '%', advanced: true, group },
    { key: `b${i}_style`, label: 'Character', kind: 'enum' as const, options: ['VCA', 'FET', 'Optical', 'Vari-mu', 'Bus'], default: 0, advanced: true, group },
  ];
}

export const multibandCompDefinition: ProcessorDefinition = {
  type: 'multibandComp',
  name: 'Multiband Compressor',
  shortName: 'MB COMP',
  category: 'dynamics',
  description: 'Three-band LR4 compressor with independent dynamics, frequency-matched external keying, per-band solo and stereo linking.',
  purpose: 'Controls low-end energy, midrange density and high-frequency harshness independently while preserving the summed crossover response.',
  params: [
    { key: 'xLow', label: 'Low / mid split', kind: 'float', min: 40, max: 600, step: 1, default: DEFAULT_SPLITS.low, unit: 'Hz', scale: 'log', group: 'Crossovers' },
    { key: 'xHigh', label: 'Mid / high split', kind: 'float', min: 800, max: 12000, step: 1, default: DEFAULT_SPLITS.high, unit: 'Hz', scale: 'log', group: 'Crossovers' },
    ...bandParams(0), ...bandParams(1), ...bandParams(2),
    { key: 'output', label: 'Output', kind: 'float', min: -18, max: 18, step: 0.1, default: 0, unit: 'dB', group: 'Output' },
  ],
  create: () => new MultibandCompressor(),
};

export interface MultibandPreset {
  id: string;
  name: string;
  description: string;
  values: ParamValues;
}

function multibandPreset(
  id: string,
  name: string,
  description: string,
  overrides: ParamValues,
): MultibandPreset {
  const values: ParamValues = {};
  for (const param of multibandCompDefinition.params) values[param.key] = param.default;
  return { id, name, description, values: { ...values, ...overrides } };
}

export const MULTIBAND_PRESETS: MultibandPreset[] = [
  multibandPreset('low-end-control', 'Low-end control', 'Tighter subs with gentler processing above the bass range.', {
    xLow: 140, xHigh: 3200,
    b0_threshold: -26, b0_ratio: 3.2, b0_attack: 32, b0_release: 240,
    b1_threshold: -20, b1_ratio: 1.7, b1_attack: 24, b1_release: 180,
    b2_threshold: -24, b2_ratio: 1.3, b2_attack: 12, b2_release: 140,
  }),
  multibandPreset('gentle-glue', 'Gentle multiband glue', 'Subtle, linked control across all three frequency regions.', {
    xLow: 220, xHigh: 4200,
    b0_threshold: -18, b0_ratio: 1.4, b0_attack: 35, b0_release: 220, b0_mix: 65,
    b1_threshold: -18, b1_ratio: 1.4, b1_attack: 28, b1_release: 180, b1_mix: 65,
    b2_threshold: -20, b2_ratio: 1.3, b2_attack: 18, b2_release: 160, b2_mix: 65,
  }),
  multibandPreset('presence-smoothing', 'Presence smoothing', 'Reduces bright-band peaks while keeping the lows and body more open.', {
    xLow: 250, xHigh: 3600,
    b0_threshold: -22, b0_ratio: 1.5, b0_attack: 28, b0_release: 200,
    b1_threshold: -20, b1_ratio: 1.6, b1_attack: 18, b1_release: 160,
    b2_threshold: -28, b2_ratio: 2.8, b2_attack: 5, b2_release: 110,
  }),
  multibandPreset('modern-density', 'Modern density', 'More consistent low, mid and high energy for dense productions.', {
    xLow: 160, xHigh: 5000,
    b0_threshold: -24, b0_ratio: 2.6, b0_attack: 18, b0_release: 150,
    b1_threshold: -24, b1_ratio: 2.2, b1_attack: 12, b1_release: 120,
    b2_threshold: -26, b2_ratio: 1.8, b2_attack: 6, b2_release: 100,
  }),
  multibandPreset('dynamic-open', 'Dynamic and open', 'Low ratios and slower attacks preserve more transient movement.', {
    xLow: 180, xHigh: 4500,
    b0_threshold: -18, b0_ratio: 1.3, b0_attack: 45, b0_release: 260,
    b1_threshold: -18, b1_ratio: 1.25, b1_attack: 35, b1_release: 220,
    b2_threshold: -20, b2_ratio: 1.2, b2_attack: 24, b2_release: 180,
  }),
];

export const MULTIBAND_COMP_PRESETS = MULTIBAND_PRESETS;
