import { Biquad } from '../biquad';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain } from '../util';
import { shapeSample } from './saturation';

/**
 * Harmonic exciter: isolates a high band, generates controlled harmonics from
 * it, and mixes the result back. Unlike saturation it never distorts the low
 * end, which is why it is useful for adding air without muddying a mix.
 */
export class Exciter implements AudioProcessor {
  readonly type = 'exciter';
  readonly latency = 0;
  private sr = 48000;
  private values: ParamValues = {};
  private hpL = new Biquad();
  private hpR = new Biquad();
  private hpL2 = new Biquad();
  private hpR2 = new Biquad();
  private lowL = new Biquad();
  private lowR = new Biquad();
  private lowL2 = new Biquad();
  private lowR2 = new Biquad();
  private peakL = 0;
  private peakR = 0;
  private lastFreq = 0;

  prepare(sampleRate: number): void {
    this.sr = sampleRate;
    this.configure(valuesOr(this.values.frequency, 6000));
  }

  setValues(values: ParamValues): void {
    this.values = values;
    const f = valuesOr(values.frequency, 6000);
    if (Math.abs(f - this.lastFreq) > 2) this.configure(f);
  }

  private configure(freq: number): void {
    this.lastFreq = freq;
    for (const b of [this.hpL, this.hpR, this.hpL2, this.hpR2]) b.configure('highpass', freq, 0, 0.707, this.sr);
    for (const b of [this.lowL, this.lowR, this.lowL2, this.lowR2]) b.configure('lowpass', freq, 0, 0.707, this.sr);
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    const drive = dbToGain(this.values.drive ?? 6);
    const mix = clamp((this.values.mix ?? 30) / 100, 0, 1);
    const mode = Math.round(this.values.mode ?? 1);
    const out = dbToGain(this.values.output ?? 0);

    for (let i = 0; i < n; i++) {
      const lowL = this.lowL2.process(this.lowL.process(L[i]));
      const lowR = this.lowR2.process(this.lowR.process(R[i]));
      const highL = this.hpL2.process(this.hpL.process(L[i]));
      const highR = this.hpR2.process(this.hpR.process(R[i]));
      const shapedL = shapeSample(highL * drive, mode) / Math.max(1, drive * 0.5);
      const shapedR = shapeSample(highR * drive, mode) / Math.max(1, drive * 0.5);
      const excL = (shapedL - highL) * mix;
      const excR = (shapedR - highR) * mix;
      L[i] = (lowL + highL + excL) * out;
      R[i] = (lowR + highR + excR) * out;
      const al = Math.abs(L[i]);
      const ar = Math.abs(R[i]);
      if (al > this.peakL) this.peakL = al;
      if (ar > this.peakR) this.peakR = ar;
    }
    this.peakL *= 0.97;
    this.peakR *= 0.97;
  }

  reset(): void {
    for (const b of [this.hpL, this.hpR, this.hpL2, this.hpR2, this.lowL, this.lowR, this.lowL2, this.lowR2]) b.reset();
  }

  meter(): ProcessorMeter {
    return { peakL: this.peakL, peakR: this.peakR };
  }
}

function valuesOr(v: number | undefined, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

export const exciterDefinition: ProcessorDefinition = {
  type: 'exciter',
  name: 'Exciter',
  shortName: 'EXCITE',
  category: 'saturation',
  description: 'High-band harmonic generation with tunable crossover, drive and mix.',
  purpose: 'Adds air and detail above the vocal presence range without distorting the whole mix.',
  params: [
    { key: 'frequency', label: 'Crossover', kind: 'float', min: 2000, max: 14000, step: 10, default: 6000, unit: 'Hz', scale: 'log' },
    { key: 'drive', label: 'Drive', kind: 'float', min: 0, max: 24, step: 0.1, default: 6, unit: 'dB' },
    { key: 'mode', label: 'Style', kind: 'enum', options: ['Tape', 'Tube', 'Console', 'Soft clip', 'Wavefold'], default: 1 },
    { key: 'mix', label: 'Amount', kind: 'float', min: 0, max: 100, step: 1, default: 30, unit: '%' },
    { key: 'output', label: 'Output', kind: 'float', min: -12, max: 12, step: 0.1, default: 0, unit: 'dB' },
  ],
  create: () => new Exciter(),
};
