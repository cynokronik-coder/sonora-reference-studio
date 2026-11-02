import { Biquad } from '../biquad';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain } from '../util';

export const DELAY_MODES = ['Stereo', 'Ping-pong', 'Slapback', 'Multi-tap'] as const;
export const NOTE_VALUES = ['1/32', '1/16T', '1/16', '1/8T', '1/8', '1/4T', '1/4', '1/2'] as const;
const NOTE_BEATS = [0.125, 1 / 6, 0.25, 1 / 3, 0.5, 2 / 3, 1, 2];

/** Stereo delay with sync, ping-pong, slapback and multi-tap modes. */
export class Delay implements AudioProcessor {
  readonly type = 'delay';
  readonly latency = 0;
  private sr = 48000;
  private values: ParamValues = {};
  private bufL = new Float32Array(0);
  private bufR = new Float32Array(0);
  private index = 0;
  private dampL = new Biquad();
  private dampR = new Biquad();
  private hpL = new Biquad();
  private hpR = new Biquad();
  private peakL = 0;
  private peakR = 0;

  prepare(sampleRate: number): void {
    this.sr = sampleRate;
    const len = Math.ceil(sampleRate * 3);
    this.bufL = new Float32Array(len);
    this.bufR = new Float32Array(len);
    this.index = 0;
    this.dampL.configure('lowpass', 6000, 0, 0.707, sampleRate);
    this.dampR.configure('lowpass', 6000, 0, 0.707, sampleRate);
    this.hpL.configure('highpass', 120, 0, 0.707, sampleRate);
    this.hpR.configure('highpass', 120, 0, 0.707, sampleRate);
  }

  setValues(values: ParamValues): void {
    this.values = values;
  }

  private timeSamples(): number {
    const sync = (this.values.sync ?? 1) > 0.5;
    let ms = this.values.time ?? 350;
    if (sync) {
      const note = Math.round(this.values.note ?? 4);
      const bpm = clamp(this.values.bpm ?? 120, 40, 300);
      ms = (NOTE_BEATS[clamp(note, 0, NOTE_BEATS.length - 1)] * 60000) / bpm;
    }
    return Math.round(clamp(ms, 1, 2900) * 0.001 * this.sr);
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    const mode = Math.round(this.values.mode ?? 0);
    const base = this.timeSamples();
    const feedback = clamp((this.values.feedback ?? 35) / 100, 0, 0.95);
    const damp = clamp(this.values.damping ?? 5000, 500, 20000);
    const highpass = clamp(this.values.highpass ?? 120, 20, 2000);
    const mix = clamp((this.values.mix ?? 25) / 100, 0, 1);
    const width = clamp((this.values.width ?? 100) / 100, 0, 1.5);
    const out = dbToGain(this.values.output ?? 0);
    this.dampL.configure('lowpass', damp, 0, 0.707, this.sr);
    this.dampR.configure('lowpass', damp, 0, 0.707, this.sr);
    this.hpL.configure('highpass', highpass, 0, 0.707, this.sr);
    this.hpR.configure('highpass', highpass, 0, 0.707, this.sr);
    const len = this.bufL.length;

    for (let i = 0; i < n; i++) {
      const dryL = L[i];
      const dryR = R[i];
      let readL1 = this.index - base;
      let readR1 = this.index - (mode === 1 ? base * 1.5 : base);
      let readL2 = this.index - base * 2;
      let readR2 = this.index - base * 3;
      if (readL1 < 0) readL1 += len;
      if (readR1 < 0) readR1 += len;
      if (readL2 < 0) readL2 += len;
      if (readR2 < 0) readR2 += len;

      const tapL = this.bufL[readL1];
      const tapR = this.bufR[readR1];
      let fbL: number;
      let fbR: number;
      let wetL: number;
      let wetR: number;

      if (mode === 1) {
        // Ping-pong: feedback crosses channels.
        fbL = tapR * feedback;
        fbR = tapL * feedback;
        wetL = tapR;
        wetR = tapL;
      } else if (mode === 2) {
        // Slapback: single short tap, minimal feedback.
        fbL = tapL * feedback * 0.3;
        fbR = tapR * feedback * 0.3;
        wetL = dryL * 0.2 + tapL;
        wetR = dryR * 0.2 + tapR;
      } else if (mode === 3) {
        // Multi-tap: three taps with decreasing gain.
        const t2L = this.bufL[readL2];
        const t2R = this.bufR[readL2];
        const t3L = this.bufL[readR2];
        const t3R = this.bufR[readR2];
        fbL = tapL * feedback;
        fbR = tapR * feedback;
        wetL = tapL + t2L * 0.6 + t3L * 0.35;
        wetR = tapR + t2R * 0.6 + t3R * 0.35;
      } else {
        fbL = tapL * feedback;
        fbR = tapR * feedback;
        wetL = tapL;
        wetR = tapR;
      }

      const filteredL = this.hpL.process(this.dampL.process(fbL));
      const filteredR = this.hpR.process(this.dampR.process(fbR));
      this.bufL[this.index] = dryL + filteredL;
      this.bufR[this.index] = dryR + filteredR;

      const mid = (wetL + wetR) * 0.5;
      const side = (wetL - wetR) * 0.5 * width;
      const wl = mid + side;
      const wr = mid - side;
      L[i] = (dryL * (1 - mix) + wl * mix) * out;
      R[i] = (dryR * (1 - mix) + wr * mix) * out;
      this.index = (this.index + 1) % len;
      const al = Math.abs(L[i]);
      const ar = Math.abs(R[i]);
      if (al > this.peakL) this.peakL = al;
      if (ar > this.peakR) this.peakR = ar;
    }
    this.peakL *= 0.97;
    this.peakR *= 0.97;
  }

  reset(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
    this.index = 0;
    this.dampL.reset(); this.dampR.reset(); this.hpL.reset(); this.hpR.reset();
  }

  meter(): ProcessorMeter {
    return { peakL: this.peakL, peakR: this.peakR };
  }
}

export const delayDefinition: ProcessorDefinition = {
  type: 'delay',
  name: 'Delay',
  shortName: 'DELAY',
  category: 'time',
  description: 'Tempo-syncable stereo delay with ping-pong, slapback and multi-tap modes, damping and filtering.',
  purpose: 'Creates depth and rhythmic space. Delay feedback and time are fully automatable.',
  params: [
    { key: 'mode', label: 'Mode', kind: 'enum', options: [...DELAY_MODES], default: 0 },
    { key: 'sync', label: 'Tempo sync', kind: 'bool', default: 1 },
    { key: 'note', label: 'Note value', kind: 'enum', options: [...NOTE_VALUES], default: 4 },
    { key: 'time', label: 'Time', kind: 'float', min: 10, max: 2000, step: 1, default: 350, unit: 'ms' },
    { key: 'bpm', label: 'Tempo', kind: 'float', min: 40, max: 300, step: 1, default: 120, unit: 'BPM', advanced: true },
    { key: 'feedback', label: 'Feedback', kind: 'float', min: 0, max: 95, step: 1, default: 35, unit: '%' },
    { key: 'damping', label: 'Damping', kind: 'float', min: 500, max: 20000, step: 10, default: 5000, unit: 'Hz', scale: 'log' },
    { key: 'highpass', label: 'High pass', kind: 'float', min: 20, max: 2000, step: 1, default: 120, unit: 'Hz', scale: 'log', advanced: true },
    { key: 'width', label: 'Width', kind: 'float', min: 0, max: 150, step: 1, default: 100, unit: '%' },
    { key: 'mix', label: 'Wet mix', kind: 'float', min: 0, max: 100, step: 1, default: 25, unit: '%' },
    { key: 'output', label: 'Output', kind: 'float', min: -12, max: 12, step: 0.1, default: 0, unit: 'dB' },
  ],
  create: () => new Delay(),
};
