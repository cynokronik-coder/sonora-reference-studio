/**
 * Iterative radix-2 FFT with precomputed twiddles and bit-reversal.
 * Used by the spectrum analyser, linear-phase EQ, true-peak detector and
 * the reverb's damping filters. Real-only helpers avoid wasted work.
 */
export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export class FFT {
  readonly size: number;
  private readonly levels: number;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;

  constructor(size: number) {
    if ((size & (size - 1)) !== 0 || size < 2) throw new Error('FFT size must be a power of two >= 2');
    this.size = size;
    this.levels = Math.round(Math.log2(size));
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((2 * Math.PI * i) / size);
    }
  }

  /** In-place complex forward transform. */
  forward(re: Float64Array | Float32Array, im: Float64Array | Float32Array): void {
    const n = this.size;
    // Bit reversal permutation.
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let len = 2, level = 0; len <= n; len <<= 1, level++) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < half; k++) {
          const tw = k * step;
          const wr = this.cos[tw];
          const wi = -this.sin[tw];
          const a = i + k;
          const b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }

  /** In-place complex inverse transform (includes 1/N scaling). */
  inverse(re: Float64Array | Float32Array, im: Float64Array | Float32Array): void {
    const n = this.size;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < half; k++) {
          const tw = k * step;
          const wr = this.cos[tw];
          const wi = this.sin[tw];
          const a = i + k;
          const b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
    const scale = 1 / n;
    for (let i = 0; i < n; i++) {
      re[i] *= scale;
      im[i] *= scale;
    }
  }

  /** Magnitude spectrum of a real signal, length size/2 + 1. */
  magnitude(real: Float32Array): Float64Array {
    const n = this.size;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    re.set(real.subarray(0, n));
    this.forward(re, im);
    const out = new Float64Array(n / 2 + 1);
    for (let i = 0; i <= n / 2; i++) out[i] = Math.hypot(re[i], im[i]);
    return out;
  }
}

export function hannWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

export function blackmanHarris(n: number): Float32Array {
  const w = new Float32Array(n);
  const a0 = 0.35875;
  const a1 = 0.48829;
  const a2 = 0.14128;
  const a3 = 0.01168;
  for (let i = 0; i < n; i++) {
    const x = (2 * Math.PI * i) / (n - 1);
    w[i] = a0 - a1 * Math.cos(x) + a2 * Math.cos(2 * x) - a3 * Math.cos(3 * x);
  }
  return w;
}

/** Windowed-sinc lowpass for oversampling / true-peak filters. */
export function designSincLowpass(taps: number, cutoffNorm: number, window: 'hann' | 'blackman' = 'blackman'): Float32Array {
  const h = new Float32Array(taps);
  const m = taps - 1;
  const mid = m / 2;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - mid;
    const sinc = x === 0 ? 2 * cutoffNorm : Math.sin(2 * Math.PI * cutoffNorm * x) / (Math.PI * x);
    const w =
      window === 'hann'
        ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / m)
        : 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / m) + 0.08 * Math.cos((4 * Math.PI * i) / m);
    h[i] = sinc * w;
    sum += h[i];
  }
  // Normalise DC gain to exactly 1.
  for (let i = 0; i < taps; i++) h[i] /= sum;
  return h;
}
