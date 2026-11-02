import { Biquad } from '../biquad';
import { DbBallistics } from '../envelope';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain, gainToDb } from '../util';

/**
 * Split-band de-esser. The high band above `frequency` is detected and
 * dynamically attenuated; the low band always passes untouched. Wideband mode
 * applies the same reduction to the full signal for very sibilant material.
 */
export class DeEsser implements AudioProcessor {
  readonly type = 'deesser';
  readonly latency = 0;
  private sr = 48000;
  private values: ParamValues = {};
  private hpL = new Biquad();
  private hpR = new Biquad();
  private hpL2 = new Biquad();
  private hpR2 = new Biquad();
  private lpL = new Biquad();
  private lpR = new Biquad();
  private lpL2 = new Biquad();
  private lpR2 = new Biquad();
  private ballistics = new DbBallistics(48000, 1, 60);
  private reduction = 0;
  private lastFreq = 0;

  prepare(sampleRate: number): void {
    this.sr = sampleRate;
    this.ballistics = new DbBallistics(sampleRate, 0.5, 60);
    this.configure(6000);
  }

  setValues(values: ParamValues): void {
    this.values = values;
    const freq = clamp(values.frequency ?? 6500, 2500, this.sr * 0.45);
    if (Math.abs(freq - this.lastFreq) > 1) this.configure(freq);
    this.ballistics.setTimes(values.attack ?? 0.5, values.release ?? 60, this.sr);
  }

  private configure(freq: number): void {
    this.lastFreq = freq;
    this.hpL.configure('highpass', freq, 0, 0.7071, this.sr);
    this.hpR.configure('highpass', freq, 0, 0.7071, this.sr);
    this.hpL2.configure('highpass', freq, 0, 0.7071, this.sr);
    this.hpR2.configure('highpass', freq, 0, 0.7071, this.sr);
    this.lpL.configure('lowpass', freq, 0, 0.7071, this.sr);
    this.lpR.configure('lowpass', freq, 0, 0.7071, this.sr);
    this.lpL2.configure('lowpass', freq, 0, 0.7071, this.sr);
    this.lpR2.configure('lowpass', freq, 0, 0.7071, this.sr);
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    const threshold = this.values.threshold ?? -28;
    const range = Math.max(0, this.values.range ?? 8);
    const wideband = (this.values.mode ?? 0) > 0.5;
    let maxReduction = 0;

    for (let i = 0; i < n; i++) {
      const l = L[i];
      const r = R[i];
      const lowL = this.lpL2.process(this.lpL.process(l));
      const lowR = this.lpR2.process(this.lpR.process(r));
      const highL = this.hpL2.process(this.hpL.process(l));
      const highR = this.hpR2.process(this.hpR.process(r));

      const detect = Math.max(Math.abs(highL), Math.abs(highR));
      const levelDb = gainToDb(Math.max(detect, 1e-7));
      const over = levelDb - threshold;
      const target = over > 0 ? Math.min(range, over * 0.8) : 0;
      const reduction = this.ballistics.process(target);
      if (reduction > maxReduction) maxReduction = reduction;
      const gain = dbToGain(-reduction);

      if (wideband) {
        L[i] = (lowL + highL) * gain;
        R[i] = (lowR + highR) * gain;
      } else {
        L[i] = lowL + highL * gain;
        R[i] = lowR + highR * gain;
      }
    }
    this.reduction = maxReduction;
  }

  reset(): void {
    this.hpL.reset(); this.hpR.reset(); this.hpL2.reset(); this.hpR2.reset();
    this.lpL.reset(); this.lpR.reset(); this.lpL2.reset(); this.lpR2.reset();
    this.ballistics.reset();
    this.reduction = 0;
  }

  meter(): ProcessorMeter {
    return { reduction: this.reduction };
  }
}

export const deEsserDefinition: ProcessorDefinition = {
  type: 'deesser',
  name: 'De-esser',
  shortName: 'DE-ESS',
  category: 'vocal',
  description: 'Split-band sibilance control above a tunable frequency, with wideband option.',
  purpose: 'Removes harsh "sss" and "tss" sounds that make vocals painful at loud mastering levels.',
  params: [
    { key: 'frequency', label: 'Frequency', kind: 'float', min: 2500, max: 12000, step: 10, default: 6500, unit: 'Hz', scale: 'log' },
    { key: 'threshold', label: 'Threshold', kind: 'float', min: -60, max: 0, step: 0.5, default: -28, unit: 'dB' },
    { key: 'range', label: 'Max reduction', kind: 'float', min: 0, max: 18, step: 0.1, default: 8, unit: 'dB' },
    { key: 'attack', label: 'Attack', kind: 'float', min: 0.1, max: 20, step: 0.1, default: 0.5, unit: 'ms', advanced: true },
    { key: 'release', label: 'Release', kind: 'float', min: 10, max: 500, step: 1, default: 60, unit: 'ms', advanced: true },
    { key: 'mode', label: 'Mode', kind: 'enum', options: ['Split band', 'Wideband'], default: 0 },
  ],
  create: () => new DeEsser(),
};
