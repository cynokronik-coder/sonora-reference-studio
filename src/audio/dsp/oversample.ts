import { Biquad } from './biquad';

/**
 * Low-latency IIR oversampler built from cascaded Butterworth biquads.
 *
 * Nonlinear stages use this to attenuate images during interpolation and
 * reduce generated harmonics that would otherwise fold back during decimation.
 * The IIR filters have frequency-dependent phase shift/group delay; this is
 * not a zero-latency or linear-phase oversampler. Wet/dry parallel paths that
 * use this class should share matching filter histories to reduce combing.
 */
export class Oversampler {
  readonly factor: 1 | 2 | 4;
  private upStages: Biquad[][] = [];
  private downStages: Biquad[][] = [];
  private channels: number;
  private upBuf: Float32Array[] = [];
  private downBuf: Float32Array[] = [];

  constructor(factor: 1 | 2 | 4, channels = 2, maxBlock = 2048) {
    this.factor = factor;
    this.channels = channels;
    for (let ch = 0; ch < channels; ch++) {
      this.upStages.push([]);
      this.downStages.push([]);
      this.upBuf.push(new Float32Array(maxBlock * Math.max(1, factor)));
      this.downBuf.push(new Float32Array(maxBlock));
    }
  }

  prepare(sampleRate: number): void {
    if (this.factor === 1) return;
    const newRate = sampleRate * this.factor;
    const cutoff = sampleRate * 0.45;
    const qs = [0.5097956, 0.6013449, 0.8999762, 2.5629154];
    for (let ch = 0; ch < this.channels; ch++) {
      this.upStages[ch] = qs.map((q) => {
        const bq = new Biquad();
        bq.configure('lowpass', cutoff, 0, q, newRate);
        return bq;
      });
      this.downStages[ch] = qs.map((q) => {
        const bq = new Biquad();
        bq.configure('lowpass', cutoff, 0, q, newRate);
        return bq;
      });
    }
  }

  reset(): void {
    for (const bank of this.upStages) for (const b of bank) b.reset();
    for (const bank of this.downStages) for (const b of bank) b.reset();
  }

  /** Upsample `input` into a scratch buffer; returns the upsampled view. */
  upsample(input: Float32Array, n: number, channel = 0): Float32Array {
    if (this.factor === 1) return input;
    const out = this.upBuf[channel];
    const F = this.factor;
    out.fill(0, 0, n * F);
    for (let i = 0; i < n; i++) out[i * F] = input[i] * F;
    for (const bq of this.upStages[channel]) bq.processBlock(out, n * F);
    return out;
  }

  /** Downsample the first n*factor samples of `input` into `dest`. */
  downsample(input: Float32Array, n: number, dest: Float32Array, channel = 0): void {
    if (this.factor === 1) {
      dest.set(input.subarray(0, n));
      return;
    }
    for (const bq of this.downStages[channel]) bq.processBlock(input, n * this.factor);
    const F = this.factor;
    for (let i = 0; i < n; i++) dest[i] = input[i * F];
  }

  /** Convenience: process one channel through up → fn → down. */
  processChannel(
    input: Float32Array,
    n: number,
    fn: (up: Float32Array, count: number) => void,
    channel = 0,
  ): Float32Array {
    const up = this.upsample(input, n, channel);
    fn(up, n * this.factor);
    const dest = this.downBuf[channel];
    this.downsample(up, n, dest, channel);
    return dest;
  }
}

/**
 * Streaming 4x oversampler used exclusively by the true-peak meter. It must
 * keep filter state between blocks so the estimate is continuous.
 */
export class TruePeakMeter {
  private banks: Biquad[][] = [];
  private up: Float32Array[] = [];
  private factor = 4;

  constructor(sampleRate: number, channels = 2, maxBlock = 2048) {
    const qs = [0.5097956, 0.6013449, 0.8999762, 2.5629154];
    for (let ch = 0; ch < channels; ch++) {
      this.banks.push(
        qs.map((q) => {
          const bq = new Biquad();
          bq.configure('lowpass', Math.min(sampleRate * 0.45, sampleRate * 0.49), 0, q, sampleRate * this.factor);
          return bq;
        }),
      );
      this.up.push(new Float32Array(maxBlock * this.factor));
    }
  }

  /** Peak of both channels after interpolation, for this block. */
  process(L: Float32Array, R: Float32Array, n: number): number {
    let peak = 0;
    const src = [L, R];
    for (let ch = 0; ch < 2; ch++) {
      const buf = this.up[ch];
      const count = n * this.factor;
      buf.fill(0, 0, count);
      for (let i = 0; i < n; i++) buf[i * this.factor] = src[ch][i] * this.factor;
      for (const bq of this.banks[ch]) bq.processBlock(buf, count);
      for (let i = 0; i < count; i++) {
        const v = Math.abs(buf[i]);
        if (v > peak) peak = v;
      }
    }
    return peak;
  }

  reset(): void {
    for (const bank of this.banks) for (const b of bank) b.reset();
  }
}
