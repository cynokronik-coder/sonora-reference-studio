import { describe, expect, it } from 'vitest';
import { createDefaultParams } from '../registry';
import { DYNAMIC_EQ_PRESETS, DynamicEq, dynamicEqDefinition } from './dynamicEq';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 256;
const FRAME_COUNT = SAMPLE_RATE;

function tone(frequency: number, amplitude: number, start: number, frames: number): Float32Array {
  const result = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    result[i] = amplitude * Math.sin((2 * Math.PI * frequency * (start + i)) / SAMPLE_RATE);
  }
  return result;
}

function rms(values: Float32Array, from = Math.floor(values.length / 2)): number {
  let energy = 0;
  for (let i = from; i < values.length; i++) energy += values[i] * values[i];
  return Math.sqrt(energy / Math.max(1, values.length - from));
}

function render(
  values: Record<string, number>,
  leftAmplitude: number,
  rightAmplitude: number,
  frequency = 1_000,
) {
  const processor = new DynamicEq();
  processor.prepare(SAMPLE_RATE);
  processor.setValues(values);
  const left = new Float32Array(FRAME_COUNT);
  const right = new Float32Array(FRAME_COUNT);
  for (let start = 0; start < FRAME_COUNT; start += BLOCK_SIZE) {
    const l = tone(frequency, leftAmplitude, start, BLOCK_SIZE);
    const r = tone(frequency, rightAmplitude, start, BLOCK_SIZE);
    left.set(l, start);
    right.set(r, start);
    processor.process(left.subarray(start, start + BLOCK_SIZE), right.subarray(start, start + BLOCK_SIZE), BLOCK_SIZE);
  }
  return { left, right, meter: processor.meter() };
}

function bandZeroSettings() {
  return {
    ...createDefaultParams('dynamicEq'),
    b0_on: 1,
    b0_freq: 1_000,
    b0_q: 12,
    b0_threshold: -20,
    b0_ratio: 4,
    b0_range: 18,
    b0_attack: 0.1,
    b0_release: 100,
  };
}

describe('Dynamic EQ detection', () => {
  it('does not create a false 1 kHz trigger from a rectified 500 Hz signal', () => {
    const result = render({ ...bandZeroSettings(), b0_link: 100 }, 0.8, 0.8, 500);
    expect(Math.abs(result.meter.bands?.[0] ?? 0)).toBeLessThan(0.5);
  });

  it('detects and reduces an actual signal at the selected frequency', () => {
    const result = render({ ...bandZeroSettings(), b0_link: 100 }, 0.8, 0.8, 1_000);
    expect(result.meter.reduction ?? 0).toBeGreaterThan(5);
    expect(rms(result.left)).toBeLessThan(rms(tone(1_000, 0.8, 0, FRAME_COUNT)) * 0.6);
  });

  it('uses independent channel envelopes at 0% stereo link', () => {
    const result = render({ ...bandZeroSettings(), b0_link: 0 }, 0.8, 0.05, 1_000);
    const inputLeft = rms(tone(1_000, 0.8, 0, FRAME_COUNT));
    const inputRight = rms(tone(1_000, 0.05, 0, FRAME_COUNT));
    const leftGain = rms(result.left) / inputLeft;
    const rightGain = rms(result.right) / inputRight;
    expect(leftGain).toBeLessThan(0.6);
    expect(rightGain).toBeGreaterThan(0.9);
    expect(leftGain).toBeLessThan(rightGain * 0.7);
  });

  it('uses identical gain reduction on both channels at 100% stereo link', () => {
    const result = render({ ...bandZeroSettings(), b0_link: 100 }, 0.8, 0.05, 1_000);
    const inputLeft = rms(tone(1_000, 0.8, 0, FRAME_COUNT));
    const inputRight = rms(tone(1_000, 0.05, 0, FRAME_COUNT));
    const leftGain = rms(result.left) / inputLeft;
    const rightGain = rms(result.right) / inputRight;
    expect(leftGain).toBeCloseTo(rightGain, 3);
    expect(result.meter.reduction ?? 0).toBeGreaterThan(5);
  });

  it('keeps output finite while frequency and filter gain are moving', () => {
    const processor = new DynamicEq();
    processor.prepare(SAMPLE_RATE);
    processor.setValues({ ...bandZeroSettings(), b0_link: 50 });
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    for (let block = 0; block < 20; block++) {
      processor.setValues({
        ...bandZeroSettings(),
        b0_freq: 800 + block * 100,
        b0_link: 50,
      });
      left.set(tone(1_000, 0.8, block * BLOCK_SIZE, BLOCK_SIZE));
      right.set(tone(1_000, 0.4, block * BLOCK_SIZE, BLOCK_SIZE));
      processor.process(left, right, BLOCK_SIZE);
      for (const sample of left) expect(Number.isFinite(sample)).toBe(true);
      for (const sample of right) expect(Number.isFinite(sample)).toBe(true);
    }
  });
});

describe('Dynamic EQ factory presets', () => {
  it('contains complete valid parameter maps for every starting point', () => {
    const specs = new Map(dynamicEqDefinition.params.map((param) => [param.key, param]));
    for (const preset of DYNAMIC_EQ_PRESETS) {
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
