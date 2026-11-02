/**
 * Detector / ballistics primitives used by every dynamics processor.
 * All envelope followers work in linear amplitude and expose their state so
 * meters can read real gain reduction.
 */

export type DetectorMode = 'peak' | 'rms';

export class EnvelopeFollower {
  private env = 0;
  private rmsState = 0;
  attackCoeff = 1;
  releaseCoeff = 1;
  mode: DetectorMode = 'peak';

  constructor(sampleRate: number, attackMs = 10, releaseMs = 100, mode: DetectorMode = 'peak') {
    this.setTimes(attackMs, releaseMs, sampleRate);
    this.mode = mode;
  }

  setTimes(attackMs: number, releaseMs: number, sampleRate: number): void {
    this.attackCoeff = 1 - Math.exp(-1 / (Math.max(0.01, attackMs) * 0.001 * sampleRate));
    this.releaseCoeff = 1 - Math.exp(-1 / (Math.max(0.01, releaseMs) * 0.001 * sampleRate));
  }

  reset(): void {
    this.env = 0;
    this.rmsState = 0;
  }

  process(x: number): number {
    const rect = Math.abs(x);
    const target = this.mode === 'rms' ? rect : rect;
    const coeff = target > this.env ? this.attackCoeff : this.releaseCoeff;
    this.env += (target - this.env) * coeff;
    return this.env;
  }

  /** RMS envelope with an exponential power average. */
  processRms(x: number, windowMs: number, sampleRate: number): number {
    const coeff = 1 - Math.exp(-1 / (Math.max(0.1, windowMs) * 0.001 * sampleRate));
    this.rmsState += (x * x - this.rmsState) * coeff;
    void this.attackCoeff;
    void this.releaseCoeff;
    return Math.sqrt(Math.max(0, this.rmsState));
  }

  get value(): number {
    return this.env;
  }

  set value(v: number) {
    this.env = v;
  }
}

/**
 * Attack/release smoothing in the dB domain. This is how gain reduction is
 * shaped inside the compressor, and it is what makes a ratio of 4:1 actually
 * reduce a 12 dB over-threshold signal by 9 dB instead of just clamping.
 */
export class DbBallistics {
  attackCoeff: number;
  releaseCoeff: number;
  private state = 0;
  private initialized = false;
  private holdCounter = 0;
  private holdSamples = 0;

  constructor(sampleRate: number, attackMs: number, releaseMs: number, holdMs = 0) {
    this.attackCoeff = 1 - Math.exp(-1 / (Math.max(0.02, attackMs) * 0.001 * sampleRate));
    this.releaseCoeff = 1 - Math.exp(-1 / (Math.max(1, releaseMs) * 0.001 * sampleRate));
    this.holdSamples = Math.round((holdMs / 1000) * sampleRate);
  }

  setTimes(attackMs: number, releaseMs: number, sampleRate: number, holdMs = 0): void {
    this.attackCoeff = 1 - Math.exp(-1 / (Math.max(0.02, attackMs) * 0.001 * sampleRate));
    this.releaseCoeff = 1 - Math.exp(-1 / (Math.max(1, releaseMs) * 0.001 * sampleRate));
    this.holdSamples = Math.round((holdMs / 1000) * sampleRate);
  }

  reset(): void {
    this.state = 0;
    this.initialized = false;
    this.holdCounter = 0;
  }

  /** targetDb should be a positive number of dB of gain reduction. */
  process(targetDb: number): number {
    if (!this.initialized) {
      this.state = targetDb;
      this.initialized = true;
      return this.state;
    }
    if (targetDb > this.state) {
      this.state += (targetDb - this.state) * this.attackCoeff;
      this.holdCounter = this.holdSamples;
    } else {
      if (this.holdCounter > 0) {
        this.holdCounter--;
      } else {
        this.state += (targetDb - this.state) * this.releaseCoeff;
      }
    }
    return this.state;
  }

  get value(): number {
    return this.state;
  }
}

/**
 * Look-ahead delay line with a linked peak-detector stage, used by the
 * limiter and the transient shaper.
 */
export class DelayLine {
  buffer: Float32Array;
  private index = 0;
  readonly length: number;

  constructor(length: number) {
    this.length = Math.max(1, length);
    this.buffer = new Float32Array(this.length);
  }

  reset(): void {
    this.buffer.fill(0);
    this.index = 0;
  }

  write(x: number): void {
    this.buffer[this.index] = x;
    this.index = (this.index + 1) % this.length;
  }

  read(delaySamples: number): number {
    let d = Math.round(delaySamples);
    if (d < 0) d = 0;
    if (d >= this.length) d = this.length - 1;
    let idx = this.index - d - 1;
    if (idx < 0) idx += this.length;
    return this.buffer[idx];
  }

  /** Max absolute value in the look-ahead window. */
  maxAbs(delaySamples: number): number {
    let m = 0;
    const n = Math.min(this.length, Math.max(1, Math.round(delaySamples)));
    for (let i = 0; i < n; i++) {
      let idx = this.index - i - 1;
      if (idx < 0) idx += this.length;
      const v = Math.abs(this.buffer[idx]);
      if (v > m) m = v;
    }
    return m;
  }
}
