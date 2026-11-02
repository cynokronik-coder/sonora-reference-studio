import { Biquad } from '../biquad';
import { Oversampler } from '../oversample';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain, gainToDb } from '../util';

export const SATURATION_MODES = ['Tape', 'Tube', 'Console', 'Soft clip', 'Hard clip', 'Wavefold'] as const;

/** Asymmetric waveshapers used by the saturator and exciter. */
export function shapeSample(x: number, mode: number, bias = 0.08): number {
  switch (mode) {
    case 0: {
      // Tape: gentle compression of the top end plus a small asymmetric bias.
      const b = bias;
      const shaped = Math.tanh(x + b) - Math.tanh(b);
      return shaped / Math.max(0.25, 1 - Math.abs(b));
    }
    case 1: {
      // Tube: second-harmonic-rich asymmetry.
      const shaped = Math.tanh(x + 0.18 * x * x + 0.02);
      return shaped;
    }
    case 2: {
      // Console: soft cubic knee.
      const y = x - (x * x * x) / 3;
      return Math.abs(x) > 1 ? Math.sign(x) * (2 / 3) : y;
    }
    case 3:
      return Math.tanh(x);
    case 4:
      return clamp(x, -1, 1);
    case 5: {
      // Wavefold: reflects rather than clips.
      return Math.sin(clamp(x, -8, 8) * 1.4);
    }
    default:
      return Math.tanh(x);
  }
}

/**
 * Saturation with six real transfer functions, pre/post tone shaping,
 * dry/wet and optional 2x/4x oversampling around the nonlinearity.
 *
 * The UI labels these as styles, not hardware models: the transfer functions
 * are inspired by the behaviour of tape, tubes and consoles, but no proprietary
 * circuit model is claimed.
 */
export class Saturator implements AudioProcessor {
  readonly type = 'saturation';
  readonly latency = 0;
  private sr = 48000;
  private values: ParamValues = {};
  private os: Oversampler | null = null;
  private osFactor = 1;
  private preFilter = new Biquad();
  private postTone = new Biquad();
  private dcBlockL = new Biquad();
  private dcBlockR = new Biquad();
  private mode = 0;
  private drive = 1;
  private compGain = 1;
  private outGain = 1;
  private mix = 1;
  private dcStateL = 0;
  private dcStateR = 0;
  private blockPeakL = 0;
  private blockPeakR = 0;
  private maxModule = 4;

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = sampleRate;
    this.maxModule = maxBlock;
    this.dcBlockL.configure('highpass', 18, 0, 0.707, sampleRate);
    this.dcBlockR.configure('highpass', 18, 0, 0.707, sampleRate);
    this.buildOversampler();
  }

  private buildOversampler(): void {
    const factor = clamp(Math.round(this.values.oversample ?? 1), 1, 4) === 4 ? 4 : clamp(Math.round(this.values.oversample ?? 1), 1, 2) as 1 | 2;
    const chosen: 1 | 2 | 4 = factor === 1 ? 1 : factor === 2 ? 2 : 4;
    if (chosen !== this.osFactor || !this.os) {
      this.osFactor = chosen;
      this.os = new Oversampler(chosen, 2, this.maxModule);
      this.os.prepare(this.sr);
    }
  }

  setValues(values: ParamValues): void {
    this.values = values;
    this.mode = Math.round(values.mode ?? 0);
    const driveDb = values.drive ?? 0;
    this.drive = dbToGain(driveDb);
    this.compGain = 1 / Math.max(0.15, Math.tanh(this.drive) * 0.85 + 0.15);
    this.outGain = dbToGain(values.output ?? 0);
    this.mix = clamp((values.mix ?? 100) / 100, 0, 1);
    const tone = values.tone ?? 0;
    this.postTone.configure('highshelf', 4500, tone * 1.5, 0.707, this.sr);
    this.preFilter.configure('highshelf', 6000, -driveDb * 0.15, 0.707, this.sr);
    this.buildOversampler();
  }

  private shapeChannel(buf: Float32Array, count: number): void {
    const d = this.drive;
    const comp = this.compGain;
    const mode = this.mode;
    for (let i = 0; i < count; i++) {
      buf[i] = shapeSample(buf[i] * d, mode) * comp;
    }
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    const dryL = this.mix < 1 ? Float32Array.from(L.subarray(0, n)) : null;
    const dryR = this.mix < 1 ? Float32Array.from(R.subarray(0, n)) : null;

    if (this.os && this.osFactor > 1) {
      const upL = this.os.upsample(L, n, 0);
      this.preFilter.processBlock(upL, n * this.osFactor);
      this.shapeChannel(upL, n * this.osFactor);
      const wetL = new Float32Array(n);
      this.os.downsample(upL, n, wetL, 0);
      const upR = this.os.upsample(R, n, 1);
      this.preFilter.processBlock(upR, n * this.osFactor);
      this.shapeChannel(upR, n * this.osFactor);
      const wetR = new Float32Array(n);
      this.os.downsample(upR, n, wetR, 1);
      for (let i = 0; i < n; i++) {
        L[i] = wetL[i];
        R[i] = wetR[i];
      }
    } else {
      this.preFilter.processBlock(L, n);
      this.preFilter.processBlock(R, n);
      this.shapeChannel(L, n);
      this.shapeChannel(R, n);
    }

    for (let i = 0; i < n; i++) {
      L[i] = this.postTone.process(L[i]);
      R[i] = this.postTone.process(R[i]);
    }
    // Remove DC produced by asymmetric transfer functions.
    for (let i = 0; i < n; i++) {
      L[i] = this.dcBlockL.process(L[i]);
      R[i] = this.dcBlockR.process(R[i]);
    }
    const g = this.outGain;
    for (let i = 0; i < n; i++) {
      let l = L[i] * g;
      let r = R[i] * g;
      if (this.mix < 1 && dryL && dryR) {
        l = l * this.mix + dryL[i] * (1 - this.mix);
        r = r * this.mix + dryR[i] * (1 - this.mix);
      }
      L[i] = l;
      R[i] = r;
      const al = Math.abs(l);
      const ar = Math.abs(r);
      if (al > this.blockPeakL) this.blockPeakL = al;
      if (ar > this.blockPeakR) this.blockPeakR = ar;
    }
    this.blockPeakL *= 0.97;
    this.blockPeakR *= 0.97;
    void this.dcStateL;
    void this.dcStateR;
  }

  reset(): void {
    this.os?.reset();
    this.preFilter.reset();
    this.postTone.reset();
    this.dcBlockL.reset();
    this.dcBlockR.reset();
  }

  meter(): ProcessorMeter {
    return {
      peakL: this.blockPeakL,
      peakR: this.blockPeakR,
      gain: gainToDb(this.drive),
    };
  }
}

export const saturationDefinition: ProcessorDefinition = {
  type: 'saturation',
  name: 'Saturation',
  shortName: 'SAT',
  category: 'saturation',
  description: 'Six saturation transfer functions (tape, tube, console, soft clip, hard clip, wavefold) with drive, tone, mix and oversampling.',
  purpose: 'Adds harmonics, density and perceived loudness. Matching uses it when the reference has more harmonic content than the target.',
  params: [
    { key: 'mode', label: 'Style', kind: 'enum', options: [...SATURATION_MODES], default: 0 },
    { key: 'drive', label: 'Drive', kind: 'float', min: 0, max: 30, step: 0.1, default: 4, unit: 'dB' },
    { key: 'tone', label: 'Tone', kind: 'float', min: -10, max: 10, step: 0.1, default: 0, unit: 'dB' },
    { key: 'mix', label: 'Dry/wet', kind: 'float', min: 0, max: 100, step: 1, default: 100, unit: '%' },
    { key: 'output', label: 'Output', kind: 'float', min: -18, max: 18, step: 0.1, default: 0, unit: 'dB' },
    { key: 'oversample', label: 'Oversampling', kind: 'enum', options: ['Off', '2x', '4x'], default: 2, advanced: true },
  ],
  create: () => new Saturator(),
};
