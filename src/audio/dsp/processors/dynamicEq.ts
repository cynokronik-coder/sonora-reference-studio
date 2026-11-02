import { Biquad, designBiquad } from '../biquad';
import { DbBallistics } from '../envelope';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, gainToDb } from '../util';

export const DYN_EQ_BANDS = 4;

interface DynBand {
  detector: Biquad;
  filterL: Biquad;
  filterR: Biquad;
  ballistics: DbBallistics;
  reduction: number;
  lastFreq: number;
  lastQ: number;
  lastGain: number;
}

/**
 * Dynamic EQ: a bell filter whose gain is driven by the level inside that band.
 * This is how you tame a resonant snare or a boomy room mode without statically
 * EQ-ing the whole mix. Each band has its own detector, threshold, range and
 * ballistics, and reports its instantaneous reduction for the UI.
 */
export class DynamicEq implements AudioProcessor {
  readonly type = 'dynamicEq';
  readonly latency = 0;
  private sr = 48000;
  private values: ParamValues = {};
  private bands: DynBand[] = [];
  private meterBands: number[] = [];

  constructor() {
    for (let i = 0; i < DYN_EQ_BANDS; i++) {
      this.bands.push({
        detector: new Biquad(),
        filterL: new Biquad(),
        filterR: new Biquad(),
        ballistics: new DbBallistics(48000, 5, 80),
        reduction: 0,
        lastFreq: 0,
        lastQ: 0,
        lastGain: 0,
      });
      this.meterBands.push(0);
    }
  }

  prepare(sampleRate: number): void {
    this.sr = sampleRate;
    for (const b of this.bands) b.ballistics = new DbBallistics(sampleRate, 5, 80);
    this.reset();
  }

  setValues(values: ParamValues): void {
    this.values = values;
  }

  private num(key: string, fallback: number): number {
    const v = this.values[key];
    return typeof v === 'number' ? v : fallback;
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    for (let i = 0; i < DYN_EQ_BANDS; i++) {
      const on = this.num(`b${i}_on`, 0) > 0.5;
      if (!on) {
        this.meterBands[i] = 0;
        continue;
      }
      const freq = this.num(`b${i}_freq`, [120, 400, 2500, 7000][i]);
      const q = Math.max(0.3, this.num(`b${i}_q`, 1.4));
      const threshold = this.num(`b${i}_threshold`, -30);
      const range = Math.max(0, this.num(`b${i}_range`, 6));
      const attack = this.num(`b${i}_attack`, 8);
      const release = this.num(`b${i}_release`, 120);
      const band = this.bands[i];

      band.ballistics.setTimes(attack, release, this.sr);
      band.detector.configure('bandpass', freq, 0, q, this.sr);

      let maxReduction = 0;
      for (let s = 0; s < n; s++) {
        const key = Math.max(Math.abs(L[s]), Math.abs(R[s]));
        const detected = Math.abs(band.detector.process(key)) * 2;
        const levelDb = gainToDb(Math.max(detected, 1e-7));
        const over = levelDb - threshold;
        const target = over > 0 ? Math.min(range, over * (1 - 1 / 4)) : 0;
        band.reduction = band.ballistics.process(target);
        if (band.reduction > maxReduction) maxReduction = band.reduction;

        const gainDb = -band.reduction;
        if (
          Math.abs(gainDb - band.lastGain) > 0.01 ||
          Math.abs(freq - band.lastFreq) > 0.5 ||
          Math.abs(q - band.lastQ) > 0.005
        ) {
          const c = designBiquad('peak', freq, gainDb, q, this.sr);
          band.filterL.set(c);
          band.filterR.set(c);
          band.lastGain = gainDb;
          band.lastFreq = freq;
          band.lastQ = q;
        }
        L[s] = band.filterL.process(L[s]);
        R[s] = band.filterR.process(R[s]);
      }
      this.meterBands[i] = maxReduction;
    }
    const out = this.num('output', 0);
    if (out !== 0) {
      const g = Math.pow(10, out / 20);
      for (let i = 0; i < n; i++) {
        L[i] *= g;
        R[i] *= g;
      }
    }
  }

  reset(): void {
    for (const b of this.bands) {
      b.detector.reset();
      b.filterL.reset();
      b.filterR.reset();
      b.ballistics.reset();
      b.reduction = 0;
    }
  }

  meter(): ProcessorMeter {
    return { bands: this.meterBands.map((v) => -v) };
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
  ];
}

export const dynamicEqDefinition: ProcessorDefinition = {
  type: 'dynamicEq',
  name: 'Dynamic EQ',
  shortName: 'DYN EQ',
  category: 'eq',
  description: 'Band-specific dynamic gain reduction driven by level inside the band.',
  purpose: 'Controls resonances and boomy or harsh notes only when they occur, leaving the rest of the mix untouched.',
  params: [
    ...bandObject(0), ...bandObject(1), ...bandObject(2), ...bandObject(3),
    { key: 'output', label: 'Output', kind: 'float', min: -18, max: 18, step: 0.1, default: 0, unit: 'dB', group: 'Output' },
  ],
  create: () => new DynamicEq(),
};

void clamp;
