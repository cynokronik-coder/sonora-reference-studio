import { describe, expect, it } from 'vitest';
import { designBiquad, magnitudeDb } from '../biquad';
import { ProcessorChain } from '../chain';
import { FirConvolver, designLinearPhaseFir } from '../fir';
import { createDefaultParams } from '../registry';
import { ParametricEq, EQ_LINEAR_PHASE_LATENCY, EQ_LINEAR_PHASE_TAPS, eqDefinition } from './eq';

const SAMPLE_RATES = [44_100, 48_000, 96_000];
const FILTER_TYPES = [0, 1, 2, 3, 4, 5, 6, 7];

function makeEq(values: Record<string, number>, sampleRate = 48_000, blockSize = 256): ParametricEq {
  const eq = new ParametricEq();
  eq.prepare(sampleRate, blockSize);
  eq.setValues({ ...createDefaultParams('eq'), ...values });
  return eq;
}

function processBlocks(eq: ParametricEq, left: Float32Array, right: Float32Array, blockSize: number): void {
  for (let offset = 0; offset < left.length; offset += blockSize) {
    const frames = Math.min(blockSize, left.length - offset);
    eq.process(left.subarray(offset, offset + frames), right.subarray(offset, offset + frames), frames);
  }
}

function magnitudeAt(taps: Float32Array, frequency: number, sampleRate: number): number {
  let real = 0;
  let imaginary = 0;
  for (let i = 0; i < taps.length; i++) {
    const phase = (2 * Math.PI * frequency * i) / sampleRate;
    real += taps[i] * Math.cos(phase);
    imaginary -= taps[i] * Math.sin(phase);
  }
  return Math.hypot(real, imaginary);
}

describe('RBJ filter stability', () => {
  it('caps shelf slope at the maximum monotonic RBJ value', () => {
    for (const type of ['lowshelf', 'highshelf'] as const) {
      expect(designBiquad(type, 500, 12, 18, 48_000))
        .toEqual(designBiquad(type, 500, 12, 1, 48_000));
    }
  });

  it.each(SAMPLE_RATES)('keeps every filter type finite at %i Hz and extreme inputs', (sampleRate) => {
    for (const type of FILTER_TYPES) {
      const eq = makeEq({
        b0_on: 1,
        b0_type: type,
        b0_freq: sampleRate * 10,
        b0_gain: 18,
        b0_q: 18,
      }, sampleRate);
      const left = Float32Array.from({ length: 2048 }, (_, i) => 0.2 * Math.sin(i * 0.071) + 0.1 * Math.cos(i * 0.013));
      const right = left.slice();
      processBlocks(eq, left, right, 256);
      expect(left.every(Number.isFinite)).toBe(true);
      expect(right.every(Number.isFinite)).toBe(true);
      expect(Math.max(...left.map(Math.abs))).toBeLessThan(100);

      const response = ParametricEq.response(
        { ...createDefaultParams('eq'), b0_on: 1, b0_type: type, b0_freq: sampleRate * 10, b0_gain: 18, b0_q: 18 },
        sampleRate,
        Float32Array.of(0, 20, sampleRate * 0.49, sampleRate / 2, Number.NaN),
      );
      expect(response.every(Number.isFinite)).toBe(true);
    }
  });

  it('bounds malformed imported parameters instead of producing NaN audio', () => {
    const eq = makeEq({
      b0_on: 1,
      b0_type: Number.POSITIVE_INFINITY,
      b0_freq: Number.POSITIVE_INFINITY,
      b0_gain: Number.NaN,
      b0_q: Number.NEGATIVE_INFINITY,
      b0_route: Number.NaN,
      output: Number.NaN,
    });
    const left = new Float32Array(1024).fill(0.1);
    const right = left.slice();
    processBlocks(eq, left, right, 256);
    expect(left.every(Number.isFinite)).toBe(true);
    expect(right.every(Number.isFinite)).toBe(true);
  });

  it('retains the established EQ parameter keys for saved projects and presets', () => {
    const keys = new Set(eqDefinition.params.map((param) => param.key));
    for (let band = 0; band < 8; band++) {
      for (const key of ['on', 'type', 'freq', 'gain', 'q', 'route']) {
        expect(keys.has(`b${band}_${key}`)).toBe(true);
      }
    }
    expect(keys.has('output')).toBe(true);
    expect(keys.has('linear')).toBe(true);
  });
});

describe('Parametric EQ response and smoothing', () => {
  it('reports the expected bell and high-pass magnitude response', () => {
    const bell = designBiquad('peak', 1_000, 6, 1, 48_000);
    expect(magnitudeDb(bell, 1_000, 48_000)).toBeCloseTo(6, 1);
    expect(Math.abs(magnitudeDb(bell, 100, 48_000))).toBeLessThan(0.1);

    const values = { ...createDefaultParams('eq'), b0_on: 1, b0_type: 3, b0_freq: 100, b0_q: 0.707 };
    const response = ParametricEq.response(values, 48_000, Float32Array.of(0, 100, 10_000));
    expect(response[0]).toBeLessThan(-80);
    expect(response[1]).toBeCloseTo(-3, 0);
    expect(Math.abs(response[2])).toBeLessThan(0.1);
  });

  it('includes the bounded output trim in the displayed response', () => {
    const response = ParametricEq.response(
      { ...createDefaultParams('eq'), b0_on: 0, output: 6 },
      48_000,
      Float32Array.of(100, 1_000, 10_000),
    );
    expect(response[0]).toBeCloseTo(6, 5);
    expect(response[1]).toBeCloseTo(6, 5);
    expect(response[2]).toBeCloseTo(6, 5);
  });

  it('ramps output trim rather than jumping to the new gain', () => {
    const eq = makeEq({});
    const first = Float32Array.of(1);
    const firstRight = Float32Array.of(1);
    eq.setValues({ ...createDefaultParams('eq'), output: 18 });
    eq.process(first, firstRight, 1);
    expect(first[0]).toBeGreaterThan(1);
    expect(first[0]).toBeLessThan(1.02);

    const rest = new Float32Array(959).fill(1);
    const restRight = rest.slice();
    eq.process(rest, restRight, rest.length);
    expect(rest[rest.length - 1]).toBeCloseTo(10 ** (18 / 20), 5);
  });

  it('shows distinct Mid and Side responses for routed filters', () => {
    const params = {
      ...createDefaultParams('eq'),
      b0_on: 1,
      b0_type: 0,
      b0_freq: 1_000,
      b0_gain: 6,
      b0_q: 1,
      b0_route: 1,
    };
    const frequency = Float32Array.of(1_000);
    expect(ParametricEq.response(params, 48_000, frequency, 'mid')[0]).toBeCloseTo(6, 1);
    expect(ParametricEq.response(params, 48_000, frequency, 'side')[0]).toBeCloseTo(0, 5);
  });
});

describe('Linear-phase EQ FIR', () => {
  it('uses a symmetric 513-tap kernel with exactly 256 samples of latency', () => {
    expect(EQ_LINEAR_PHASE_TAPS).toBe(513);
    expect(EQ_LINEAR_PHASE_LATENCY).toBe(256);
    const taps = designLinearPhaseFir([], EQ_LINEAR_PHASE_TAPS);
    expect(taps).toHaveLength(EQ_LINEAR_PHASE_TAPS);
    for (let i = 0; i < taps.length; i++) {
      expect(taps[i]).toBeCloseTo(taps[taps.length - 1 - i], 6);
    }

    const convolver = new FirConvolver(taps, 1);
    expect(convolver.latency).toBe(EQ_LINEAR_PHASE_LATENCY);
    convolver.prepare(512);
    const impulse = new Float32Array(512);
    impulse[0] = 1;
    convolver.process(impulse, new Float32Array(512), impulse.length);
    const peakIndex = impulse.findIndex((sample) => sample === Math.max(...impulse));
    expect(peakIndex).toBe(EQ_LINEAR_PHASE_LATENCY);
    expect(impulse[peakIndex]).toBeCloseTo(1, 5);
  });

  it('matches FIR convolution across blocks shorter than the kernel', () => {
    const taps = Float32Array.of(0, 0.25, 0.5, 0.25, 0);
    const convolver = new FirConvolver(taps, 1);
    convolver.prepare(2);
    const input = new Float32Array(20);
    input[0] = 1;
    const output = new Float32Array(input.length);
    for (let offset = 0; offset < input.length; offset += 2) {
      const block = input.slice(offset, offset + 2);
      convolver.process(block, new Float32Array(2), block.length);
      output.set(block, offset);
    }
    for (let i = 0; i < output.length; i++) expect(output[i]).toBeCloseTo(taps[i] ?? 0, 6);
  });

  it('clears overlap when the FIR kernel changes', () => {
    const convolver = new FirConvolver(Float32Array.of(0, 0.25, 0.5, 0.25, 0), 1);
    convolver.prepare(2);
    const impulse = Float32Array.of(1, 0);
    convolver.process(impulse, new Float32Array(2), impulse.length);
    convolver.setTaps(Float32Array.of(0, 0, 1, 0, 0));

    const silence = new Float32Array(2);
    convolver.process(silence, new Float32Array(2), silence.length);
    expect(silence).toEqual(new Float32Array(2));
  });

  it('keeps the default EQ dry and reports linear-phase latency only when enabled', () => {
    const values = createDefaultParams('eq');
    values.b0_on = 0;
    const eq = makeEq(values);
    const left = Float32Array.of(0.2, -0.3, 0.4, -0.5);
    const right = left.slice();
    const original = left.slice();
    eq.process(left, right, left.length);
    expect(left).toEqual(original);
    expect(eq.latency).toBe(0);

    const linear = makeEq({ ...values, linear: 1 }, 48_000, 512);
    expect(linear.latency).toBe(EQ_LINEAR_PHASE_LATENCY);
    const input = new Float32Array(512);
    const inputRight = new Float32Array(512);
    input[0] = 1;
    inputRight[0] = 1;
    linear.process(input, inputRight, input.length);
    expect(input[EQ_LINEAR_PHASE_LATENCY]).toBeCloseTo(1, 5);
  });

  it('bypasses the EQ chain node unchanged and excludes its latency', () => {
    const chain = new ProcessorChain(48_000, 256);
    const params = { ...createDefaultParams('eq'), linear: 1, b0_gain: 12 };
    chain.update([{ id: 'eq', type: 'eq', enabled: false, params }]);
    expect(chain.latency).toBe(0);

    const left = Float32Array.of(0.1, -0.2, 0.3, -0.4);
    const right = left.slice();
    const original = left.slice();
    chain.process(left, right, left.length);
    expect(left).toEqual(original);

    chain.update([{ id: 'eq', type: 'eq', enabled: true, params }]);
    expect(chain.latency).toBe(EQ_LINEAR_PHASE_LATENCY);
  });

  it('approximates the requested magnitude response with the linear-phase kernel', () => {
    const coeffs = designBiquad('peak', 1_000, 6, 1, 48_000);
    const taps = designLinearPhaseFir([coeffs], EQ_LINEAR_PHASE_TAPS);
    expect(20 * Math.log10(magnitudeAt(taps, 1_000, 48_000))).toBeCloseTo(6, 0);
    expect(Math.abs(20 * Math.log10(magnitudeAt(taps, 100, 48_000)))).toBeLessThan(0.5);
  });
});
