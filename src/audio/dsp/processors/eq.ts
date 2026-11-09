import { Biquad, designBiquad, designTilt, type BiquadCoeffs } from '../biquad';
import { FirConvolver, designLinearPhaseFir } from '../fir';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp } from '../util';

export const EQ_BAND_COUNT = 8;
export const EQ_TYPES = ['Bell', 'Low shelf', 'High shelf', 'High pass', 'Low pass', 'Notch', 'Band pass', 'Tilt'] as const;
export const EQ_ROUTING = ['Stereo', 'Mid', 'Side'] as const;
export const EQ_LINEAR_PHASE_TAPS = 513;
export const EQ_LINEAR_PHASE_LATENCY = (EQ_LINEAR_PHASE_TAPS - 1) / 2;
const EQ_PARAMETER_SMOOTH_MS = 20;

const TYPE_MAP = ['peak', 'lowshelf', 'highshelf', 'highpass', 'lowpass', 'notch', 'bandpass', 'peak'] as const;
const PASSTHROUGH: BiquadCoeffs = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

/**
 * Parametric EQ with eight bands, stereo / mid / side routing and an optional
 * linear-phase mode implemented as a 513-tap symmetric FIR with an exact 256-sample group delay at 48 kHz.
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
  private outGainTarget = 1;
  private outGainStep = 0;
  private outGainRemaining = 0;
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
    return this.linear ? EQ_LINEAR_PHASE_LATENCY : 0;
  }

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = sampleRate;
    this.maxBlock = maxBlock;
    this.lastSignature = '';
    this.rebuild();
  }

  setValues(values: ParamValues): void {
    this.values = values;
    const nextOutGain = Math.pow(10, (values.output ?? 0) / 20);
    if (nextOutGain !== this.outGainTarget) {
      this.outGainTarget = nextOutGain;
      this.outGainRemaining = Math.max(1, Math.round(this.sr * (EQ_PARAMETER_SMOOTH_MS / 1000)));
      this.outGainStep = (this.outGainTarget - this.outGain) / this.outGainRemaining;
    }
    this.linear = (values.linear ?? 0) > 0.5;
    this.rebuild();
  }

  private bandValue(values: ParamValues, b: number, key: string, fallback: number): number {
    const v = values[`b${b}_${key}`];
    return typeof v === 'number' ? v : fallback;
  }

  private cascadeFor(path: 'mid' | 'side'): BiquadCoeffs[] {
    const out: BiquadCoeffs[] = [];
    for (let b = 0; b < EQ_BAND_COUNT; b++) {
      const on = this.bandValue(this.values, b, 'on', b === 0 ? 1 : 0) > 0.5;
      if (!on) continue;
      const route = clamp(Math.round(this.bandValue(this.values, b, 'route', 0)), 0, EQ_ROUTING.length - 1);
      if (path === 'mid' && route === 2) continue;
      if (path === 'side' && route === 1) continue;
      const type = clamp(Math.round(this.bandValue(this.values, b, 'type', 0)), 0, EQ_TYPES.length - 1);
      const freq = clamp(this.bandValue(this.values, b, 'freq', 1000), 20, Math.min(20000, this.sr * 0.49));
      const gain = clamp(this.bandValue(this.values, b, 'gain', 0), -18, 18);
      const q = clamp(this.bandValue(this.values, b, 'q', 1), 0.2, 18);
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

    const smoothingSamples = Math.max(1, Math.round(this.sr * (EQ_PARAMETER_SMOOTH_MS / 1000)));
    for (let b = 0; b < EQ_BAND_COUNT; b++) {
      const on = this.bandValue(this.values, b, 'on', b === 0 ? 1 : 0) > 0.5;
      const route = clamp(Math.round(this.bandValue(this.values, b, 'route', 0)), 0, EQ_ROUTING.length - 1);
      const type = clamp(Math.round(this.bandValue(this.values, b, 'type', 0)), 0, EQ_TYPES.length - 1);
      const freq = clamp(this.bandValue(this.values, b, 'freq', 1000), 20, Math.min(20000, this.sr * 0.49));
      const gain = clamp(this.bandValue(this.values, b, 'gain', 0), -18, 18);
      const q = clamp(this.bandValue(this.values, b, 'q', 1), 0.2, 18);
      const applyMidTarget = on && route !== 2;
      const applySideTarget = on && route !== 1;

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
        this.midFilters[b][slot].setSmoothed(midCoeffs[slot] ?? PASSTHROUGH, smoothingSamples);
        this.sideFilters[b][slot].setSmoothed(sideCoeffs[slot] ?? PASSTHROUGH, smoothingSamples);
      }
      // Keep inactive bands in the render loop only while they finish their
      // 20 ms transition back to a passthrough response.
      this.applyMid[b] = applyMidTarget;
      this.applySide[b] = applySideTarget;
    }

    if (this.linear) {
      const midTaps = designLinearPhaseFir(this.cascadeFor('mid'), EQ_LINEAR_PHASE_TAPS);
      const sideTaps = designLinearPhaseFir(this.cascadeFor('side'), EQ_LINEAR_PHASE_TAPS);
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
        const processMid = this.applyMid[b] || this.midFilters[b].some((filter) => filter.isSmoothing);
        const processSide = this.applySide[b] || this.sideFilters[b].some((filter) => filter.isSmoothing);
        if (processMid) {
          this.midFilters[b][0].processBlock(L, n);
          this.midFilters[b][1].processBlock(L, n);
        }
        if (processSide) {
          this.sideFilters[b][0].processBlock(R, n);
          this.sideFilters[b][1].processBlock(R, n);
        }
      }
    }

    for (let i = 0; i < n; i++) {
      if (this.outGainRemaining > 0) {
        this.outGain += this.outGainStep;
        this.outGainRemaining -= 1;
        if (this.outGainRemaining === 0) this.outGain = this.outGainTarget;
      }
      const m = L[i] * this.outGain;
      const s = R[i] * this.outGain;
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
      if ((values[`b${i}_on`] ?? (i === 0 ? 1 : 0)) < 0.5) continue;
      const route = clamp(Math.round(values[`b${i}_route`] ?? 0), 0, EQ_ROUTING.length - 1);
      if (routing === 'mid' && route === 2) continue;
      if (routing === 'side' && route === 1) continue;
      const type = clamp(Math.round(values[`b${i}_type`] ?? 0), 0, EQ_TYPES.length - 1);
      const freq = clamp(values[`b${i}_freq`] ?? 1000, 20, Math.min(20000, sampleRate * 0.49));
      const gain = clamp(values[`b${i}_gain`] ?? 0, -18, 18);
      const q = clamp(values[`b${i}_q`] ?? 1, 0.2, 18);
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
  const freqDefaults = [100, 250, 500, 1000, 2500, 5000, 8000, 12000];
  return [
    { key: `${p}_on`, label: 'Enabled', kind: 'bool' as const, default: index === 0 ? 1 : 0, group },
    { key: `${p}_type`, label: 'Type', kind: 'enum' as const, options: [...EQ_TYPES], default: 0, group },
    {
      key: `${p}_freq`, label: 'Frequency', kind: 'float' as const, min: 20, max: 20000, step: 1,
      default: freqDefaults[index], unit: 'Hz', scale: 'log' as const, group,
    },
    {
      key: `${p}_gain`, label: 'Gain', kind: 'float' as const, min: -18, max: 18, step: 0.1,
      default: 0, unit: 'dB', group,
    },
    { key: `${p}_q`, label: 'Q', kind: 'float' as const, min: 0.2, max: 18, step: 0.01, default: 1, group },
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
    { key: 'linear', label: 'Linear phase (5.3 ms at 48 kHz)', kind: 'bool', default: 0, advanced: true, group: 'Output' },
  ],
  create: () => new ParametricEq(),
};

export interface EqPreset {
  id: string;
  name: string;
  description: string;
  values: ParamValues;
}

function eqPreset(id: string, name: string, description: string, overrides: ParamValues): EqPreset {
  const values: ParamValues = {};
  for (const param of eqDefinition.params) values[param.key] = param.default;
  return { id, name, description, values: { ...values, ...overrides } };
}

/** Conservative, editable starting points; not automatic corrections or genre emulations. */
export const EQ_PRESETS: EqPreset[] = [
  eqPreset('low-end-cleanup', 'Low-end cleanup', 'Gently removes subsonic energy while leaving the main bass region intact.', {
    b0_on: 1, b0_type: 3, b0_freq: 28, b0_q: 0.707,
  }),
  eqPreset('reduce-mud', 'Reduce mud', 'A restrained low-mid cut to create space when the mix sounds congested.', {
    b0_on: 1, b0_type: 0, b0_freq: 280, b0_gain: -2, b0_q: 1.1,
  }),
  eqPreset('vocal-presence', 'Vocal presence', 'A small upper-mid lift with a subtle high shelf for articulation.', {
    b0_on: 1, b0_type: 0, b0_freq: 3_200, b0_gain: 1.2, b0_q: 0.9,
    b1_on: 1, b1_type: 2, b1_freq: 12_000, b1_gain: 0.7, b1_q: 0.7,
  }),
  eqPreset('air-and-clarity', 'Air and clarity', 'A gentle high shelf for extra openness; check sibilance and noise after applying.', {
    b0_on: 1, b0_type: 2, b0_freq: 11_000, b0_gain: 1.5, b0_q: 0.7,
  }),
  eqPreset('warm-balance', 'Warm balance', 'A modest low shelf with a soft high-frequency reduction.', {
    b0_on: 1, b0_type: 1, b0_freq: 120, b0_gain: 1, b0_q: 0.7,
    b1_on: 1, b1_type: 2, b1_freq: 9_000, b1_gain: -0.8, b1_q: 0.7,
  }),
  eqPreset('resonance-notch', 'Resonance notch', 'A narrow notch starting point for a known ringing frequency; move the frequency to the problem you hear.', {
    b0_on: 1, b0_type: 5, b0_freq: 2_800, b0_gain: -12, b0_q: 6,
  }),
  eqPreset('gentle-master-tilt', 'Gentle master tilt', 'A very small tonal tilt around the chosen pivot frequency.', {
    b0_on: 1, b0_type: 7, b0_freq: 800, b0_gain: 0.8, b0_q: 0.7,
  }),
];
