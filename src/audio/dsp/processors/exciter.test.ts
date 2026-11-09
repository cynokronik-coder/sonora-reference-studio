import { describe, expect, it } from 'vitest';
import { createDefaultParams } from '../registry';
import { EXCITER_MODES, EXCITER_PRESETS, Exciter, exciterDefinition } from './exciter';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 512;
const FRAME_COUNT = BLOCK_SIZE * 96;

function tone(frequency: number, amplitude: number, phase = 0): Float32Array {
  const result = new Float32Array(FRAME_COUNT);
  for (let i = 0; i < result.length; i++) {
    result[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE + phase);
  }
  return result;
}
function amplitudeAt(values: Float32Array, frequency: number, start = FRAME_COUNT / 2): number {
  let sinProjection = 0;
  let cosProjection = 0;
  let count = 0;
  for (let i = start; i < values.length; i++) {
    const angle = (2 * Math.PI * frequency * i) / SAMPLE_RATE;
    sinProjection += values[i] * Math.sin(angle);
    cosProjection += values[i] * Math.cos(angle);
    count++;
  }
  return (2 * Math.hypot(sinProjection, cosProjection)) / Math.max(1, count);
}
function mean(values: Float32Array, start = Math.floor(values.length / 2)): number {
  let sum = 0;
  for (let i = start; i < values.length; i++) sum += values[i];
  return sum / Math.max(1, values.length - start);
}
function render(values: Record<string, number>, sourceL: Float32Array, sourceR = sourceL) {
  const processor = new Exciter();
  processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
  processor.setValues(values);
  const left = sourceL.slice();
  const right = sourceR.slice();
  for (let start = 0; start < FRAME_COUNT; start += BLOCK_SIZE) {
    processor.process(left.subarray(start, start + BLOCK_SIZE), right.subarray(start, start + BLOCK_SIZE), BLOCK_SIZE);
  }
  return { left, right, meter: processor.meter() };
}
function renderLeftOnly(values: Record<string, number>, source: Float32Array): Float32Array {
  const processor = new Exciter();
  processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
  processor.setValues(values);
  const left = source.slice();
  const right = new Float32Array(FRAME_COUNT);
  for (let start = 0; start < FRAME_COUNT; start += BLOCK_SIZE) {
    processor.process(left.subarray(start, start + BLOCK_SIZE), right.subarray(start, start + BLOCK_SIZE), BLOCK_SIZE);
  }
  return left;
}
function defaults() {
  return {
    ...createDefaultParams('exciter'),
    frequency: 6_000,
    drive: 8,
    mode: 1,
    mix: 30,
    output: 0,
    oversample: 2,
  };
}

describe('Exciter high-band harmonic path', () => {
  it('returns the exact original dry signal at 0% amount after the 20 ms blend ramp settles', () => {
    const sourceL = tone(997, 0.37);
    const sourceR = tone(2_317, 0.19, 0.3);
    const result = render({ ...defaults(), mix: 0, drive: 24, output: 0 }, sourceL, sourceR);
    expect(result.left.subarray(1_024)).toEqual(sourceL.subarray(1_024));
    expect(result.right.subarray(1_024)).toEqual(sourceR.subarray(1_024));
  });

  it('leaves low-frequency programme content substantially unchanged', () => {
    const source = tone(100, 0.5);
    const result = render({ ...defaults(), frequency: 7_000, drive: 20, mix: 100 }, source);
    let maximumDifference = 0;
    for (let i = 4_096; i < FRAME_COUNT; i++) {
      maximumDifference = Math.max(maximumDifference, Math.abs(result.left[i] - source[i]));
    }
    expect(maximumDifference).toBeLessThan(0.002);
    expect(Math.abs(amplitudeAt(result.left, 100, 4_096) - 0.5)).toBeLessThan(0.001);
  });

  it('adds measurable harmonics to a signal inside the selected upper band', () => {
    const source = tone(9_000, 0.55);
    const result = render({ ...defaults(), frequency: 3_000, drive: 18, mode: 1, mix: 100, oversample: 0 }, source);
    const secondHarmonic = amplitudeAt(result.left, 18_000);
    expect(secondHarmonic).toBeGreaterThan(0.005);
    expect(secondHarmonic).toBeGreaterThan(amplitudeAt(source, 18_000) + 0.01);
  });

  it('reduces a folded third-harmonic alias when moving from 1x to 4x', () => {
    const source = tone(9_000, 0.7);
    const off = render({ ...defaults(), frequency: 3_000, drive: 20, mode: 4, mix: 100, oversample: 0 }, source);
    const fourX = render({ ...defaults(), frequency: 3_000, drive: 20, mode: 4, mix: 100, oversample: 2 }, source);
    const aliasOff = amplitudeAt(off.left, 21_000);
    const aliasFourX = amplitudeAt(fourX.left, 21_000);
    expect(aliasOff).toBeGreaterThan(0.002);
    expect(aliasFourX).toBeLessThan(aliasOff * 0.9);
  });

  it('keeps left and right high-pass and oversampling histories independent', () => {
    const values = { ...defaults(), frequency: 4_500, drive: 11, mode: 1, mix: 100, oversample: 1 };
    const leftSource = tone(7_000, 0.5);
    const rightSource = tone(11_000, 0.2, 0.35);
    const stereo = render(values, leftSource, rightSource);
    const leftSolo = renderLeftOnly(values, leftSource);
    const rightSolo = renderLeftOnly(values, rightSource);
    for (let i = 2_000; i < FRAME_COUNT; i++) {
      expect(stereo.left[i]).toBeCloseTo(leftSolo[i], 6);
      expect(stereo.right[i]).toBeCloseTo(rightSolo[i], 6);
    }
  });

  it('removes asymmetric-shaper DC offset from the generated harmonic difference', () => {
    const source = tone(8_000, 0.7);
    const result = render({ ...defaults(), frequency: 3_000, drive: 20, mode: 1, mix: 100 }, source);
    expect(Math.abs(mean(result.left))).toBeLessThan(0.002);
    expect(Math.abs(mean(result.right))).toBeLessThan(0.002);
  });

  it('keeps output finite while crossover drive amount style and output change', () => {
    const processor = new Exciter();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    for (let block = 0; block < 36; block++) {
      processor.setValues({
        ...defaults(),
        frequency: 2_500 + (block % 20) * 500,
        drive: 2 + (block % 20),
        mode: block % EXCITER_MODES.length,
        mix: (block % 5) * 25,
        output: -3 + (block % 6),
        oversample: block % 3,
      });
      left.set(tone(8_000, 0.5).subarray(0, BLOCK_SIZE));
      right.set(tone(10_000, 0.3, 0.2).subarray(0, BLOCK_SIZE));
      processor.process(left, right, BLOCK_SIZE);
      for (const sample of left) expect(Number.isFinite(sample)).toBe(true);
      for (const sample of right) expect(Number.isFinite(sample)).toBe(true);
    }
  });

  it('processes the prepared render block and rejects blocks over capacity', () => {
    const processor = new Exciter();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    processor.setValues(defaults());
    const left = tone(8_000, 0.4).subarray(0, BLOCK_SIZE);
    const right = tone(10_000, 0.2).subarray(0, BLOCK_SIZE);
    expect(() => processor.process(left, right, BLOCK_SIZE)).not.toThrow();
    expect(() => processor.process(new Float32Array(BLOCK_SIZE + 1), new Float32Array(BLOCK_SIZE + 1), BLOCK_SIZE + 1)).toThrow(RangeError);
  });
});

describe('Exciter factory presets', () => {
  it('contains complete valid parameter maps for every starting point', () => {
    const specs = new Map(exciterDefinition.params.map((param) => [param.key, param]));
    expect(EXCITER_PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const preset of EXCITER_PRESETS) {
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
