import { describe, expect, it } from 'vitest';
import { FirConvolver, designLinearPhaseFir } from '../fir';
import { createDefaultParams } from '../registry';
import { ParametricEq, EQ_LINEAR_PHASE_LATENCY, EQ_LINEAR_PHASE_TAPS, EQ_PRESETS, eqDefinition } from './eq';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 256;

function renderEq(values: Record<string, number>, leftInput: Float32Array, rightInput: Float32Array) {
  const left = leftInput.slice();
  const right = rightInput.slice();
  const eq = new ParametricEq();
  eq.prepare(SAMPLE_RATE, BLOCK_SIZE);
  eq.setValues(values);
  for (let start = 0; start < left.length; start += BLOCK_SIZE) {
    const frames = Math.min(BLOCK_SIZE, left.length - start);
    eq.process(left.subarray(start, start + frames), right.subarray(start, start + frames), frames);
  }
  return { left, right, eq };
}

function rms(values: Float32Array, start = Math.floor(values.length / 2)): number {
  let energy = 0;
  for (let i = start; i < values.length; i++) energy += values[i] * values[i];
  return Math.sqrt(energy / Math.max(1, values.length - start));
}

describe('Parametric EQ routing and response', () => {
  it('applies a mid-routed band without changing a pure side signal', () => {
    const values = { ...createDefaultParams('eq'), b0_on: 1, b0_type: 0, b0_freq: 1_000, b0_gain: 9, b0_q: 1, b0_route: 1 };
    const left = new Float32Array(SAMPLE_RATE);
    const right = new Float32Array(SAMPLE_RATE);
    for (let i = 0; i < left.length; i++) {
      const sample = 0.2 * Math.sin((2 * Math.PI * 1_000 * i) / SAMPLE_RATE);
      left[i] = sample;
      right[i] = -sample;
    }
    const result = renderEq(values, left, right);
    expect(rms(result.left)).toBeCloseTo(rms(left), 3);
    expect(rms(result.right)).toBeCloseTo(rms(right), 3);
  });

  it('applies a side-routed band without changing a pure mid signal', () => {
    const values = { ...createDefaultParams('eq'), b0_on: 1, b0_type: 0, b0_freq: 1_000, b0_gain: 9, b0_q: 1, b0_route: 2 };
    const mono = new Float32Array(SAMPLE_RATE);
    for (let i = 0; i < mono.length; i++) mono[i] = 0.2 * Math.sin((2 * Math.PI * 1_000 * i) / SAMPLE_RATE);
    const result = renderEq(values, mono, mono);
    expect(rms(result.left)).toBeCloseTo(rms(mono), 3);
    expect(rms(result.right)).toBeCloseTo(rms(mono), 3);
  });

  it('reports the measured minimum-phase cascade response for routed bands', () => {
    const values = { ...createDefaultParams('eq'), b0_on: 1, b0_type: 0, b0_freq: 1_000, b0_gain: 6, b0_q: 1 };
    const response = ParametricEq.response(values, SAMPLE_RATE, new Float32Array([100, 1_000, 10_000]));
    expect(Math.abs(response[0])).toBeLessThan(0.1);
    expect(response[1]).toBeCloseTo(6, 1);
    expect(Math.abs(response[2])).toBeLessThan(0.1);
  });

  it('clamps malformed type, routing, frequency, gain and Q values safely', () => {
    const values = { ...createDefaultParams('eq'), b0_on: 1, b0_type: 999, b0_route: -50, b0_freq: 1e9, b0_gain: 200, b0_q: 0 };
    const left = new Float32Array(BLOCK_SIZE).fill(0.2);
    const right = left.slice();
    const eq = new ParametricEq();
    eq.prepare(SAMPLE_RATE, BLOCK_SIZE);
    eq.setValues(values);
    eq.process(left, right, BLOCK_SIZE);
    for (const sample of left) expect(Number.isFinite(sample)).toBe(true);
    for (const sample of right) expect(Number.isFinite(sample)).toBe(true);
  });
});

describe('Parametric EQ linear-phase mode', () => {
  it('uses an odd symmetric FIR with the declared integer group delay', () => {
    expect(EQ_LINEAR_PHASE_TAPS).toBe(513);
    expect(EQ_LINEAR_PHASE_LATENCY).toBe(256);
    const taps = designLinearPhaseFir([], EQ_LINEAR_PHASE_TAPS);
    expect(taps).toHaveLength(EQ_LINEAR_PHASE_TAPS);
    for (let i = 0; i < taps.length; i++) expect(taps[i]).toBeCloseTo(taps[taps.length - 1 - i], 6);
    const convolver = new FirConvolver(taps, 1);
    convolver.prepare(512);
    const impulse = new Float32Array(512);
    impulse[0] = 1;
    convolver.process(impulse, impulse, 512);
    let peakIndex = 0;
    for (let i = 1; i < impulse.length; i++) if (Math.abs(impulse[i]) > Math.abs(impulse[peakIndex])) peakIndex = i;
    expect(peakIndex).toBe(EQ_LINEAR_PHASE_LATENCY);
    expect(impulse[peakIndex]).toBeCloseTo(1, 5);
  });

  it('reports exact integer latency when linear phase is enabled', () => {
    const eq = new ParametricEq();
    eq.prepare(SAMPLE_RATE, BLOCK_SIZE);
    eq.setValues({ ...createDefaultParams('eq'), linear: 1 });
    expect(eq.latency).toBe(EQ_LINEAR_PHASE_LATENCY);
    eq.setValues({ ...createDefaultParams('eq'), linear: 0 });
    expect(eq.latency).toBe(0);
  });

  it('keeps a rendered linear-phase signal finite', () => {
    const values = { ...createDefaultParams('eq'), linear: 1, b0_on: 1, b0_type: 0, b0_freq: 2_000, b0_gain: 3, b0_q: 1 };
    const source = new Float32Array(SAMPLE_RATE);
    for (let i = 0; i < source.length; i++) source[i] = 0.3 * Math.sin((2 * Math.PI * 2_000 * i) / SAMPLE_RATE);
    const rendered = renderEq(values, source, source);
    for (const sample of rendered.left) expect(Number.isFinite(sample)).toBe(true);
  });
});

describe('Parametric EQ factory presets', () => {
  it('contains complete valid parameter maps for every EQ preset', () => {
    const specs = new Map(eqDefinition.params.map((param) => [param.key, param]));
    for (const preset of EQ_PRESETS) {
      expect(Object.keys(preset.values).sort()).toEqual([...specs.keys()].sort());
      for (const [key, value] of Object.entries(preset.values)) {
        const spec = specs.get(key);
        expect(spec, `unknown parameter ${key} in ${preset.name}`).toBeDefined();
        expect(Number.isFinite(value)).toBe(true);
        if (!spec) continue;
        if (spec.kind === 'bool') expect([0, 1]).toContain(value);
        else if (spec.kind === 'enum') {
          expect(Number.isInteger(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThan(spec.options?.length ?? 1);
        } else {
          expect(value).toBeGreaterThanOrEqual(spec.min ?? -Infinity);
          expect(value).toBeLessThanOrEqual(spec.max ?? Infinity);
        }
      }
    }
  });
});
