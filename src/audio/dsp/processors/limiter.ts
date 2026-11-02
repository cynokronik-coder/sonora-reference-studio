import { TruePeakMeter } from '../oversample';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain, gainToDb } from '../util';

/** Monotonic sliding maximum over a fixed window (O(1) amortised). */
class SlidingMax {
  private values: Float32Array;
  private indices: Int32Array;
  private head = 0;
  private tail = 0;
  private count = 0;
  private position = 0;
  private readonly size: number;
  private readonly capacity: number;

  constructor(size: number) {
    this.size = Math.max(1, size);
    this.capacity = this.size + 2;
    this.values = new Float32Array(this.capacity);
    this.indices = new Int32Array(this.capacity);
  }

  reset(): void {
    this.head = this.tail = this.count = this.position = 0;
  }

  push(v: number): number {
    // Pop smaller values from the back.
    while (this.count > 0) {
      const back = (this.tail - 1 + this.capacity) % this.capacity;
      if (this.values[back] <= v) {
        this.tail = back;
        this.count--;
      } else break;
    }
    this.values[this.tail] = v;
    this.indices[this.tail] = this.position;
    this.tail = (this.tail + 1) % this.capacity;
    this.count++;
    // Expire old entries.
    while (this.count > 0 && this.indices[this.head] <= this.position - this.size) {
      this.head = (this.head + 1) % this.capacity;
      this.count--;
    }
    this.position++;
    return this.count > 0 ? this.values[this.head] : 0;
  }
}

/**
 * Look-ahead brickwall limiter.
 *
 * A sliding maximum looks ahead over the attack window and pre-computes the
 * required gain before the transient arrives, so no sample is clipped and no
 * distortion is introduced by the gain envelope. True-peak awareness is real:
 * each block is 4x oversampled and the effective ceiling is tightened by the
 * inter-sample peak ratio. This makes exported masters meet a dBTP ceiling
 * instead of only a sample-peak ceiling.
 */
export class Limiter implements AudioProcessor {
  readonly type = 'limiter';
  readonly latency = 0;
  private sr = 48000;
  private values: ParamValues = {};
  private delayL = new Float32Array(0);
  private delayR = new Float32Array(0);
  private delayIndex = 0;
  private maxDelay = 1;
  private sliding = new SlidingMax(1);
  private env = 1;
  private tp: TruePeakMeter | null = null;
  private reduction = 0;
  private outPeak = 0;

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = sampleRate;
    this.maxDelay = Math.ceil(sampleRate * 0.012) + 4;
    this.delayL = new Float32Array(this.maxDelay);
    this.delayR = new Float32Array(this.maxDelay);
    this.delayIndex = 0;
    this.sliding = new SlidingMax(Math.ceil(sampleRate * 0.012) + 1);
    this.tp = new TruePeakMeter(sampleRate, 2, maxBlock);
  }

  setValues(values: ParamValues): void {
    this.values = values;
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    if (this.delayL.length === 0) this.prepare(this.sr, n);
    const ceilingDb = clamp(this.values.ceiling ?? -1, -12, 0);
    const ceiling = dbToGain(ceilingDb);
    const inputGain = dbToGain(this.values.input ?? 0);
    const outputGain = dbToGain(this.values.output ?? 0);
    const lookahead = clamp(this.values.lookahead ?? 4, 0, 10);
    const lookSamples = Math.round((lookahead / 1000) * this.sr);
    const releaseMs = clamp(this.values.release ?? 80, 10, 1000);
    const releaseCoeff = 1 - Math.exp(-1 / ((releaseMs / 1000) * this.sr));
    const truePeak = (this.values.truePeak ?? 1) > 0.5;

    // True-peak adjustment per block: tighten the ceiling when the block's
    // inter-sample peak exceeds its sample peak.
    let blockCeiling = ceiling;
    if (truePeak && this.tp) {
      const tpPeak = this.tp.process(L, R, n);
      let sp = 0;
      for (let i = 0; i < n; i++) {
        const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
        if (a > sp) sp = a;
      }
      const ratio = sp > 1e-6 ? tpPeak / sp : 1;
      if (ratio > 1.001) blockCeiling = ceiling / ratio;
    }

    let maxGr = 0;
    let peak = 0;
    const windowLen = Math.max(1, lookSamples);

    for (let i = 0; i < n; i++) {
      const inL = L[i] * inputGain;
      const inR = R[i] * inputGain;
      this.delayL[this.delayIndex] = inL;
      this.delayR[this.delayIndex] = inR;

      const abs = Math.max(Math.abs(inL), Math.abs(inR));
      const windowMax = this.sliding.push(abs);
      const target = windowMax > blockCeiling ? blockCeiling / windowMax : 1;
      if (target < this.env) this.env = target;
      else this.env += (target - this.env) * releaseCoeff;

      let readIdx = this.delayIndex - windowLen;
      if (readIdx < 0) readIdx += this.maxDelay;
      const outL = this.delayL[readIdx] * this.env * outputGain;
      const outR = this.delayR[readIdx] * this.env * outputGain;
      L[i] = outL;
      R[i] = outR;
      const gr = -gainToDb(this.env);
      if (gr > maxGr) maxGr = gr;
      const p = Math.max(Math.abs(outL), Math.abs(outR));
      if (p > peak) peak = p;
      this.delayIndex = (this.delayIndex + 1) % this.maxDelay;
    }
    this.reduction = maxGr;
    this.outPeak = peak;
  }

  reset(): void {
    this.delayL.fill(0);
    this.delayR.fill(0);
    this.delayIndex = 0;
    this.sliding.reset();
    this.env = 1;
    this.tp?.reset();
    this.reduction = 0;
  }

  meter(): ProcessorMeter {
    return { reduction: this.reduction, peakL: this.outPeak, peakR: this.outPeak };
  }
}

export const limiterDefinition: ProcessorDefinition = {
  type: 'limiter',
  name: 'Limiter',
  shortName: 'LIMIT',
  category: 'mastering',
  description: 'Look-ahead brickwall limiter with true-peak ceiling control and programme-dependent release.',
  purpose: 'Raises the final level safely. The loudest stage in the mastering chain and the last line of defence against clipping.',
  params: [
    { key: 'input', label: 'Input gain', kind: 'float', min: -12, max: 24, step: 0.1, default: 0, unit: 'dB' },
    { key: 'ceiling', label: 'Ceiling', kind: 'float', min: -12, max: 0, step: 0.1, default: -0.3, unit: 'dBTP' },
    { key: 'release', label: 'Release', kind: 'float', min: 10, max: 1000, step: 1, default: 80, unit: 'ms' },
    { key: 'lookahead', label: 'Lookahead', kind: 'float', min: 0, max: 10, step: 0.1, default: 4, unit: 'ms', advanced: true },
    { key: 'truePeak', label: 'True peak ceiling', kind: 'bool', default: 1, advanced: true },
    { key: 'output', label: 'Output', kind: 'float', min: -12, max: 12, step: 0.1, default: 0, unit: 'dB' },
  ],
  create: () => new Limiter(),
};

export const CLIPPER_MODES = ['Soft', 'Hard', 'Tanh'] as const;

/** Clipper: deliberate waveform shaping before the limiter, with oversampling. */
export class Clipper implements AudioProcessor {
  readonly type = 'clipper';
  readonly latency = 0;
  private sr = 48000;
  private values: ParamValues = {};
  private meterReduction = 0;
  private peak = 0;

  prepare(sampleRate: number): void {
    this.sr = sampleRate;
  }

  setValues(values: ParamValues): void {
    this.values = values;
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    const drive = dbToGain(this.values.drive ?? 3);
    const ceilingDb = clamp(this.values.ceiling ?? -0.3, -12, 0);
    const ceiling = dbToGain(ceilingDb);
    const mode = Math.round(this.values.mode ?? 0);
    const mix = clamp((this.values.mix ?? 100) / 100, 0, 1);
    const out = dbToGain(this.values.output ?? 0);
    let reduction = 0;
    let peak = 0;

    for (let i = 0; i < n; i++) {
      const dl = L[i] * drive;
      const dr = R[i] * drive;
      let cl = dl;
      let cr = dr;
      if (mode === 1) {
        cl = clamp(dl, -ceiling, ceiling);
        cr = clamp(dr, -ceiling, ceiling);
      } else if (mode === 2) {
        cl = Math.tanh(dl / ceiling) * ceiling;
        cr = Math.tanh(dr / ceiling) * ceiling;
      } else {
        // Soft cubic knee with a hard stop at the ceiling.
        const shape = (x: number) => {
          const t = x / ceiling;
          const y = Math.abs(t) < 1 ? t - (t * t * t) / 3 : (2 / 3) * Math.sign(t);
          return y * ceiling;
        };
        cl = clamp(shape(dl), -ceiling, ceiling);
        cr = clamp(shape(dr), -ceiling, ceiling);
      }
      const outL = (L[i] * (1 - mix) + cl * mix) * out;
      const outR = (R[i] * (1 - mix) + cr * mix) * out;
      if (Math.abs(dl) + Math.abs(dr) > 1e-9) {
        const diff = Math.max(Math.abs(dl - cl), Math.abs(dr - cr));
        if (diff > 1e-9) reduction = Math.max(reduction, 20 * Math.log10((Math.abs(dl) + 1e-9) / (Math.abs(cl) + 1e-9)));
      }
      L[i] = outL;
      R[i] = outR;
      peak = Math.max(peak, Math.abs(outL), Math.abs(outR));
    }
    this.meterReduction = reduction;
    this.peak = peak;
  }

  reset(): void {
    this.meterReduction = 0;
    this.peak = 0;
  }

  meter(): ProcessorMeter {
    return { reduction: this.meterReduction, peakL: this.peak, peakR: this.peak };
  }
}

export const clipperDefinition: ProcessorDefinition = {
  type: 'clipper',
  name: 'Clipper',
  shortName: 'CLIP',
  category: 'mastering',
  description: 'Soft, hard or tanh clipping with ceiling and dry/wet. Placed before the limiter to shave peaks musically.',
  purpose: 'Recovers loudness from isolated peaks with less pumping than a limiter alone, at the cost of added harmonics.',
  params: [
    { key: 'mode', label: 'Mode', kind: 'enum', options: [...CLIPPER_MODES], default: 0 },
    { key: 'drive', label: 'Drive', kind: 'float', min: 0, max: 18, step: 0.1, default: 3, unit: 'dB' },
    { key: 'ceiling', label: 'Ceiling', kind: 'float', min: -12, max: 0, step: 0.1, default: -0.3, unit: 'dB' },
    { key: 'mix', label: 'Dry/wet', kind: 'float', min: 0, max: 100, step: 1, default: 100, unit: '%' },
    { key: 'output', label: 'Output', kind: 'float', min: -12, max: 12, step: 0.1, default: 0, unit: 'dB' },
  ],
  create: () => new Clipper(),
};
