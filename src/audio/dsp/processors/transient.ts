import { EnvelopeFollower } from '../envelope';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp } from '../util';

/**
 * Transient shaper. A fast envelope and a slow envelope are compared; the
 * difference drives attack (transient) gain while the slow envelope drives
 * sustain (body) gain. This is a real envelope-differential design, not a
 * volume automation curve.
 */
export class TransientShaper implements AudioProcessor {
  readonly type = 'transient';
  readonly latency = 0;
  private sr = 48000;
  private values: ParamValues = {};
  private fastL = new EnvelopeFollower(48000, 0.4, 30);
  private fastR = new EnvelopeFollower(48000, 0.4, 30);
  private slowL = new EnvelopeFollower(48000, 25, 180);
  private slowR = new EnvelopeFollower(48000, 25, 180);
  private gainL = 1;
  private gainR = 1;
  private peakL = 0;
  private peakR = 0;

  prepare(sampleRate: number): void {
    this.sr = sampleRate;
    this.fastL = new EnvelopeFollower(sampleRate, 0.4, 30);
    this.fastR = new EnvelopeFollower(sampleRate, 0.4, 30);
    this.slowL = new EnvelopeFollower(sampleRate, 25, 180);
    this.slowR = new EnvelopeFollower(sampleRate, 25, 180);
  }

  setValues(values: ParamValues): void {
    this.values = values;
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    const attack = clamp((this.values.attack ?? 0) / 100, -1, 1);
    const sustain = clamp((this.values.sustain ?? 0) / 100, -1, 1);
    const sensitivity = clamp((this.values.sensitivity ?? 50) / 100, 0.05, 1);
    const mix = clamp((this.values.mix ?? 100) / 100, 0, 1);
    const out = Math.pow(10, (this.values.output ?? 0) / 20);
    const smooth = 1 - Math.exp(-1 / (0.004 * this.sr));

    for (let i = 0; i < n; i++) {
      const xl = L[i];
      const xr = R[i];
      const fast = Math.max(this.fastL.process(xl), this.fastR.process(xr));
      const slow = Math.max(this.slowL.process(xl), this.slowR.process(xr));
      const transient = Math.max(0, fast - slow * (1 - sensitivity * 0.3));
      const body = slow;
      const ref = fast + 1e-6;
      const attackGain = 1 + attack * (transient / ref) * 2;
      const sustainGain = 1 + sustain * (body / (body + 0.02)) * 0.8;
      const target = clamp(attackGain * sustainGain, 0.05, 8);
      this.gainL += (target - this.gainL) * smooth;
      this.gainR = this.gainL;
      const wetL = xl * this.gainL * out;
      const wetR = xr * this.gainR * out;
      L[i] = xl + (wetL - xl) * mix;
      R[i] = xr + (wetR - xr) * mix;
      const al = Math.abs(L[i]);
      const ar = Math.abs(R[i]);
      if (al > this.peakL) this.peakL = al;
      if (ar > this.peakR) this.peakR = ar;
    }
    this.peakL *= 0.97;
    this.peakR *= 0.97;
  }

  reset(): void {
    this.fastL.reset(); this.fastR.reset();
    this.slowL.reset(); this.slowR.reset();
    this.gainL = 1; this.gainR = 1;
  }

  meter(): ProcessorMeter {
    return { peakL: this.peakL, peakR: this.peakR, gain: this.gainL };
  }
}

export const transientDefinition: ProcessorDefinition = {
  type: 'transient',
  name: 'Transient Shaper',
  shortName: 'TRANSIENT',
  category: 'dynamics',
  description: 'Envelope-differential attack and sustain shaping with sensitivity control.',
  purpose: 'Adds punch to drums or softens pick noise and plucks without changing the overall level.',
  params: [
    { key: 'attack', label: 'Attack', kind: 'float', min: -100, max: 100, step: 1, default: 0, unit: '%' },
    { key: 'sustain', label: 'Sustain', kind: 'float', min: -100, max: 100, step: 1, default: 0, unit: '%' },
    { key: 'sensitivity', label: 'Sensitivity', kind: 'float', min: 0, max: 100, step: 1, default: 50, unit: '%', advanced: true },
    { key: 'mix', label: 'Dry/wet', kind: 'float', min: 0, max: 100, step: 1, default: 100, unit: '%' },
    { key: 'output', label: 'Output', kind: 'float', min: -18, max: 18, step: 0.1, default: 0, unit: 'dB' },
  ],
  create: () => new TransientShaper(),
};
