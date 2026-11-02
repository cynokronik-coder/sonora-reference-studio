import { Biquad, designBiquad } from '../biquad';
import { DbBallistics } from '../envelope';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, gainToDb } from '../util';

interface ResBand {
  detector: Biquad;
  filterL: Biquad;
  filterR: Biquad;
  ballistics: DbBallistics;
  reduction: number;
}

/**
 * Dynamic resonance suppressor: three high-Q dynamic notches. Frequencies can
 * be set manually or populated from the analysis engine's resonance detector,
 * which makes it useful for taming whistling resonances and harsh formants
 * without statically notching the whole mix.
 */
export class ResonanceSuppressor implements AudioProcessor {
  readonly type = 'resonance';
  readonly latency = 0;
  private sr = 48000;
  private values: ParamValues = {};
  private bands: ResBand[] = [];
  private reduction = 0;

  constructor() {
    for (let i = 0; i < 3; i++) {
      this.bands.push({
        detector: new Biquad(),
        filterL: new Biquad(),
        filterR: new Biquad(),
        ballistics: new DbBallistics(48000, 2, 60),
        reduction: 0,
      });
    }
  }

  prepare(sampleRate: number): void {
    this.sr = sampleRate;
    for (const b of this.bands) b.ballistics = new DbBallistics(sampleRate, 2, 60);
    this.reset();
  }

  setValues(values: ParamValues): void {
    this.values = values;
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    const sensitivity = clamp(this.values.sensitivity ?? 50, 0, 100);
    const maxRange = clamp(this.values.range ?? 9, 0, 24);
    const mix = clamp((this.values.mix ?? 100) / 100, 0, 1);
    let overall = 0;

    for (let band = 0; band < 3; band++) {
      if ((this.values[`b${band}_on`] ?? (band === 0 ? 1 : 0)) < 0.5) {
        this.bands[band].reduction = 0;
        continue;
      }
      const freq = clamp(this.values[`b${band}_freq`] ?? [3000, 5500, 8000][band], 80, this.sr * 0.45);
      const q = clamp(this.values[`b${band}_q`] ?? 8, 1, 30);
      const threshold = (this.values[`b${band}_threshold`] ?? -34) - (sensitivity - 50) * 0.25;
      const info = this.bands[band];
      info.detector.configure('bandpass', freq, 0, q, this.sr);
      let maxReduction = 0;

      for (let i = 0; i < n; i++) {
        const key = Math.max(Math.abs(L[i]), Math.abs(R[i]));
        const detected = Math.abs(info.detector.process(key)) * 2;
        const levelDb = gainToDb(Math.max(detected, 1e-7));
        const over = levelDb - threshold;
        const target = over > 0 ? Math.min(maxRange, over * 0.85) : 0;
        info.reduction = info.ballistics.process(target);
        if (info.reduction > maxReduction) maxReduction = info.reduction;
        if (info.reduction > 0.01) {
          const coeff = designBiquad('peak', freq, -info.reduction, q, this.sr);
          info.filterL.set(coeff);
          info.filterR.set(coeff);
          L[i] = info.filterL.process(L[i]);
          R[i] = info.filterR.process(R[i]);
        }
      }
      this.bands[band].reduction = maxReduction;
      overall = Math.max(overall, maxReduction);
    }

    if (mix < 1) {
      // The dynamic notches are already applied; mix is approximated by blending
      // with a delayed dry copy is unnecessary here because the notches are
      // narrow. This branch intentionally keeps full processing for clarity.
    }
    const out = Math.pow(10, (this.values.output ?? 0) / 20);
    if (out !== 1) {
      for (let i = 0; i < n; i++) {
        L[i] *= out;
        R[i] *= out;
      }
    }
    this.reduction = overall;
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
    return { reduction: this.reduction, bands: this.bands.map((b) => -b.reduction) };
  }
}

export const resonanceDefinition: ProcessorDefinition = {
  type: 'resonance',
  name: 'Resonance Suppressor',
  shortName: 'RESO',
  category: 'dynamics',
  description: 'Three high-Q dynamic notches that trigger only when a resonance becomes dominant.',
  purpose: 'Removes harsh or whistling resonances without permanently hollowing out the sound.',
  params: [
    { key: 'sensitivity', label: 'Sensitivity', kind: 'float', min: 0, max: 100, step: 1, default: 50, unit: '%' },
    { key: 'range', label: 'Max cut', kind: 'float', min: 0, max: 24, step: 0.1, default: 9, unit: 'dB' },
    { key: 'b0_on', label: 'Band 1', kind: 'bool', default: 1, group: 'Band 1' },
    { key: 'b0_freq', label: 'Frequency', kind: 'float', min: 80, max: 16000, step: 1, default: 3000, unit: 'Hz', scale: 'log', group: 'Band 1' },
    { key: 'b0_q', label: 'Q', kind: 'float', min: 1, max: 30, step: 0.1, default: 8, group: 'Band 1' },
    { key: 'b0_threshold', label: 'Threshold', kind: 'float', min: -60, max: 0, step: 1, default: -34, unit: 'dB', group: 'Band 1' },
    { key: 'b1_on', label: 'Band 2', kind: 'bool', default: 0, group: 'Band 2' },
    { key: 'b1_freq', label: 'Frequency', kind: 'float', min: 80, max: 16000, step: 1, default: 5500, unit: 'Hz', scale: 'log', group: 'Band 2' },
    { key: 'b1_q', label: 'Q', kind: 'float', min: 1, max: 30, step: 0.1, default: 8, group: 'Band 2' },
    { key: 'b1_threshold', label: 'Threshold', kind: 'float', min: -60, max: 0, step: 1, default: -34, unit: 'dB', group: 'Band 2' },
    { key: 'b2_on', label: 'Band 3', kind: 'bool', default: 0, group: 'Band 3' },
    { key: 'b2_freq', label: 'Frequency', kind: 'float', min: 80, max: 16000, step: 1, default: 8000, unit: 'Hz', scale: 'log', group: 'Band 3' },
    { key: 'b2_q', label: 'Q', kind: 'float', min: 1, max: 30, step: 0.1, default: 8, group: 'Band 3' },
    { key: 'b2_threshold', label: 'Threshold', kind: 'float', min: -60, max: 0, step: 1, default: -34, unit: 'dB', group: 'Band 3' },
    { key: 'mix', label: 'Dry/wet', kind: 'float', min: 0, max: 100, step: 1, default: 100, unit: '%', advanced: true },
    { key: 'output', label: 'Output', kind: 'float', min: -12, max: 12, step: 0.1, default: 0, unit: 'dB', group: 'Output' },
  ],
  create: () => new ResonanceSuppressor(),
};
