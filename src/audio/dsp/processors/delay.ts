import { Biquad, designBiquad } from '../biquad';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain } from '../util';

export const DELAY_MODES = ['Stereo', 'Ping-pong', 'Slapback', 'Multi-tap'] as const;
export const NOTE_VALUES = ['1/32', '1/16T', '1/16', '1/8T', '1/8', '1/4T', '1/4', '1/2'] as const;
const NOTE_BEATS = [0.125, 1 / 6, 0.25, 1 / 3, 0.5, 2 / 3, 1, 2];
const CONTROL_RAMP_MS = 20;
const MAX_SINGLE_DELAY_SECONDS = 3;
const MAX_MULTI_TAP_SECONDS = MAX_SINGLE_DELAY_SECONDS * 3;

export interface DelayPreset {
  id: string;
  name: string;
  description: string;
  values: ParamValues;
}

interface Ramp {
  step: number;
  remaining: number;
}

/**
 * Stereo tempo delay with stereo, ping-pong, slapback and three-tap modes.
 *
 * The maximum base delay is 3 seconds and the three-tap mode can read at
 * 1x/2x/3x that time, so the preallocated ring supports up to 9 seconds.
 * Fractional linear interpolation lets tap timing move without sample jumps.
 * Feedback is bounded below unity and tone filters operate in the feedback
 * path, with independent L/R state and smoothed coefficient changes.
 */
export class Delay implements AudioProcessor {
  readonly type = 'delay';
  readonly latency = 0;
  private sr = 48000;
  private maxBlock = 512;
  private values: ParamValues = {};
  private bufL = new Float32Array(0);
  private bufR = new Float32Array(0);
  private index = 0;
  private dampL = new Biquad();
  private dampR = new Biquad();
  private hpL = new Biquad();
  private hpR = new Biquad();
  private lastDamping = Number.NaN;
  private lastHighpass = Number.NaN;

  private delaySamples = 16_800;
  private delayTarget = 16_800;
  private delayStep = 0;
  private delayRemaining = 0;
  private feedback = 0.35;
  private feedbackTarget = 0.35;
  private feedbackStep = 0;
  private feedbackRemaining = 0;
  private width = 1;
  private widthTarget = 1;
  private widthStep = 0;
  private widthRemaining = 0;
  private mix = 0.25;
  private mixTarget = 0.25;
  private mixStep = 0;
  private mixRemaining = 0;
  private output = 1;
  private outputTarget = 1;
  private outputStep = 0;
  private outputRemaining = 0;
  private peakL = 0;
  private peakR = 0;
  private hasProcessed = false;

  prepare(sampleRate: number, maxBlock = 512): void {
    this.sr = sampleRate;
    this.maxBlock = Math.max(1, maxBlock);
    const capacity = Math.ceil(sampleRate * MAX_MULTI_TAP_SECONDS) + 2;
    this.bufL = new Float32Array(capacity);
    this.bufR = new Float32Array(capacity);
    this.index = 0;
    this.configureToneFilters(5000, 120, true);
    this.reset();
    this.setValues(this.values);
  }

  private ramp(current: number, target: number): Ramp {
    const remaining = Math.max(1, Math.round(this.sr * CONTROL_RAMP_MS / 1000));
    return { remaining, step: (target - current) / remaining };
  }

  private setRamp(kind: 'delay' | 'feedback' | 'width' | 'mix' | 'output', current: number, target: number): void {
    const r = this.ramp(current, target);
    switch (kind) {
      case 'delay': this.delayTarget = target; this.delayStep = r.step; this.delayRemaining = r.remaining; break;
      case 'feedback': this.feedbackTarget = target; this.feedbackStep = r.step; this.feedbackRemaining = r.remaining; break;
      case 'width': this.widthTarget = target; this.widthStep = r.step; this.widthRemaining = r.remaining; break;
      case 'mix': this.mixTarget = target; this.mixStep = r.step; this.mixRemaining = r.remaining; break;
      case 'output': this.outputTarget = target; this.outputStep = r.step; this.outputRemaining = r.remaining; break;
    }
  }

  private timeSamples(values: ParamValues): number {
    const sync = (values.sync ?? 1) > 0.5;
    let milliseconds = clamp(values.time ?? 350, 1, 3000);
    if (sync) {
      const note = clamp(Math.round(values.note ?? 4), 0, NOTE_BEATS.length - 1);
      const bpm = clamp(values.bpm ?? 120, 40, 300);
      milliseconds = (NOTE_BEATS[note] * 60_000) / bpm;
    }
    const mode = clamp(Math.round(values.mode ?? 0), 0, DELAY_MODES.length - 1);
    if (mode === 2) milliseconds = clamp(milliseconds, 20, 250);
    return Math.round(clamp(milliseconds, 1, MAX_SINGLE_DELAY_SECONDS * 1000) * 0.001 * this.sr);
  }

  private configureToneFilters(damping: number, highpass: number, immediate = false): void {
    const dampHz = clamp(damping, 500, Math.min(20_000, this.sr * 0.45));
    const highpassHz = clamp(highpass, 20, Math.min(2_000, this.sr * 0.35));
    if (!immediate && dampHz === this.lastDamping && highpassHz === this.lastHighpass) return;
    this.lastDamping = dampHz;
    this.lastHighpass = highpassHz;
    const lp = designBiquad('lowpass', dampHz, 0, 0.707, this.sr);
    const hp = designBiquad('highpass', highpassHz, 0, 0.707, this.sr);
    const samples = Math.max(1, Math.round(this.sr * CONTROL_RAMP_MS / 1000));
    for (const filter of [this.dampL, this.dampR]) {
      if (immediate) filter.set(lp);
      else filter.setSmoothed(lp, samples);
    }
    for (const filter of [this.hpL, this.hpR]) {
      if (immediate) filter.set(hp);
      else filter.setSmoothed(hp, samples);
    }
  }

  setValues(values: ParamValues): void {
    this.values = values;
    const nextDelay = this.timeSamples(values);
    const nextFeedback = clamp((values.feedback ?? 35) / 100, 0, 0.95);
    const nextWidth = clamp((values.width ?? 100) / 100, 0, 1.5);
    const nextMix = clamp((values.mix ?? 25) / 100, 0, 1);
    const nextOutput = dbToGain(clamp(values.output ?? 0, -12, 12));
    const immediate = !this.hasProcessed;

    if (immediate) {
      this.delaySamples = this.delayTarget = nextDelay;
      this.feedback = this.feedbackTarget = nextFeedback;
      this.width = this.widthTarget = nextWidth;
      this.mix = this.mixTarget = nextMix;
      this.output = this.outputTarget = nextOutput;
      this.delayRemaining = this.feedbackRemaining = this.widthRemaining = this.mixRemaining = this.outputRemaining = 0;
    } else {
      if (nextDelay !== this.delayTarget) this.setRamp('delay', this.delaySamples, nextDelay);
      if (nextFeedback !== this.feedbackTarget) this.setRamp('feedback', this.feedback, nextFeedback);
      if (nextWidth !== this.widthTarget) this.setRamp('width', this.width, nextWidth);
      if (nextMix !== this.mixTarget) this.setRamp('mix', this.mix, nextMix);
      if (nextOutput !== this.outputTarget) this.setRamp('output', this.output, nextOutput);
    }

    this.configureToneFilters(values.damping ?? 5000, values.highpass ?? 120, immediate);
  }

  private readTap(buffer: Float32Array, delaySamples: number): number {
    const delay = clamp(delaySamples, 1, buffer.length - 2);
    const whole = Math.floor(delay);
    const fraction = delay - whole;
    let a = this.index - whole;
    if (a < 0) a += buffer.length;
    let b = a - 1;
    if (b < 0) b += buffer.length;
    return buffer[a] * (1 - fraction) + buffer[b] * fraction;
  }

  private advanceControls(): void {
    if (this.delayRemaining > 0) { this.delaySamples += this.delayStep; if (--this.delayRemaining === 0) this.delaySamples = this.delayTarget; }
    if (this.feedbackRemaining > 0) { this.feedback += this.feedbackStep; if (--this.feedbackRemaining === 0) this.feedback = this.feedbackTarget; }
    if (this.widthRemaining > 0) { this.width += this.widthStep; if (--this.widthRemaining === 0) this.width = this.widthTarget; }
    if (this.mixRemaining > 0) { this.mix += this.mixStep; if (--this.mixRemaining === 0) this.mix = this.mixTarget; }
    if (this.outputRemaining > 0) { this.output += this.outputStep; if (--this.outputRemaining === 0) this.output = this.outputTarget; }
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    if (n > this.maxBlock) throw new RangeError(`Delay block size ${n} exceeds prepared capacity ${this.maxBlock}`);
    if (n > 0) this.hasProcessed = true;

    const mode = clamp(Math.round(this.values.mode ?? 0), 0, DELAY_MODES.length - 1);
    const len = this.bufL.length;
    let peakL = 0;
    let peakR = 0;

    for (let i = 0; i < n; i++) {
      this.advanceControls();
      const dryL = L[i];
      const dryR = R[i];
      const base = this.delaySamples;
      const pingPong = mode === 1;
      const tapL = this.readTap(this.bufL, base);
      const tapR = this.readTap(this.bufR, base);
      let wetL = tapL;
      let wetR = tapR;
      let feedbackL = tapL * this.feedback;
      let feedbackR = tapR * this.feedback;

      if (mode === 1) {
        // Ping-pong: each channel's feedback is sourced from the opposite side.
        feedbackL = tapR * this.feedback;
        feedbackR = tapL * this.feedback;
        wetL = tapR;
        wetR = tapL;
      } else if (mode === 2) {
        // A single short repeat, with restrained recirculation for a tape-like slap.
        feedbackL = tapL * this.feedback * 0.25;
        feedbackR = tapR * this.feedback * 0.25;
      } else if (mode === 3) {
        const tap2L = this.readTap(this.bufL, base * 2);
        const tap2R = this.readTap(this.bufR, base * 2);
        const tap3L = this.readTap(this.bufL, base * 3);
        const tap3R = this.readTap(this.bufR, base * 3);
        wetL = tapL + tap2L * 0.6 + tap3L * 0.35;
        wetR = tapR + tap2R * 0.6 + tap3R * 0.35;
      }

      const filteredL = this.hpL.process(this.dampL.process(feedbackL));
      const filteredR = this.hpR.process(this.dampR.process(feedbackR));
      this.bufL[this.index] = dryL + filteredL;
      this.bufR[this.index] = dryR + filteredR;

      const mid = (wetL + wetR) * 0.5;
      const side = (wetL - wetR) * 0.5 * this.width;
      const outWetL = mid + side;
      const outWetR = mid - side;
      // At 0% wet preserve the original input exactly; output trim remains a
      // deliberate post-mix gain control for both dry and wet signals.
      L[i] = (dryL * (1 - this.mix) + outWetL * this.mix) * this.output;
      R[i] = (dryR * (1 - this.mix) + outWetR * this.mix) * this.output;

      this.index = (this.index + 1) % len;
      peakL = Math.max(peakL, Math.abs(L[i]));
      peakR = Math.max(peakR, Math.abs(R[i]));
    }

    this.peakL = Math.max(peakL, this.peakL * 0.97);
    this.peakR = Math.max(peakR, this.peakR * 0.97);
  }

  reset(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
    this.index = 0;
    this.dampL.reset(); this.dampR.reset(); this.hpL.reset(); this.hpR.reset();
    if (Number.isFinite(this.lastDamping) && Number.isFinite(this.lastHighpass)) {
      this.configureToneFilters(this.lastDamping, this.lastHighpass, true);
    }
    this.delaySamples = this.delayTarget;
    this.feedback = this.feedbackTarget;
    this.width = this.widthTarget;
    this.mix = this.mixTarget;
    this.output = this.outputTarget;
    this.delayRemaining = this.feedbackRemaining = this.widthRemaining = this.mixRemaining = this.outputRemaining = 0;
    this.peakL = 0;
    this.peakR = 0;
    this.hasProcessed = false;
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
  description: 'Tempo-synced stereo delay with stereo, ping-pong, slapback and three-tap modes.',
  purpose: 'Creates rhythmic space with bounded feedback, filtered repeats and editable stereo behaviour.',
  params: [
    { key: 'mode', label: 'Mode', kind: 'enum', options: [...DELAY_MODES], default: 0 },
    { key: 'sync', label: 'Tempo sync', kind: 'bool', default: 1 },
    { key: 'note', label: 'Note value', kind: 'enum', options: [...NOTE_VALUES], default: 4 },
    { key: 'time', label: 'Time', kind: 'float', min: 10, max: 3000, step: 1, default: 350, unit: 'ms' },
    { key: 'bpm', label: 'Tempo', kind: 'float', min: 40, max: 300, step: 1, default: 120, unit: 'BPM', advanced: true },
    { key: 'feedback', label: 'Feedback', kind: 'float', min: 0, max: 95, step: 1, default: 35, unit: '%' },
    { key: 'damping', label: 'Damping', kind: 'float', min: 500, max: 20000, step: 10, default: 5000, unit: 'Hz', scale: 'log' },
    { key: 'highpass', label: 'High pass', kind: 'float', min: 20, max: 2000, step: 1, default: 120, unit: 'Hz', scale: 'log', advanced: true },
    { key: 'width', label: 'Width', kind: 'float', min: 0, max: 150, step: 1, default: 100, unit: '%', group: 'Stereo' },
    { key: 'mix', label: 'Wet mix', kind: 'float', min: 0, max: 100, step: 1, default: 25, unit: '%', group: 'Output' },
    { key: 'output', label: 'Output', kind: 'float', min: -12, max: 12, step: 0.1, default: 0, unit: 'dB', group: 'Output' },
  ],
  create: () => new Delay(),
};

function delayPreset(id: string, name: string, description: string, overrides: ParamValues): DelayPreset {
  const values: ParamValues = {};
  for (const param of delayDefinition.params) values[param.key] = param.default;
  return { id, name, description, values: { ...values, ...overrides } };
}

export const DELAY_PRESETS: DelayPreset[] = [
  delayPreset('eighth-note-ping-pong', 'Eighth-note ping-pong', 'A tempo-synchronised stereo bounce for rhythmic parts.', {
    mode: 1, sync: 1, note: 4, bpm: 120, feedback: 35, damping: 7_000, highpass: 160, width: 130, mix: 22,
  }),
  delayPreset('quarter-note-echo', 'Quarter-note echo', 'A clear quarter-note repeat that leaves room between phrases.', {
    mode: 0, sync: 1, note: 6, bpm: 120, feedback: 32, damping: 6_500, highpass: 120, width: 110, mix: 20,
  }),
  delayPreset('slapback-vocal', 'Slapback vocal', 'A short single-repeat vocal thickener with restrained feedback.', {
    mode: 2, sync: 0, time: 110, feedback: 8, damping: 5_500, highpass: 150, width: 80, mix: 18,
  }),
  delayPreset('multi-tap-groove', 'Multi-tap groove', 'Three diminishing rhythmic repeats for percussive and melodic sources.', {
    mode: 3, sync: 1, note: 2, bpm: 120, feedback: 24, damping: 7_500, highpass: 180, width: 120, mix: 25,
  }),
  delayPreset('dark-analog-echo', 'Dark analog echo', 'Darker, filtered repeats with a restrained feedback trail.', {
    mode: 0, sync: 0, time: 420, feedback: 42, damping: 2_800, highpass: 220, width: 100, mix: 24,
  }),
  delayPreset('wide-ambient-delay', 'Wide ambient delay', 'Wide, higher-feedback echoes for sustained textures; check accumulation on loud sources.', {
    mode: 1, sync: 1, note: 7, bpm: 90, feedback: 48, damping: 9_000, highpass: 240, width: 145, mix: 32,
  }),
];
