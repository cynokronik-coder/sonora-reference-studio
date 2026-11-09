import { Lr4Crossover } from '../crossover';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { Compressor } from './compressor';

const BAND_NAMES = ['Low', 'Mid', 'High'] as const;
type BandIndex = 0 | 1 | 2;
type StereoBuffers = {
  lowL: Float32Array;
  lowR: Float32Array;
  midL: Float32Array;
  midR: Float32Array;
  highL: Float32Array;
  highR: Float32Array;
};

function createStereoBuffers(size: number): StereoBuffers {
  return {
    lowL: new Float32Array(size), lowR: new Float32Array(size),
    midL: new Float32Array(size), midR: new Float32Array(size),
    highL: new Float32Array(size), highR: new Float32Array(size),
  };
}

/**
 * Three-band LR4 compressor with band-aware external sidechain detection.
 *
 * The programme and external key have separate crossover state. An external
 * key is split at the exact same frequencies as the programme so each
 * compressor reacts to the corresponding frequency region rather than every
 * band reacting to the same full-range key signal.
 *
 * Band bypass leaves the crossover band uncompressed. Band solo is a monitor
 * function and does not change the stored bypass or compressor parameters.
 */
export class MultibandCompressor implements AudioProcessor {
  readonly type = 'multibandComp';
  readonly latency = 0;
  private sr = 48000;
  private maxBlock = 512;
  private values: ParamValues = {};
  private xover = new Lr4Crossover(48000);
  private keyXover = new Lr4Crossover(48000);
  private bands: Compressor[] = [];
  private bufs = createStereoBuffers(512);
  private keyBufs = createStereoBuffers(512);
  private sidechainL: Float32Array | null = null;
  private sidechainR: Float32Array | null = null;
  private bandReduction = [0, 0, 0];

  constructor() {
    for (let i = 0; i < 3; i++) this.bands.push(new Compressor());
  }

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = sampleRate;
    this.maxBlock = Math.max(1, maxBlock);
    this.xover.prepare(sampleRate, this.maxBlock);
    this.keyXover.prepare(sampleRate, this.maxBlock);
    for (const band of this.bands) band.prepare(sampleRate, this.maxBlock);
    this.bufs = createStereoBuffers(this.maxBlock);
    this.keyBufs = createStereoBuffers(this.maxBlock);
    this.reset();
  }

  setSidechain(L: Float32Array | null, R: Float32Array | null): void {
    this.sidechainL = L && R ? L : null;
    this.sidechainR = L && R ? R : null;
  }

  setValues(values: ParamValues): void {
    this.values = values;
    const low = values.xLow ?? 200;
    const high = values.xHigh ?? 4000;
    this.xover.configure(this.sr, low, high);
    this.keyXover.configure(this.sr, low, high);
    for (let i = 0; i < 3; i++) {
      this.bands[i].setValues({
        threshold: values[`b${i}_threshold`] ?? -18,
        ratio: values[`b${i}_ratio`] ?? 3,
        attack: values[`b${i}_attack`] ?? 15,
        release: values[`b${i}_release`] ?? 140,
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
    this.xover.split(L, R, n, this.bufs);

    const hasExternalKey = this.sidechainL !== null && this.sidechainR !== null;
    if (hasExternalKey) {
      this.keyXover.split(this.sidechainL!, this.sidechainR!, n, this.keyBufs);
      this.bands[0].setSidechain(this.keyBufs.lowL, this.keyBufs.lowR);
      this.bands[1].setSidechain(this.keyBufs.midL, this.keyBufs.midR);
      this.bands[2].setSidechain(this.keyBufs.highL, this.keyBufs.highR);
    } else {
      // Explicitly clear every band key so a previously linked external source
      // cannot remain latched when the user switches back to internal detection.
      for (let i = 0; i < 3; i++) this.bands[i].setSidechain(null, null);
    }

    let anySolo = false;
    for (let i = 0; i < 3; i++) {
      if ((this.values[`b${i}_solo`] ?? 0) > 0.5) anySolo = true;
    }

    this.processBand(0, this.bufs.lowL, this.bufs.lowR, n);
    this.processBand(1, this.bufs.midL, this.bufs.midR, n);
    this.processBand(2, this.bufs.highL, this.bufs.highR, n);

    L.fill(0, 0, n);
    R.fill(0, 0, n);
    if (!anySolo || (this.values.b0_solo ?? 0) > 0.5) {
      this.sumBand(this.bufs.lowL, this.bufs.lowR, L, R, n);
    }
    if (!anySolo || (this.values.b1_solo ?? 0) > 0.5) {
      this.sumBand(this.bufs.midL, this.bufs.midR, L, R, n);
    }
    if (!anySolo || (this.values.b2_solo ?? 0) > 0.5) {
      this.sumBand(this.bufs.highL, this.bufs.highR, L, R, n);
    }

    const outputDb = this.values.output ?? 0;
    if (outputDb !== 0) {
      const gain = Math.pow(10, outputDb / 20);
      for (let i = 0; i < n; i++) {
        L[i] *= gain;
        R[i] *= gain;
      }
    }
  }

  private processBand(index: BandIndex, L: Float32Array, R: Float32Array, n: number): void {
    if ((this.values[`b${index}_on`] ?? 1) < 0.5) {
      this.bandReduction[index] = 0;
      return;
    }
    this.bands[index].process(L, R, n);
    this.bandReduction[index] = this.bands[index].gainReductionDb;
  }

  private sumBand(
    bandL: Float32Array,
    bandR: Float32Array,
    outputL: Float32Array,
    outputR: Float32Array,
    n: number,
  ): void {
    for (let i = 0; i < n; i++) {
      outputL[i] += bandL[i];
      outputR[i] += bandR[i];
    }
  }

  reset(): void {
    for (const band of this.bands) band.reset();
    this.xover.reset();
    this.keyXover.reset();
    this.bandReduction.fill(0);
  }

  meter(): ProcessorMeter {
    const maxReduction = Math.max(this.bandReduction[0], this.bandReduction[1], this.bandReduction[2]);
    return {
      reduction: maxReduction,
      bands: this.bandReduction.map((reduction) => -reduction),
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
    { key: `b${i}_style`, label: 'Character', kind: 'enum' as const, options: ['VCA', 'FET', 'Optical', 'Vari-mu', 'Bus'], default: 0, advanced: true, group },
    { key: `b${i}_link`, label: 'Stereo link', kind: 'float' as const, min: 0, max: 100, step: 1, default: 100, unit: '%', advanced: true, group },
  ];
}

export const multibandCompDefinition: ProcessorDefinition = {
  type: 'multibandComp',
  name: 'Multiband Compressor',
  shortName: 'MB COMP',
  category: 'dynamics',
  description: 'Three-band Linkwitz–Riley crossover with per-band compression, band-aware external keying, solo and independent stereo-link controls.',
  purpose: 'Controls low, mid and high-frequency dynamics separately while preserving the summed crossover response. Each band can use its own compressor settings and external sidechain frequency region.',
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
  const values: ParamValues = {};
  for (const param of multibandCompDefinition.params) values[param.key] = param.default;
  return { id, name, description, values: { ...values, ...overrides } };
}

/** Conservative, editable parameter snapshots — not automatic mastering recipes. */
export const MULTIBAND_COMP_PRESETS: MultibandPreset[] = [
  multibandPreset('low-end-control', 'Low-end control', 'Focuses gentle compression on the low band while leaving the mid and high bands nearly untouched.', {
    xLow: 160, xHigh: 4200,
    b0_threshold: -27, b0_ratio: 2.5, b0_attack: 28, b0_release: 180, b0_knee: 8, b0_link: 100,
    b1_threshold: -14, b1_ratio: 1.2, b1_attack: 25, b1_release: 180, b1_mix: 70,
    b2_threshold: -14, b2_ratio: 1.2, b2_attack: 20, b2_release: 160, b2_mix: 70,
  }),
  multibandPreset('gentle-glue', 'Gentle multiband glue', 'Light, broad control across all three bands with slow timing and full stereo linking.', {
    xLow: 180, xHigh: 5000,
    b0_threshold: -22, b0_ratio: 1.5, b0_attack: 35, b0_release: 220, b0_knee: 12,
    b1_threshold: -21, b1_ratio: 1.4, b1_attack: 28, b1_release: 190, b1_knee: 12,
    b2_threshold: -23, b2_ratio: 1.4, b2_attack: 20, b2_release: 160, b2_knee: 12,
  }),
  multibandPreset('presence-control', 'Presence control', 'Uses restrained upper-mid and high-band compression to soften occasional brightness without broadband gain reduction.', {
    xLow: 250, xHigh: 5200,
    b0_threshold: -12, b0_ratio: 1.2, b0_mix: 65,
    b1_threshold: -23, b1_ratio: 2.0, b1_attack: 8, b1_release: 110, b1_knee: 8,
    b2_threshold: -25, b2_ratio: 2.2, b2_attack: 5, b2_release: 90, b2_knee: 8,
  }),
  multibandPreset('dynamic-master', 'Dynamic master', 'A moderate starting point for controlling band-to-band energy while retaining transient movement.', {
    xLow: 140, xHigh: 4500,
    b0_threshold: -24, b0_ratio: 2.0, b0_attack: 35, b0_release: 220, b0_knee: 10,
    b1_threshold: -22, b1_ratio: 1.7, b1_attack: 22, b1_release: 160, b1_knee: 10,
    b2_threshold: -23, b2_ratio: 1.7, b2_attack: 12, b2_release: 130, b2_knee: 10,
  }),
];
