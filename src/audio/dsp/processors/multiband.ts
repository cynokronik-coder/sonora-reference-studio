import { Lr4Crossover } from '../crossover';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain } from '../util';
import { Compressor } from './compressor';

const BAND_NAMES = ['Low', 'Mid', 'High'];
const DEFAULT_SPLITS = { low: 200, high: 4000 };

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

/**
 * Three-band LR4 processor using the same Compressor implementation as the
 * single-band dynamics processor. Program and external-key signals are split
 * independently at identical crossover points, so each band's detector hears
 * the corresponding frequency region rather than the entire key spectrum.
 *
 * "Enabled" bypasses compression for that band while preserving its audio.
 * "Solo band" auditions the selected band(s); if no band is soloed, all bands
 * are recombined. The overall gain-reduction meter reports the strongest band,
 * and the per-band meter array reports negative dB values for compact displays.
 */
export class MultibandCompressor implements AudioProcessor {
  readonly type = 'multibandComp';
  readonly latency = 0;
  private sr = 48000;
  private maxBlock = 512;
  private values: ParamValues = {};
  private xover = new Lr4Crossover(48000);
  private sidechainXover = new Lr4Crossover(48000);
  private bands: Compressor[] = [];
  private bufs = createStereoBuffers(512);
  private sidechainBufs = createStereoBuffers(512);
  private bandL: Float32Array[] = [this.bufs.lowL, this.bufs.midL, this.bufs.highL];
  private bandR: Float32Array[] = [this.bufs.lowR, this.bufs.midR, this.bufs.highR];
  private keyBandL: Float32Array[] = [this.sidechainBufs.lowL, this.sidechainBufs.midL, this.sidechainBufs.highL];
  private keyBandR: Float32Array[] = [this.sidechainBufs.lowR, this.sidechainBufs.midR, this.sidechainBufs.highR];
  private bandReduction = [0, 0, 0];
  private sidechainL: Float32Array | null = null;
  private sidechainR: Float32Array | null = null;

  constructor() {
    for (let i = 0; i < 3; i++) this.bands.push(new Compressor());
  }

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = sampleRate;
    this.maxBlock = Math.max(1, maxBlock);
    this.xover.prepare(sampleRate, this.maxBlock);
    this.sidechainXover.prepare(sampleRate, this.maxBlock);
    for (const band of this.bands) band.prepare(sampleRate, this.maxBlock);
    this.bufs = createStereoBuffers(this.maxBlock);
    this.sidechainBufs = createStereoBuffers(this.maxBlock);
    this.bandL = [this.bufs.lowL, this.bufs.midL, this.bufs.highL];
    this.bandR = [this.bufs.lowR, this.bufs.midR, this.bufs.highR];
    this.keyBandL = [this.sidechainBufs.lowL, this.sidechainBufs.midL, this.sidechainBufs.highL];
    this.keyBandR = [this.sidechainBufs.lowR, this.sidechainBufs.midR, this.sidechainBufs.highR];
    this.bandReduction.fill(0);
  }

  setSidechain(L: Float32Array | null, R: Float32Array | null): void {
    // Renderer refreshes this assignment every block. Only reset the key
    // crossover when the source actually changes, not on each block.
    if (L !== this.sidechainL || R !== this.sidechainR) {
      this.sidechainXover.reset();
    }
    this.sidechainL = L;
    this.sidechainR = R;
  }

  setValues(values: ParamValues): void {
    this.values = values;

    // Keep the two split points ordered with at least a 2:1 ratio. The rack
    // also updates the paired value so the displayed controls stay truthful.
    const low = clamp(values.xLow ?? DEFAULT_SPLITS.low, 40, Math.min(600, this.sr * 0.35));
    const highLimit = Math.min(12000, this.sr * 0.45);
    const high = clamp(Math.max(values.xHigh ?? DEFAULT_SPLITS.high, low * 2), Math.min(800, highLimit), highLimit);
    this.xover.configure(this.sr, low, high);
    this.sidechainXover.configure(this.sr, low, high);

    for (let i = 0; i < 3; i++) {
      this.bands[i].setValues({
        threshold: values[`b${i}_threshold`] ?? [-22, -20, -24][i],
        ratio: values[`b${i}_ratio`] ?? 2.5,
        attack: values[`b${i}_attack`] ?? [20, 15, 8][i],
        release: values[`b${i}_release`] ?? [180, 140, 100][i],
        knee: values[`b${i}_knee`] ?? 6,
        style: values[`b${i}_style`] ?? 0,
        scHpf: 20,
        link: values[`b${i}_link`] ?? 100,
        makeup: values[`b${i}_makeup`] ?? 0,
        mix: values[`b${i}_mix`] ?? 100,
        lookahead: 0,
        autoMakeup: 0,
      });
    }
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    if (n > this.maxBlock) {
      // AudioProcessor callers are expected to honour maxBlock, but process
      // safely if a host supplies a larger block instead of overrunning buffers.
      this.prepare(this.sr, n);
      this.setValues(this.values);
    }

    this.xover.split(L, R, n, this.bufs);
    const hasExternalKey = this.sidechainL !== null && this.sidechainR !== null;
    if (hasExternalKey) {
      this.sidechainXover.split(this.sidechainL!, this.sidechainR!, n, this.sidechainBufs);
    }

    const solo0 = (this.values.b0_solo ?? 0) > 0.5;
    const solo1 = (this.values.b1_solo ?? 0) > 0.5;
    const solo2 = (this.values.b2_solo ?? 0) > 0.5;
    const anySolo = solo0 || solo1 || solo2;
    let maxReduction = 0;

    for (let i = 0; i < 3; i++) {
      const left = this.bandL[i];
      const right = this.bandR[i];
      const soloed = i === 0 ? solo0 : i === 1 ? solo1 : solo2;

      // External keys are frequency-split to match the programme band.
      // A high-frequency key must not trigger the low-band compressor.
      this.bands[i].setSidechain(
        hasExternalKey ? this.keyBandL[i] : null,
        hasExternalKey ? this.keyBandR[i] : null,
      );

      if ((this.values[`b${i}_on`] ?? 1) > 0.5) {
        this.bands[i].process(left, right, n);
        this.bandReduction[i] = this.bands[i].meter().reduction ?? 0;
      } else {
        this.bandReduction[i] = 0;
      }

      if (this.bandReduction[i] > maxReduction) maxReduction = this.bandReduction[i];

      // Solo is an audition control, not a destructive band mute. The selected
      // bands remain full-band signals and are never written into the project.
      if (anySolo && !soloed) {
        left.fill(0, 0, n);
        right.fill(0, 0, n);
      }
    }

    L.fill(0, 0, n);
    R.fill(0, 0, n);
    for (let i = 0; i < 3; i++) {
      const left = this.bandL[i];
      const right = this.bandR[i];
      for (let sample = 0; sample < n; sample++) {
        L[sample] += left[sample];
        R[sample] += right[sample];
      }
    }

    const outputGain = dbToGain(this.values.output ?? 0);
    if (outputGain !== 1) {
      for (let i = 0; i < n; i++) {
        L[i] *= outputGain;
        R[i] *= outputGain;
      }
    }

    this.overallReduction = maxReduction;
  }

  private overallReduction = 0;

  reset(): void {
    for (const band of this.bands) band.reset();
    this.xover.reset();
    this.sidechainXover.reset();
    this.bandReduction.fill(0);
    this.overallReduction = 0;
  }

  meter(): ProcessorMeter {
    return {
      reduction: this.overallReduction,
      bands: [-this.bandReduction[0], -this.bandReduction[1], -this.bandReduction[2]],
    };
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
  description: 'Three-band LR4 compressor with independent dynamics, frequency-matched external sidechains, per-band solo and stereo linking.',
  purpose: 'Controls low-end energy, midrange density and high-frequency harshness independently without forcing the whole mix through one broadband detector.',
  params: [
    { key: 'xLow', label: 'Low / mid split', kind: 'float', min: 40, max: 600, step: 1, default: 200, unit: 'Hz', scale: 'log', group: 'Crossovers' },
    { key: 'xHigh', label: 'Mid / high split', kind: 'float', min: 800, max: 12000, step: 1, default: 4000, unit: 'Hz', scale: 'log', group: 'Crossovers' },
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
  const values: ParamValues = { xLow: 200, xHigh: 4000, output: 0 };
  for (let i = 0; i < 3; i++) {
    values[`b${i}_on`] = 1;
    values[`b${i}_solo`] = 0;
    values[`b${i}_threshold`] = [-22, -20, -24][i];
    values[`b${i}_ratio`] = 2.5;
    values[`b${i}_attack`] = [20, 15, 8][i];
    values[`b${i}_release`] = [180, 140, 100][i];
    values[`b${i}_knee`] = 6;
    values[`b${i}_makeup`] = 0;
    values[`b${i}_mix`] = 100;
    values[`b${i}_link`] = 100;
    values[`b${i}_style`] = 0;
  }
  return { id, name, description, values: { ...values, ...overrides } };
}

/** Complete, editable parameter snapshots; no genre detection or hidden macro logic. */
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
