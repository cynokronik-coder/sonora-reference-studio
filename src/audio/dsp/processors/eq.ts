import { Biquad, designBiquad, designTilt, type BiquadCoeffs } from '../biquad';
import { FirConvolver, designLinearPhaseFir } from '../fir';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain } from '../util';

export const EQ_BAND_COUNT = 8;
export const EQ_TYPES = ['Bell', 'Low shelf', 'High shelf', 'High pass', 'Low pass', 'Notch', 'Band pass', 'Tilt'] as const;
export const EQ_ROUTING = ['Stereo', 'Mid', 'Side'] as const;

const TYPE_MAP = ['peak', 'lowshelf', 'highshelf', 'highpass', 'lowpass', 'notch', 'bandpass', 'peak'] as const;
const PASSTHROUGH: BiquadCoeffs = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
const FREQ_DEFAULTS = [100, 250, 500, 1000, 2500, 5000, 8000, 12000];

interface EqBandConfig {
  on: boolean;
  type: number;
  freq: number;
  gain: number;
  q: number;
  route: number;
}

function finiteParam(values: ParamValues, key: string, fallback: number): number {
  const value = values[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function eqBandConfig(values: ParamValues, band: number, sampleRate: number): EqBandConfig {
  const type = Math.round(clamp(finiteParam(values, `b${band}_type`, 0), 0, EQ_TYPES.length - 1));
  const route = Math.round(clamp(finiteParam(values, `b${band}_route`, 0), 0, EQ_ROUTING.length - 1));
  const nyquistLimit = Math.max(20, sampleRate * 0.49);
  const freq = clamp(finiteParam(values, `b${band}_freq`, FREQ_DEFAULTS[band]), 20, Math.min(20000, nyquistLimit));
  const gain = clamp(finiteParam(values, `b${band}_gain`, 0), -18, 18);
  // RBJ shelf slope S must not exceed 1. Other filter shapes use the
  // conventional Q range exposed in the processor controls.
  const q = type === 1 || type === 2
    ? clamp(finiteParam(values, `b${band}_q`, 0.7), 0.1, 1)
    : clamp(finiteParam(values, `b${band}_q`, 1), 0.2, 18);
  return {
    on: finiteParam(values, `b${band}_on`, band === 0 ? 1 : 0) > 0.5,
    type,
    freq,
    gain,
    q,
    route,
  };
}

function normalizedEqValues(values: ParamValues, sampleRate: number): ParamValues {
  const normalized: ParamValues = {};
  for (let band = 0; band < EQ_BAND_COUNT; band++) {
    const config = eqBandConfig(values, band, sampleRate);
    normalized[`b${band}_on`] = config.on ? 1 : 0;
    normalized[`b${band}_type`] = config.type;
    normalized[`b${band}_freq`] = config.freq;
    normalized[`b${band}_gain`] = config.gain;
    normalized[`b${band}_q`] = config.q;
    normalized[`b${band}_route`] = config.route;
  }
  normalized.output = clamp(finiteParam(values, 'output', 0), -18, 18);
  normalized.linear = finiteParam(values, 'linear', 0) > 0.5 ? 1 : 0;
  return normalized;
}

/**
 * Parametric EQ with eight bands, stereo / mid / side routing and an optional
 * linear-phase mode implemented as a 513-tap symmetric FIR.
 *
 * All processing happens in mid/side, which is mathematically identical to
 * left/right when a band is routed to both sides and necessary when it is not.
 * Minimum-phase filters keep state between blocks; the linear-phase path
 * convolves the identical magnitude response with a zero-phase FIR.
 */
export class ParametricEq implements AudioProcessor {
  readonly type = 'eq';
  private sr = 48000;
  private maxBlock = 256;
  private values: ParamValues = {};
  private midFilters: Biquad[][] = [];
  private sideFilters: Biquad[][] = [];
  private applyMid: boolean[] = [];
  private applySide: boolean[] = [];
  private linear = false;
  private convMid: FirConvolver | null = null;
  private convSide: FirConvolver | null = null;
  private preparedBlock = 0;
  private outGain = 1;
  private lastSignature = '';

  constructor() {
    for (let b = 0; b < EQ_BAND_COUNT; b++) {
      this.midFilters.push([new Biquad(), new Biquad()]);
      this.sideFilters.push([new Biquad(), new Biquad()]);
      this.applyMid.push(false);
      this.applySide.push(false);
    }
  }

  get latency(): number {
    return this.linear ? 256 : 0;
  }

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = sampleRate;
    this.maxBlock = maxBlock;
    this.lastSignature = '';
    this.rebuild();
  }

  setValues(values: ParamValues): void {
    this.values = normalizedEqValues(values, this.sr);
    this.outGain = dbToGain(this.values.output ?? 0);
    this.linear = (this.values.linear ?? 0) > 0.5;
    this.rebuild();
  }

  private bandValue(values: ParamValues, b: number, key: string, fallback: number): number {
    return finiteParam(values, `b${b}_${key}`, fallback);
  }

  private cascadeFor(path: 'mid' | 'side'): BiquadCoeffs[] {
    const out: BiquadCoeffs[] = [];
    for (let b = 0; b < EQ_BAND_COUNT; b++) {
      const config = eqBandConfig(this.values, b, this.sr);
      if (!config.on) continue;
      if (path === 'mid' && config.route === 2) continue;
      if (path === 'side' && config.route === 1) continue;
      const { type, freq, gain, q } = config;
      if (type === 7) {
        const tilt = designTilt(gain, this.sr, freq);
        out.push(tilt.low, tilt.high);
      } else {
        out.push(designBiquad(TYPE_MAP[type], freq, gain, q, this.sr));
      }
    }
    return out;
  }

  private rebuild(): void {
    const sig = this.signature();
    if (sig === this.lastSignature) return;
    this.lastSignature = sig;

    for (let b = 0; b < EQ_BAND_COUNT; b++) {
      const config = eqBandConfig(this.values, b, this.sr);
      const { on, route, type, freq, gain, q } = config;
      this.applyMid[b] = on && route !== 2;
      this.applySide[b] = on && route !== 1;

      const midCoeffs = on && route !== 2
        ? type === 7
          ? [designTilt(gain, this.sr, freq).low, designTilt(gain, this.sr, freq).high]
          : [designBiquad(TYPE_MAP[type], freq, gain, q, this.sr)]
        : [];
      const sideCoeffs = on && route !== 1
        ? type === 7
          ? [designTilt(gain, this.sr, freq).low, designTilt(gain, this.sr, freq).high]
          : [designBiquad(TYPE_MAP[type], freq, gain, q, this.sr)]
        : [];

      for (let slot = 0; slot < 2; slot++) {
        this.midFilters[b][slot].set(midCoeffs[slot] ?? PASSTHROUGH);
        this.sideFilters[b][slot].set(sideCoeffs[slot] ?? PASSTHROUGH);
      }
    }

    if (this.linear) {
      const midTaps = designLinearPhaseFir(this.cascadeFor('mid'), 513);
      const sideTaps = designLinearPhaseFir(this.cascadeFor('side'), 513);
      if (!this.convMid) {
        this.convMid = new FirConvolver(midTaps, 1);
        this.convSide = new FirConvolver(sideTaps, 1);
      }
      if (this.preparedBlock !== this.maxBlock) {
        this.convMid.prepare(this.maxBlock);
        this.convSide?.prepare(this.maxBlock);
        this.preparedBlock = this.maxBlock;
      }
      this.convMid.setTaps(midTaps);
      this.convSide?.setTaps(sideTaps);
    }
  }

  private signature(): string {
    let s = `${this.sr}|${this.linear ? 1 : 0}|${this.maxBlock}`;
    for (let b = 0; b < EQ_BAND_COUNT; b++) {
      s += `|${this.bandValue(this.values, b, 'on', b === 0 ? 1 : 0)}`;
      s += `,${this.bandValue(this.values, b, 'type', 0)}`;
      s += `,${this.bandValue(this.values, b, 'freq', 1000).toFixed(2)}`;
      s += `,${this.bandValue(this.values, b, 'gain', 0).toFixed(3)}`;
      s += `,${this.bandValue(this.values, b, 'q', 1).toFixed(3)}`;
      s += `,${this.bandValue(this.values, b, 'route', 0)}`;
    }
    return s;
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    for (let i = 0; i < n; i++) {
      const m = (L[i] + R[i]) * 0.5;
      const s = (L[i] - R[i]) * 0.5;
      L[i] = m;
      R[i] = s;
    }

    if (this.linear) {
      this.convMid?.process(L, L, n);
      this.convSide?.process(R, R, n);
    } else {
      for (let b = 0; b < EQ_BAND_COUNT; b++) {
        if (this.applyMid[b]) {
          this.midFilters[b][0].processBlock(L, n);
          this.midFilters[b][1].processBlock(L, n);
        }
        if (this.applySide[b]) {
          this.sideFilters[b][0].processBlock(R, n);
          this.sideFilters[b][1].processBlock(R, n);
        }
      }
    }

    const g = this.outGain;
    for (let i = 0; i < n; i++) {
      const m = L[i] * g;
      const s = R[i] * g;
      L[i] = m + s;
      R[i] = m - s;
    }
  }

  reset(): void {
    for (let b = 0; b < EQ_BAND_COUNT; b++) {
      for (const f of this.midFilters[b]) f.reset();
      for (const f of this.sideFilters[b]) f.reset();
    }
    this.convMid?.reset();
    this.convSide?.reset();
    this.lastSignature = '';
    this.rebuild();
  }

  meter(): ProcessorMeter {
    return {};
  }

  /** Magnitude response in dB for the UI curve. */
  static response(
    values: ParamValues,
    sampleRate: number,
    frequencies: Float32Array,
    routing: 'both' | 'mid' | 'side' = 'both',
    onlyBand?: number,
  ): Float32Array {
    const out = new Float32Array(frequencies.length);
    const coeffs: BiquadCoeffs[] = [];
    for (let i = 0; i < EQ_BAND_COUNT; i++) {
      if (onlyBand !== undefined && i !== onlyBand) continue;
      const config = eqBandConfig(values, i, sampleRate);
      if (!config.on) continue;
      const { route, type, freq, gain, q } = config;
      if (routing === 'mid' && route === 2) continue;
      if (routing === 'side' && route === 1) continue;
      if (type === 7) {
        const tilt = designTilt(gain, sampleRate, freq);
        coeffs.push(tilt.low, tilt.high);
      } else {
        coeffs.push(designBiquad(TYPE_MAP[type], freq, gain, q, sampleRate));
      }
    }
    for (let f = 0; f < frequencies.length; f++) {
      const w = (2 * Math.PI * frequencies[f]) / sampleRate;
      const cos1 = Math.cos(w), sin1 = Math.sin(w);
      const cos2 = Math.cos(2 * w), sin2 = Math.sin(2 * w);
      let db = 0;
      for (const c of coeffs) {
        const nr = c.b0 + c.b1 * cos1 + c.b2 * cos2;
        const ni = -(c.b1 * sin1 + c.b2 * sin2);
        const dr = 1 + c.a1 * cos1 + c.a2 * cos2;
        const di = -(c.a1 * sin1 + c.a2 * sin2);
        const den = Math.hypot(dr, di);
        if (den > 1e-12) db += 20 * Math.log10(Math.max(Math.hypot(nr, ni) / den, 1e-9));
      }
      out[f] = db;
    }
    return out;
  }
}

function bandParams(index: number) {
  const p = `b${index}`;
  const group = `Band ${index + 1}`;
  return [
    { key: `${p}_on`, label: 'Enabled', kind: 'bool' as const, default: index === 0 ? 1 : 0, group },
    { key: `${p}_type`, label: 'Type', kind: 'enum' as const, options: [...EQ_TYPES], default: 0, group },
    {
      key: `${p}_freq`, label: 'Frequency', kind: 'float' as const, min: 20, max: 20000, step: 1,
      default: FREQ_DEFAULTS[index], unit: 'Hz', scale: 'log' as const, group,
    },
    {
      key: `${p}_gain`, label: 'Gain', kind: 'float' as const, min: -18, max: 18, step: 0.1,
      default: 0, unit: 'dB', group,
    },
    { key: `${p}_q`, label: 'Q / Shelf slope', kind: 'float' as const, min: 0.1, max: 18, step: 0.01, default: 1, group },
    { key: `${p}_route`, label: 'Routing', kind: 'enum' as const, options: [...EQ_ROUTING], default: 0, advanced: true, group },
  ];
}

export const eqDefinition: ProcessorDefinition = {
  type: 'eq',
  name: 'Parametric EQ',
  shortName: 'EQ',
  category: 'eq',
  description: '8-band EQ with bell, shelf, filter and tilt shapes, mid/side routing and an optional linear-phase mode.',
  purpose: 'Shapes tonal balance. It is the primary tool the Reference Match engine uses to close frequency gaps.',
  params: [
    ...bandParams(0), ...bandParams(1), ...bandParams(2), ...bandParams(3),
    ...bandParams(4), ...bandParams(5), ...bandParams(6), ...bandParams(7),
    { key: 'output', label: 'Output', kind: 'float', min: -18, max: 18, step: 0.1, default: 0, unit: 'dB', group: 'Output' },
    { key: 'linear', label: 'Linear phase (10 ms latency)', kind: 'bool', default: 0, advanced: true, group: 'Output' },
  ],
  create: () => new ParametricEq(),
};
