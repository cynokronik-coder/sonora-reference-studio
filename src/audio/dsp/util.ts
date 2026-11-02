/** Small numeric helpers shared by processors, analysis and UI. */

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(Math.max(g, 1e-12));
export const linToDb = gainToDb;

export const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

export const centsToRatio = (cents: number): number => Math.pow(2, cents / 1200);

/** One-pole smoothing coefficient for a given time constant in ms. */
export const onePoleCoeff = (ms: number, sampleRate: number): number => {
  if (ms <= 0) return 1;
  return 1 - Math.exp(-1 / ((ms / 1000) * sampleRate));
};

/** Time (ms) for an exponential parameter smoother. */
export class SmoothedValue {
  private current: number;
  private target: number;
  private coeff: number;

  constructor(value: number, timeMs = 12, sampleRate = 48000) {
    this.current = value;
    this.target = value;
    this.coeff = onePoleCoeff(timeMs, sampleRate);
  }

  setTimeConstant(ms: number, sampleRate: number) {
    this.coeff = onePoleCoeff(ms, sampleRate);
  }

  set(value: number) {
    this.target = value;
  }

  snap(value: number) {
    this.target = value;
    this.current = value;
  }

  get value() {
    return this.current;
  }

  next(): number {
    this.current += (this.target - this.current) * this.coeff;
    return this.current;
  }
}

/** Per-block linear ramp helper for click-free parameter changes. */
export class Ramp {
  from = 0;
  to = 0;
  private steps = 1;
  private index = 0;

  set(from: number, to: number, steps: number) {
    this.from = from;
    this.to = to;
    this.steps = Math.max(1, steps);
    this.index = 0;
  }

  value(): number {
    const t = Math.min(1, this.index / this.steps);
    const v = this.from + (this.to - this.from) * t;
    this.index++;
    return v;
  }
}

export function mean(arr: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return arr.length ? s / arr.length : 0;
}

export function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function percentile(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = clamp(p, 0, 1) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

export function rms(samples: ArrayLike<number>, start = 0, end = samples.length): number {
  let sum = 0;
  const n = end - start;
  if (n <= 0) return 0;
  for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / n);
}

export function peak(samples: ArrayLike<number>, start = 0, end = samples.length): number {
  let p = 0;
  for (let i = start; i < end; i++) p = Math.max(p, Math.abs(samples[i]));
  return p;
}

export function interleave(L: Float32Array, R: Float32Array): Float32Array {
  const out = new Float32Array(L.length * 2);
  for (let i = 0; i < L.length; i++) {
    out[i * 2] = L[i];
    out[i * 2 + 1] = R[i];
  }
  return out;
}

export function formatDb(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '-∞';
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;
}

export function formatLufs(v: number): string {
  return Number.isFinite(v) ? v.toFixed(1) : '—';
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatTimePrecise(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Deterministic PRNG for repeatable reverb diffusion / noise generation. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
