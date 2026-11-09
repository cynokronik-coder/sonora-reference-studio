import { describe, expect, it } from 'vitest';
import { createDefaultParams } from '../registry';
import { RESONANCE_PRESETS, ResonanceSuppressor, resonanceDefinition } from './resonance';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 256;
const FRAME_COUNT = SAMPLE_RATE;

function tone(frequency: number, amplitude: number, start: number, frames: number): Float32Array {
  const result = new Float32Array(frames);
  for (let i = 0; i < frames; i++) result[i] = amplitude * Math.sin((2 * Math.PI * frequency * (start + i)) / SAMPLE_RATE);
  return result;
}
function rms(values: Float32Array, from = Math.floor(values.length / 2)): number {
  let energy = 0;
  for (let i = from; i < values.length; i++) energy += values[i] * values[i];
  return Math.sqrt(energy / Math.max(1, values.length - from));
}
function run(values: Record<string, number>, leftAmplitude = 0.8, rightAmplitude = 0.8, frequency = 3_200) {
  const processor = new ResonanceSuppressor();
  processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
  processor.setValues(values);
  const left = new Float32Array(FRAME_COUNT);
  const right = new Float32Array(FRAME_COUNT);
  for (let start = 0; start < FRAME_COUNT; start += BLOCK_SIZE) {
    left.set(tone(frequency, leftAmplitude, start, BLOCK_SIZE), start);
    right.set(tone(frequency, rightAmplitude, start, BLOCK_SIZE), start);
    processor.process(left.subarray(start, start + BLOCK_SIZE), right.subarray(start, start + BLOCK_SIZE), BLOCK_SIZE);
  }
  return { left, right, meter: processor.meter() };
}
function defaults() {
  return {
    ...createDefaultParams('resonance'),
    sensitivity: 50, range: 12, attack: 0.1, release: 100, link: 100,
    b0_on: 1, b0_freq: 3_200, b0_q: 12, b0_threshold: -20,
    b1_on: 0, b2_on: 0, mix: 100, output: 0,
  };
}

describe('Resonance suppressor signal path', () => {
  it('is bit-transparent at 0% wet mix', () => {
    const values = { ...defaults(), mix: 0 };
    const inputL = tone(3_200, 0.8, 0, FRAME_COUNT);
    const inputR = tone(3_200, 0.4, 0, FRAME_COUNT);
    const result = run(values, 0.8, 0.4);
    expect(result.left).toEqual(inputL);
    expect(result.right).toEqual(inputR);
  });

  it('reduces an actual resonant tone and reports per-band reduction', () => {
    const result = run(defaults());
    expect(result.meter.reduction ?? 0).toBeGreaterThan(4);
    expect(result.meter.bands).toHaveLength(3);
    expect(rms(result.left)).toBeLessThan(0.7 * rms(tone(3_200, 0.8, 0, FRAME_COUNT)));
  });

  it('does not strongly trigger on a distant frequency', () => {
    const result = run(defaults(), 0.8, 0.8, 500);
    expect(Math.abs(result.meter.bands?.[0] ?? 0)).toBeLessThan(1);
  });

  it('uses independent left/right gain envelopes at 0% stereo link', () => {
    const result = run({ ...defaults(), link: 0 }, 0.8, 0.05);
    const leftGain = rms(result.left) / rms(tone(3_200, 0.8, 0, FRAME_COUNT));
    const rightGain = rms(result.right) / rms(tone(3_200, 0.05, 0, FRAME_COUNT));
    expect(leftGain).toBeLessThan(0.7);
    expect(rightGain).toBeGreaterThan(0.9);
  });

  it('applies matching gain reduction at 100% stereo link', () => {
    const result = run({ ...defaults(), link: 100 }, 0.8, 0.05);
    const leftGain = rms(result.left) / rms(tone(3_200, 0.8, 0, FRAME_COUNT));
    const rightGain = rms(result.right) / rms(tone(3_200, 0.05, 0, FRAME_COUNT));
    expect(leftGain).toBeCloseTo(rightGain, 2);
  });

  it('keeps the signal finite when a band is disabled and its notch returns to passthrough', () => {
    const processor = new ResonanceSuppressor();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    processor.setValues(defaults());
    for (let block = 0; block < 20; block++) {
      left.set(tone(3_200, 0.8, block * BLOCK_SIZE, BLOCK_SIZE));
      right.set(tone(3_200, 0.8, block * BLOCK_SIZE, BLOCK_SIZE));
      processor.process(left, right, BLOCK_SIZE);
    }
    processor.setValues({ ...defaults(), b0_on: 0 });
    for (let block = 0; block < 20; block++) {
      left.set(tone(3_200, 0.8, (20 + block) * BLOCK_SIZE, BLOCK_SIZE));
      right.set(tone(3_200, 0.8, (20 + block) * BLOCK_SIZE, BLOCK_SIZE));
      processor.process(left, right, BLOCK_SIZE);
      for (const sample of left) expect(Number.isFinite(sample)).toBe(true);
      for (const sample of right) expect(Number.isFinite(sample)).toBe(true);
    }
  });
});

describe('Resonance suppressor factory presets', () => {
  it('keeps every preset complete and within declared parameter bounds', () => {
    const specs = new Map(resonanceDefinition.params.map((param) => [param.key, param]));
    for (const preset of RESONANCE_PRESETS) {
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
