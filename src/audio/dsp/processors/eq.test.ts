import { describe, expect, it } from 'vitest';
import { Biquad, designBiquad, magnitudeDb } from '../biquad';
import { FirConvolver, designLinearPhaseFir } from '../fir';
import { createDefaultParams } from '../registry';
import { EQ_PRESETS, ParametricEq, eqDefinition } from './eq';

const SAMPLE_RATES = [44100, 48000, 96000];

function sine(amplitude: number, frequency: number, sampleRate: number, seconds = 2, phase = 0): Float32Array {
  const result = new Float32Array(Math.floor(sampleRate * seconds));
  for (let i = 0; i < result.length; i++) {
    result[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate + phase);
  }
  return result;
}

function rms(signal: Float32Array, sampleRate: number, fromSeconds = 0.5): number {
  const start = Math.min(signal.length, Math.floor(fromSeconds * sampleRate));
  let sum = 0;
  for (let i = start; i < signal.length; i++) sum += signal[i] * signal[i];
  return Math.sqrt(sum / Math.max(1, signal.length - start));
}

function processEq(eq: ParametricEq, left: Float32Array, right: Float32Array, blockSize = 512): void {
  for (let offset = 0; offset < left.length; offset += blockSize) {
    const frames = Math.min(blockSize, left.length - offset);
    eq.process(left.subarray(offset, offset + frames), right.subarray(offset, offset + frames), frames);
  }
}

function makeEq(params: Record<string, number>, sampleRate = 48000): ParametricEq {
  const eq = new ParametricEq();
  eq.prepare(sampleRate, 512);
  eq.setValues({ ...createDefaultParams('eq'), ...params });
  return eq;
}

describe('RBJ shelf stability', () => {
  it.each(SAMPLE_RATES)('keeps shelf coefficients finite at %i Hz', (sampleRate) => {
    for (const type of ['lowshelf', 'highshelf'] as const) {
      for (const gain of [-18, -12, 0, 12, 18]) {
        for (const slope of [0.1, 0.5, 1, 2, 18]) {
          const coefficients = designBiquad(type, Math.min(500, sampleRate * 0.2), gain, slope, sampleRate);
          expect(Object.values(coefficients).every(Number.isFinite)).toBe(true);
          for (const frequency of [20, 100, 500, 5000, Math.min(18000, sampleRate * 0.45)]) {
            expect(Number.isFinite(magnitudeDb(coefficients, frequency, sampleRate))).toBe(true);
          }
        }
      }
    }
  });

  it('caps shelf slope at the maximum monotonic RBJ value', () => {
    const lowA = designBiquad('lowshelf', 500, 12, 1, 48000);
    const lowB = designBiquad('lowshelf', 500, 12, 18, 48000);
    const highA = designBiquad('highshelf', 500, -12, 1, 48000);
    const highB = designBiquad('highshelf', 500, -12, 18, 48000);
    expect(lowB).toEqual(lowA);
    expect(highB).toEqual(highA);
  });
});

describe('Parametric EQ routing and parameter safety', () => {
  it('does not apply a side-only filter to a mono-compatible signal', () => {
    const sampleRate = 48000;
    const left = sine(0.2, 1000, sampleRate);
    const right = left.slice();
    const reference = left.slice();
    const eq = makeEq({
      b0_on: 1, b0_type: 0, b0_freq: 1000, b0_gain: 6, b0_q: 1, b0_route: 2,
    }, sampleRate);
    processEq(eq, left, right);
    let error = 0;
    for (let i = 0; i < left.length; i++) error = Math.max(error, Math.abs(left[i] - reference[i]));
    expect(error).toBeLessThan(1e-5);
  });

  it('does not apply a mid-only filter to an anti-phase side signal', () => {
    const sampleRate = 48000;
    const left = sine(0.2, 1000, sampleRate);
    const right = Float32Array.from(left, (sample) => -sample);
    const reference = left.slice();
    const eq = makeEq({
      b0_on: 1, b0_type: 0, b0_freq: 1000, b0_gain: 6, b0_q: 1, b0_route: 1,
    }, sampleRate);
    processEq(eq, left, right);
    let error = 0;
    for (let i = 0; i < left.length; i++) error = Math.max(error, Math.abs(left[i] - reference[i]));
    expect(error).toBeLessThan(1e-5);
  });

  it('applies a mid-only boost to mono material and a side-only boost to anti-phase material', () => {
    const sampleRate = 48000;
    const monoL = sine(0.1, 1000, sampleRate);
    const monoR = monoL.slice();
    const midEq = makeEq({ b0_on: 1, b0_type: 0, b0_freq: 1000, b0_gain: 6, b0_q: 1, b0_route: 1 }, sampleRate);
    const midInput = rms(monoL, sampleRate);
    processEq(midEq, monoL, monoR);
    expect(20 * Math.log10(rms(monoL, sampleRate) / midInput)).toBeCloseTo(6, 0);

    const sideL = sine(0.1, 1000, sampleRate);
    const sideR = Float32Array.from(sideL, (sample) => -sample);
    const sideInput = rms(sideL, sampleRate);
    const sideEq = makeEq({ b0_on: 1, b0_type: 0, b0_freq: 1000, b0_gain: 6, b0_q: 1, b0_route: 2 }, sampleRate);
    processEq(sideEq, sideL, sideR);
    expect(20 * Math.log10(rms(sideL, sampleRate) / sideInput)).toBeCloseTo(6, 0);
  });

  it('uses finite, bounded parameters for malformed imported EQ values', () => {
    const eq = makeEq({
      b0_on: 1,
      b0_type: 999,
      b0_freq: Number.POSITIVE_INFINITY,
      b0_gain: Number.NaN,
      b0_q: Number.POSITIVE_INFINITY,
      b0_route: -100,
      output: Number.NaN,
    });
    const left = sine(0.1, 1000, 48000, 1);
    const right = left.slice();
    processEq(eq, left, right);
    expect(left.every(Number.isFinite)).toBe(true);
    expect(right.every(Number.isFinite)).toBe(true);
    expect(eq.latency).toBe(0);
  });

  it('returns distinct, accurate mid and side curves for routed bands', () => {
    const params = {
      ...createDefaultParams('eq'),
      b0_on: 1,
      b0_type: 0,
      b0_freq: 1000,
      b0_gain: 6,
      b0_q: 1,
      b0_route: 1,
    };
    const frequencies = Float32Array.of(1000);
    const mid = ParametricEq.response(params, 48000, frequencies, 'mid');
    const side = ParametricEq.response(params, 48000, frequencies, 'side');
    expect(mid[0]).toBeCloseTo(6, 1);
    expect(side[0]).toBeCloseTo(0, 5);
  });
});

describe('Parametric EQ linear-phase latency', () => {
  it('uses a symmetric 513-tap kernel with exactly 256 samples of group delay', () => {
    const taps = designLinearPhaseFir([], 513);
    expect(taps.length).toBe(513);
    for (let i = 0; i < taps.length; i++) {
      expect(taps[i]).toBeCloseTo(taps[taps.length - 1 - i], 7);
    }
    const convolver = new FirConvolver(taps, 1);
    expect(convolver.latency).toBe(256);
  });

  it('places an impulse at the exact reported 256-sample linear-phase latency', () => {
    const sampleRate = 48000;
    const eq = makeEq({ ...Object.fromEntries(Array.from({ length: 8 }, (_, band) => [`b${band}_on`, 0])), linear: 1 }, sampleRate);
    expect(eq.latency).toBe(256);
    const left = new Float32Array(2048);
    const right = new Float32Array(2048);
    left[0] = 1;
    right[0] = 1;
    processEq(eq, left, right, 512);

    let peakIndex = 0;
    let peakValue = 0;
    for (let i = 0; i < left.length; i++) {
      if (Math.abs(left[i]) > peakValue) {
        peakValue = Math.abs(left[i]);
        peakIndex = i;
      }
    }
    expect(peakIndex).toBe(256);
    expect(peakValue).toBeCloseTo(1, 5);
  });
});

describe('EQ factory presets', () => {
  it('contains complete, finite and in-range parameter maps', () => {
    const specs = new Map(eqDefinition.params.map((spec) => [spec.key, spec]));
    expect(EQ_PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const preset of EQ_PRESETS) {
      expect(Object.keys(preset.values).sort()).toEqual([...specs.keys()].sort());
      for (const [key, value] of Object.entries(preset.values)) {
        const spec = specs.get(key);
        expect(spec, `unknown parameter ${key} in ${preset.name}`).toBeDefined();
        expect(Number.isFinite(value)).toBe(true);
        if (!spec) continue;
        if (spec.kind === 'bool') {
          expect([0, 1]).toContain(value);
        } else if (spec.kind === 'enum') {
          expect(Number.isInteger(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThan(spec.options?.length ?? 1);
        } else {
          expect(value).toBeGreaterThanOrEqual(spec.min ?? -Infinity);
          expect(value).toBeLessThanOrEqual(spec.max ?? Infinity);
          if (key.endsWith('_q') && (preset.values[key.replace(/_q$/, '_type')] === 1 || preset.values[key.replace(/_q$/, '_type')] === 2)) {
            expect(value).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});
