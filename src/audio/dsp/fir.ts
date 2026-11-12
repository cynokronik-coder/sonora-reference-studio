import { FFT, nextPow2 } from './fft';
import type { BiquadCoeffs } from './biquad';

/**
 * Uniform-block FFT convolution (overlap-add). Used by the linear-phase EQ
 * mode. An odd-length symmetric FIR has an exact integer-sample group delay and a
 * smooth magnitude response without phase distortion.
 */
export class FirConvolver {
  private taps: Float32Array;
  private blockSize = 128;
  private fftSize = 1024;
  private fft: FFT | null = null;
  private H: { re: Float64Array; im: Float64Array } | null = null;
  private overlap: Float32Array[] = [];
  private inputRe: Float64Array[] = [];
  private inputIm: Float64Array[] = [];
  private outRe: Float64Array[] = [];
  private outIm: Float64Array[] = [];
  private channels = 1;
  readonly latency: number;

  constructor(taps: Float32Array, channels = 1) {
    this.validateTaps(taps);
    this.taps = taps;
    this.channels = channels;
    this.latency = (taps.length - 1) / 2;
  }

  setTaps(taps: Float32Array): void {
    this.validateTaps(taps);
    if (taps.length !== this.taps.length) {
      throw new RangeError('Replacement FIR taps must retain the prepared kernel length.');
    }
    this.taps = taps;
    if (this.fft) this.buildKernel();
    this.reset();
  }

  prepare(blockSize: number): void {
    if (!Number.isInteger(blockSize) || blockSize < 1) {
      throw new RangeError('FIR block size must be a positive integer.');
    }
    if (this.fft && this.blockSize === blockSize) return;
    this.blockSize = blockSize;
    this.fftSize = nextPow2(Math.max(2, blockSize + this.taps.length - 1));
    this.fft = new FFT(this.fftSize);
    this.overlap = [];
    this.inputRe = [];
    this.inputIm = [];
    this.outRe = [];
    this.outIm = [];
    for (let ch = 0; ch < Math.max(1, this.channels); ch++) {
      this.overlap.push(new Float32Array(this.fftSize));
      this.inputRe.push(new Float64Array(this.fftSize));
      this.inputIm.push(new Float64Array(this.fftSize));
      this.outRe.push(new Float64Array(this.fftSize));
      this.outIm.push(new Float64Array(this.fftSize));
    }
    this.buildKernel();
  }

  private buildKernel(): void {
    if (!this.fft) return;
    const re = new Float64Array(this.fftSize);
    const im = new Float64Array(this.fftSize);
    re.set(this.taps.subarray(0, Math.min(this.taps.length, this.fftSize)));
    this.fft.forward(re, im);
    this.H = { re, im };
  }

  reset(): void {
    for (const o of this.overlap) o.fill(0);
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    if (!this.fft || !this.H) throw new Error('FIR convolver must be prepared before processing.');
    if (!Number.isInteger(n) || n < 0 || n > this.blockSize || n > L.length || n > R.length) {
      throw new RangeError('FIR frame count must fit the prepared block and input buffers.');
    }
    if (n === 0) return;
    if (this.channels > 0) this.processChannel(0, L, n);
    if (this.channels > 1) this.processChannel(1, R, n);
  }

  private validateTaps(taps: Float32Array): void {
    if (taps.length === 0 || taps.length % 2 === 0) {
      throw new RangeError('FIR taps must have a positive odd length for integer-sample latency.');
    }
    for (let i = 0; i < taps.length; i++) {
      if (!Number.isFinite(taps[i]) || Math.abs(taps[i] - taps[taps.length - 1 - i]) > 1e-6) {
        throw new RangeError('FIR taps must be finite and symmetric.');
      }
    }
  }

  private processChannel(ch: number, x: Float32Array, n: number): void {
    const fft = this.fft!;
    const kernel = this.H!;
    const re = this.inputRe[ch];
    const im = this.inputIm[ch];
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < n; i++) re[i] = x[i];
    fft.forward(re, im);

    const outRe = this.outRe[ch];
    const outIm = this.outIm[ch];
    for (let i = 0; i < this.fftSize; i++) {
      const a = re[i];
      const b = im[i];
      outRe[i] = a * kernel.re[i] - b * kernel.im[i];
      outIm[i] = a * kernel.im[i] + b * kernel.re[i];
    }
    fft.inverse(outRe, outIm);

    const overlap = this.overlap[ch];
    for (let i = 0; i < n; i++) x[i] = outRe[i] + overlap[i];
    const remaining = this.fftSize - n;
    for (let i = 0; i < remaining; i++) overlap[i] = overlap[i + n] + outRe[i + n];
    for (let i = remaining; i < this.fftSize; i++) overlap[i] = 0;
  }
}

/**
 * Design a linear-phase FIR with the magnitude response of a biquad cascade.
 *
 * Approach: sample the exact complex response of the cascade across the
 * spectrum, take its magnitude, inverse-transform that zero-phase spectrum,
 * then rotate and window the impulse response to a causal, symmetric kernel.
 * Working directly in the frequency domain preserves high-pass and shelf
 * magnitude shapes, which naive impulse-response mirroring does not.
 */
export function designLinearPhaseFir(
  cascade: BiquadCoeffs[],
  _length = 513,
): Float32Array {
  const length = _length;
  if (!Number.isInteger(length) || length < 3 || length % 2 === 0) {
    throw new RangeError('Linear-phase FIR length must be an odd integer of at least three.');
  }
  const half = length >> 1;
  const N = Math.max(nextPow2(length * 2), 1024);
  const fft = new FFT(N);

  const re = new Float64Array(N);
  const im = new Float64Array(N);

  for (let k = 0; k <= N / 2; k++) {
    const w = (2 * Math.PI * k) / N;
    const cos1 = Math.cos(w), sin1 = Math.sin(w);
    const cos2 = Math.cos(2 * w), sin2 = Math.sin(2 * w);
    let mag = 1;
    for (const c of cascade) {
      const nr = c.b0 + c.b1 * cos1 + c.b2 * cos2;
      const ni = -(c.b1 * sin1 + c.b2 * sin2);
      const dr = 1 + c.a1 * cos1 + c.a2 * cos2;
      const di = -(c.a1 * sin1 + c.a2 * sin2);
      const den = Math.hypot(dr, di);
      if (den > 1e-12) mag *= Math.hypot(nr, ni) / den;
    }
    re[k] = mag;
    re[(N - k) % N] = mag;
  }
  im.fill(0);
  fft.inverse(re, im);

  // re now holds the zero-phase impulse response, circularly centred at 0.
  const taps = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let idx = i - half;
    if (idx < 0) idx += N;
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1));
    taps[i] = re[idx] * w;
  }
  return taps;
}
