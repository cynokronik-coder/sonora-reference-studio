import { describe, expect, it } from 'vitest';
import { createDefaultParams } from '../registry';
import { DEESSER_PRESETS, DeEsser, deEsserDefinition } from './deesser';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 256;
const FRAME_COUNT = BLOCK_SIZE * 188;

function tone(frequency: number, amplitude: number, start: number, frames: number): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = amplitude * Math.sin((2 * Math.PI * frequency * (start + i)) / SAMPLE_RATE);
  return out;
}
function rms(values: Float32Array, start = Math.floor(values.length / 2)): number {
  let sum = 0;
  for (let i = start; i < values.length; i++) sum += values[i] * values[i];
  return Math.sqrt(sum / Math.max(1, values.length - start));
}
function projection(values: Float32Array, frequency: number, start = Math.floor(values.length / 2)): number {
  let sinProjection = 0;
  let cosProjection = 0;
  let count = 0;
  for (let i = start; i < values.length; i++) {
    const angle = (2 * Math.PI * frequency * i) / SAMPLE_RATE;
    sinProjection += values[i] * Math.sin(angle);
    cosProjection += values[i] * Math.cos(angle);
    count++;
  }
  // Magnitude of the sinusoidal component is phase independent.
  return (2 * Math.hypot(sinProjection, cosProjection)) / Math.max(1, count);
}

function render(values: Record<string, number>, leftSource: Float32Array, rightSource = leftSource) {
  const processor = new DeEsser();
  processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
  processor.setValues(values);
  const left = leftSource.slice();
  const right = rightSource.slice();
  for (let start = 0; start < left.length; start += BLOCK_SIZE) {
    processor.process(left.subarray(start, start + BLOCK_SIZE), right.subarray(start, start + BLOCK_SIZE), BLOCK_SIZE);
  }
  return { left, right, meter: processor.meter() };
}
function defaults() {
  return {
    ...createDefaultParams('deesser'),
    frequency: 6_500, threshold: -20, range: 12, ratio: 4,
    attack: 0.5, release: 60, link: 100, mode: 0, mix: 100, output: 0,
  };
}
function sine(frequency: number, amplitude: number): Float32Array {
  const out = new Float32Array(FRAME_COUNT);
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE);
  return out;
}

describe('De-esser split-band and wideband processing', () => {
  it('is transparent at 0% wet mix after the 20 ms blend ramp settles', () => {
    const left = sine(10_000, 0.8);
    const right = sine(10_000, 0.35);
    const result = render({ ...defaults(), mix: 0 }, left, right);
    expect(result.left.subarray(1_024)).toEqual(left.subarray(1_024));
    expect(result.right.subarray(1_024)).toEqual(right.subarray(1_024));
  });

  it('reduces a sibilant high-frequency tone and reports gain reduction', () => {
    const source = sine(10_000, 0.8);
    const result = render(defaults(), source);
    expect(result.meter.reduction ?? 0).toBeGreaterThan(3);
    expect(rms(result.left)).toBeLessThan(rms(source) * 0.85);
  });

  it('leaves low-frequency energy substantially intact in split-band mode', () => {
    const low = sine(250, 0.15);
    const high = sine(10_000, 0.8);
    const source = new Float32Array(FRAME_COUNT);
    for (let i = 0; i < source.length; i++) source[i] = low[i] + high[i];
    const result = render(defaults(), source);
    expect(Math.abs(projection(result.left, 250))).toBeCloseTo(0.15, 1);
    expect(Math.abs(projection(result.left, 10_000))).toBeLessThan(0.7);
  });

  it('wideband mode attenuates low-frequency content when sibilance triggers', () => {
    const low = sine(250, 0.15);
    const high = sine(10_000, 0.8);
    const source = new Float32Array(FRAME_COUNT);
    for (let i = 0; i < source.length; i++) source[i] = low[i] + high[i];
    const result = render({ ...defaults(), mode: 1 }, source);
    expect(Math.abs(projection(result.left, 250))).toBeLessThan(0.13);
  });

  it('uses independent envelopes at 0% stereo link', () => {
    const left = sine(10_000, 0.8);
    const right = sine(10_000, 0.05);
    const result = render({ ...defaults(), link: 0 }, left, right);
    const leftGain = rms(result.left) / rms(left);
    const rightGain = rms(result.right) / rms(right);
    expect(leftGain).toBeLessThan(0.8);
    expect(rightGain).toBeGreaterThan(0.9);
  });

  it('uses common gain reduction at 100% stereo link', () => {
    const left = sine(10_000, 0.8);
    const right = sine(10_000, 0.05);
    const result = render({ ...defaults(), link: 100 }, left, right);
    const leftGain = rms(result.left) / rms(left);
    const rightGain = rms(result.right) / rms(right);
    expect(leftGain).toBeCloseTo(rightGain, 2);
  });

  it('keeps output finite when the crossover is changed during processing', () => {
    const processor = new DeEsser();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    for (let block = 0; block < 30; block++) {
      processor.setValues({ ...defaults(), frequency: 4_000 + block * 150 });
      left.set(tone(10_000, 0.8, block * BLOCK_SIZE, BLOCK_SIZE));
      right.set(tone(10_000, 0.4, block * BLOCK_SIZE, BLOCK_SIZE));
      processor.process(left, right, BLOCK_SIZE);
      for (const sample of left) expect(Number.isFinite(sample)).toBe(true);
      for (const sample of right) expect(Number.isFinite(sample)).toBe(true);
    }
  });
});

describe('De-esser factory presets', () => {
  it('keeps every preset complete and within declared parameter bounds', () => {
    const specs = new Map(deEsserDefinition.params.map((param) => [param.key, param]));
    for (const preset of DEESSER_PRESETS) {
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
