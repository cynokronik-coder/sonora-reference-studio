import { Lr4Crossover } from '../crossover';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { Compressor } from './compressor';

const BAND_NAMES = ['Low', 'Mid', 'High'];

/**
 * Three-band compressor built from the tested single-band compressor.
 * Each band has independent threshold, ratio, attack, release and makeup, and
 * the bands are summed after compression. Crossovers are LR4, so an untouched
 * band sums back to the original signal.
 */
export class MultibandCompressor implements AudioProcessor {
  readonly type = 'multibandComp';
  readonly latency = 0;
  private sr = 48000;
  private maxBlock = 512;
  private values: ParamValues = {};
  private xover = new Lr4Crossover(48000);
  private bands: Compressor[] = [];
  private bufs = {
    lowL: new Float32Array(512),
    lowR: new Float32Array(512),
    midL: new Float32Array(512),
    midR: new Float32Array(512),
    highL: new Float32Array(512),
    highR: new Float32Array(512),
  };
  private bandReduction = [0, 0, 0];

  constructor() {
    for (let i = 0; i < 3; i++) this.bands.push(new Compressor());
  }

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = sampleRate;
    this.maxBlock = maxBlock;
    this.xover.prepare(sampleRate, maxBlock);
    for (const band of this.bands) band.prepare(sampleRate, maxBlock);
    const size = maxBlock;
    this.bufs = {
      lowL: new Float32Array(size), lowR: new Float32Array(size),
      midL: new Float32Array(size), midR: new Float32Array(size),
      highL: new Float32Array(size), highR: new Float32Array(size),
    };
  }

  setSidechain(L: Float32Array | null, R: Float32Array | null): void {
    for (const band of this.bands) band.setSidechain(L, R);
  }

  setValues(values: ParamValues): void {
    this.values = values;
    this.xover.configure(this.sr, values.xLow ?? 200, values.xHigh ?? 4000);
    for (let i = 0; i < 3; i++) {
      this.bands[i].setValues({
        threshold: values[`b${i}_threshold`] ?? -18,
        ratio: values[`b${i}_ratio`] ?? 3,
        attack: values[`b${i}_attack`] ?? 15,
        release: values[`b${i}_release`] ?? 140,
        knee: values[`b${i}_knee`] ?? 6,
        style: values[`b${i}_style`] ?? 0,
        scHpf: 20,
        link: 100,
        makeup: values[`b${i}_makeup`] ?? 0,
        mix: values[`b${i}_mix`] ?? 100,
        lookahead: 0,
        autoMakeup: 0,
      });
    }
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    this.xover.split(L, R, n, this.bufs);
    const bands = [this.bufs.lowL, this.bufs.midL, this.bufs.highL];
    const bandsR = [this.bufs.lowR, this.bufs.midR, this.bufs.highR];
    for (let i = 0; i < 3; i++) {
      if ((this.values[`b${i}_on`] ?? 1) < 0.5) {
        this.bandReduction[i] = 0;
        continue;
      }
      this.bands[i].process(bands[i], bandsR[i], n);
      this.bandReduction[i] = this.bands[i].meter().reduction ?? 0;
    }
    L.fill(0, 0, n);
    R.fill(0, 0, n);
    for (let i = 0; i < 3; i++) {
      const bl = bands[i];
      const br = bandsR[i];
      for (let s = 0; s < n; s++) {
        L[s] += bl[s];
        R[s] += br[s];
      }
    }
    const out = this.values.output ?? 0;
    if (out !== 0) {
      const g = Math.pow(10, out / 20);
      for (let i = 0; i < n; i++) {
        L[i] *= g;
        R[i] *= g;
      }
    }
  }

  reset(): void {
    for (const band of this.bands) band.reset();
    this.xover.reset();
  }

  meter(): ProcessorMeter {
    return { bands: this.bandReduction.map((r) => -r) };
  }
}

function bandParams(i: number) {
  const g = `${BAND_NAMES[i]} band`;
  return [
    { key: `b${i}_on`, label: 'Enabled', kind: 'bool' as const, default: 1, group: g },
    { key: `b${i}_threshold`, label: 'Threshold', kind: 'float' as const, min: -60, max: 0, step: 0.1, default: [-22, -20, -24][i], unit: 'dB', group: g },
    { key: `b${i}_ratio`, label: 'Ratio', kind: 'float' as const, min: 1, max: 20, step: 0.1, default: 2.5, unit: ':1', group: g },
    { key: `b${i}_attack`, label: 'Attack', kind: 'float' as const, min: 0.1, max: 200, step: 0.1, default: [20, 15, 8][i], unit: 'ms', group: g },
    { key: `b${i}_release`, label: 'Release', kind: 'float' as const, min: 10, max: 2000, step: 1, default: [180, 140, 100][i], unit: 'ms', group: g },
    { key: `b${i}_knee`, label: 'Knee', kind: 'float' as const, min: 0, max: 24, step: 0.1, default: 6, unit: 'dB', group: g },
    { key: `b${i}_makeup`, label: 'Makeup', kind: 'float' as const, min: -12, max: 24, step: 0.1, default: 0, unit: 'dB', group: g },
    { key: `b${i}_mix`, label: 'Dry/wet', kind: 'float' as const, min: 0, max: 100, step: 1, default: 100, unit: '%', advanced: true, group: g },
    { key: `b${i}_style`, label: 'Character', kind: 'enum' as const, options: ['VCA', 'FET', 'Optical', 'Vari-mu', 'Bus'], default: 0, advanced: true, group: g },
  ];
}

export const multibandCompDefinition: ProcessorDefinition = {
  type: 'multibandComp',
  name: 'Multiband Compressor',
  shortName: 'MB COMP',
  category: 'dynamics',
  description: 'Three-band compressor with LR4 crossovers and independent dynamics per band.',
  purpose: 'Controls the low end without pumping the whole mix, and tames harsh mids without dulling the top.',
  params: [
    { key: 'xLow', label: 'Low / mid split', kind: 'float', min: 40, max: 600, step: 1, default: 200, unit: 'Hz', scale: 'log', group: 'Crossovers' },
    { key: 'xHigh', label: 'Mid / high split', kind: 'float', min: 800, max: 12000, step: 1, default: 4000, unit: 'Hz', scale: 'log', group: 'Crossovers' },
    ...bandParams(0), ...bandParams(1), ...bandParams(2),
    { key: 'output', label: 'Output', kind: 'float', min: -18, max: 18, step: 0.1, default: 0, unit: 'dB', group: 'Output' },
  ],
  create: () => new MultibandCompressor(),
};
