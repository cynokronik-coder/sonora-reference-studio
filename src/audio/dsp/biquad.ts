export type FilterType =
  | 'peak'
  | 'lowshelf'
  | 'highshelf'
  | 'lowpass'
  | 'highpass'
  | 'notch'
  | 'bandpass'
  | 'allpass';

export interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * RBJ audio-EQ-cookbook biquad design. Coefficients are normalised by a0
 * so processing is a simple direct-form-I difference equation.
 */
export function designBiquad(
  type: FilterType,
  freq: number,
  gainDb: number,
  q: number,
  sampleRate: number,
): BiquadCoeffs {
  const nyquist = sampleRate * 0.5;
  const f = Math.min(Math.max(freq, 10), nyquist * 0.99);
  const Q = Math.max(0.05, q);
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const alpha = sinw / (2 * Q);

  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

  switch (type) {
    case 'peak':
      b0 = 1 + alpha * A;
      b1 = -2 * cosw;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cosw;
      a2 = 1 - alpha / A;
      break;
    case 'lowshelf': {
      const S = Math.max(0.1, Q);
      const a = sinw / 2 * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2);
      const sa = 2 * Math.sqrt(A) * a;
      b0 = A * (A + 1 - (A - 1) * cosw + sa);
      b1 = 2 * A * (A - 1 - (A + 1) * cosw);
      b2 = A * (A + 1 - (A - 1) * cosw - sa);
      a0 = A + 1 + (A - 1) * cosw + sa;
      a1 = -2 * (A - 1 + (A + 1) * cosw);
      a2 = A + 1 + (A - 1) * cosw - sa;
      break;
    }
    case 'highshelf': {
      const S = Math.max(0.1, Q);
      const a = sinw / 2 * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2);
      const sa = 2 * Math.sqrt(A) * a;
      b0 = A * (A + 1 + (A - 1) * cosw + sa);
      b1 = -2 * A * (A - 1 + (A + 1) * cosw);
      b2 = A * (A + 1 + (A - 1) * cosw - sa);
      a0 = A + 1 - (A - 1) * cosw + sa;
      a1 = 2 * (A - 1 - (A + 1) * cosw);
      a2 = A + 1 - (A - 1) * cosw - sa;
      break;
    }
    case 'lowpass':
      b0 = (1 - cosw) / 2;
      b1 = 1 - cosw;
      b2 = (1 - cosw) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosw;
      a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cosw) / 2;
      b1 = -(1 + cosw);
      b2 = (1 + cosw) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosw;
      a2 = 1 - alpha;
      break;
    case 'notch':
      b0 = 1;
      b1 = -2 * cosw;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cosw;
      a2 = 1 - alpha;
      break;
    case 'bandpass':
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cosw;
      a2 = 1 - alpha;
      break;
    case 'allpass':
      b0 = 1 - alpha;
      b1 = -2 * cosw;
      b2 = 1 + alpha;
      a0 = 1 + alpha;
      a1 = -2 * cosw;
      a2 = 1 - alpha;
      break;
  }

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

/** Direct-form-I biquad with double-precision state. */
export class Biquad {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(coeffs?: BiquadCoeffs) {
    if (coeffs) this.set(coeffs);
  }

  set(c: BiquadCoeffs): void {
    this.b0 = c.b0;
    this.b1 = c.b1;
    this.b2 = c.b2;
    this.a1 = c.a1;
    this.a2 = c.a2;
  }

  configure(type: FilterType, freq: number, gainDb: number, q: number, sampleRate: number): void {
    this.set(designBiquad(type, freq, gainDb, q, sampleRate));
  }

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  processBlock(buf: Float32Array, n: number): void {
    const { b0, b1, b2, a1, a2 } = this;
    let { x1, x2, y1, y2 } = this;
    for (let i = 0; i < n; i++) {
      const x = buf[i];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      buf[i] = y;
    }
    this.x1 = x1;
    this.x2 = x2;
    this.y1 = y1;
    this.y2 = y2;
  }
}

/** Magnitude response (linear) of a biquad at a given frequency. */
export function biquadMagnitude(c: BiquadCoeffs, freq: number, sampleRate: number): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  const cos1 = Math.cos(w), sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w), sin2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * cos1 + c.b2 * cos2;
  const ni = -(c.b1 * sin1 + c.b2 * sin2);
  const dr = 1 + c.a1 * cos1 + c.a2 * cos2;
  const di = -(c.a1 * sin1 + c.a2 * sin2);
  const num = Math.hypot(nr, ni);
  const den = Math.hypot(dr, di);
  return den < 1e-12 ? 0 : num / den;
}

export function magnitudeDb(c: BiquadCoeffs, freq: number, sampleRate: number): number {
  return 20 * Math.log10(Math.max(biquadMagnitude(c, freq, sampleRate), 1e-9));
}

/** First-order tilt: implemented as a pair of shelves, exposed as one unit. */
export interface TiltCoeffs {
  low: BiquadCoeffs;
  high: BiquadCoeffs;
}

export function designTilt(gainDb: number, sampleRate: number, pivotHz = 800): TiltCoeffs {
  return {
    low: designBiquad('lowshelf', pivotHz * 0.5, -gainDb / 2, 0.7, sampleRate),
    high: designBiquad('highshelf', pivotHz * 2, gainDb / 2, 0.7, sampleRate),
  };
}
