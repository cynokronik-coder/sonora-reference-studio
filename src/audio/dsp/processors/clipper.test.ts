import { describe, expect, it } from 'vitest';
import { createDefaultParams } from '../registry';
import { CLIPPER_MODES, CLIPPER_PRESETS, Clipper, clipperDefinition } from './limiter';
import { dbToGain } from '../util';

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
function rms(values: Float32Array, start = Math.floor(values.length / 2)): number {
  let energy = 0;
  for (let i = start; i < values.length; i++) energy += values[i] * values[i];
  return Math.sqrt(energy / Math.max(1, values.length - start));
}
function render(values: Record<string, number>, sourceL: Float32Array, sourceR = sourceL) {
  const processor = new Clipper();
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
  const processor = new Clipper();
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
    ...createDefaultParams('clipper'),
    mode: 0, drive: 3, ceiling: -0.3, mix: 100, output: 0, oversample: 2,
  };
}

describe('Clipper transfer and render path', () => {
  it('returns exact dry samples at 0% mix after the 20 ms blend transition', () => {
    const sourceL = tone(997, 0.37);
    const sourceR = tone(2_317, 0.19, 0.3);
    const result = render({ ...defaults(), mode: 1, drive: 18, mix: 0, output: 0 }, sourceL, sourceR);
    expect(result.left.subarray(1_024)).toEqual(sourceL.subarray(1_024));
    expect(result.right.subarray(1_024)).toEqual(sourceR.subarray(1_024));
  });

  it('hard mode clamps the wet output to the internal clip ceiling at 1x', () => {
    const ceilingDb = -1;
    const source = tone(997, 1.4);
    const result = render({ ...defaults(), mode: 1, drive: 12, ceiling: ceilingDb, mix: 100, output: 0, oversample: 0 }, source);
    let peak = 0;
    for (let i = 4_096; i < FRAME_COUNT; i++) peak = Math.max(peak, Math.abs(result.left[i]));
    expect(peak).toBeLessThanOrEqual(dbToGain(ceilingDb) + 1e-5);
    expect(result.meter.reduction ?? 0).toBeGreaterThan(1);
  });

  it('soft mode reaches the ceiling continuously without exceeding it at 1x', () => {
    const ceilingDb = -1;
    const source = tone(440, 1.5);
    const result = render({ ...defaults(), mode: 0, drive: 12, ceiling: ceilingDb, mix: 100, output: 0, oversample: 0 }, source);
    let peak = 0;
    for (let i = 4_096; i < FRAME_COUNT; i++) peak = Math.max(peak, Math.abs(result.left[i]));
    expect(peak).toBeLessThanOrEqual(dbToGain(ceilingDb) + 1e-5);
    expect(peak).toBeGreaterThan(dbToGain(ceilingDb) * 0.98);
  });

  it('tanh mode creates rounded clipping and remains below the hard ceiling', () => {
    const ceilingDb = -1;
    const source = tone(440, 1.5);
    const result = render({ ...defaults(), mode: 2, drive: 12, ceiling: ceilingDb, mix: 100, output: 0, oversample: 0 }, source);
    let peak = 0;
    for (let i = 4_096; i < FRAME_COUNT; i++) peak = Math.max(peak, Math.abs(result.left[i]));
    expect(peak).toBeLessThan(dbToGain(ceilingDb));
    expect(peak).toBeGreaterThan(dbToGain(ceilingDb) * 0.8);
  });

  it('uses separate left/right oversampling histories', () => {
    const values = { ...defaults(), mode: 1, drive: 9, ceiling: -1, mix: 100, oversample: 1 };
    const sourceL = tone(430, 0.7);
    const sourceR = tone(1_700, 0.25, 0.35);
    const stereo = render(values, sourceL, sourceR);
    const leftSolo = renderLeftOnly(values, sourceL);
    const rightSolo = renderLeftOnly(values, sourceR);
    for (let i = 2_000; i < FRAME_COUNT; i++) {
      expect(stereo.left[i]).toBeCloseTo(leftSolo[i], 6);
      expect(stereo.right[i]).toBeCloseTo(rightSolo[i], 6);
    }
  });

  it('reduces folded third-harmonic alias energy at 4x compared with 1x', () => {
    const source = tone(9_000, 0.7);
    const off = render({ ...defaults(), mode: 1, drive: 18, ceiling: -0.5, mix: 100, oversample: 0 }, source);
    const fourX = render({ ...defaults(), mode: 1, drive: 18, ceiling: -0.5, mix: 100, oversample: 2 }, source);
    const aliasOff = amplitudeAt(off.left, 21_000);
    const aliasFourX = amplitudeAt(fourX.left, 21_000);
    expect(aliasOff).toBeGreaterThan(0.002);
    expect(aliasFourX).toBeLessThan(aliasOff * 0.9);
  });

  it('keeps output finite when mode drive ceiling mix and oversampling change', () => {
    const processor = new Clipper();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    processor.setValues(defaults());
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    for (let block = 0; block < 36; block++) {
      processor.setValues({
        ...defaults(),
        mode: block % CLIPPER_MODES.length,
        drive: 1 + (block % 18),
        ceiling: -0.2 - (block % 12) * 0.5,
        mix: (block % 5) * 25,
        output: -3 + (block % 6),
        oversample: block % 3,
      });
      left.set(tone(997, 0.8).subarray(0, BLOCK_SIZE));
      right.set(tone(3_000, 0.3, 0.2).subarray(0, BLOCK_SIZE));
      processor.process(left, right, BLOCK_SIZE);
      for (const sample of left) expect(Number.isFinite(sample)).toBe(true);
      for (const sample of right) expect(Number.isFinite(sample)).toBe(true);
    }
  });

  it('reports channel peaks and gain reduction', () => {
    const left = tone(440, 0.95);
    const right = tone(440, 0.15);
    const result = render({ ...defaults(), mode: 1, drive: 12, ceiling: -1, mix: 100, output: 0 }, left, right);
    expect(result.meter.reduction ?? 0).toBeGreaterThan(1);
    expect(result.meter.bands).toHaveLength(2);
    expect(result.meter.peakL ?? 0).toBeGreaterThan(result.meter.peakR ?? 0);
    expect(Number.isFinite(result.meter.peakL ?? 0)).toBe(true);
    expect(Number.isFinite(result.meter.peakR ?? 0)).toBe(true);
  });

  it('processes the prepared render block and rejects blocks over capacity', () => {
    const processor = new Clipper();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    processor.setValues(defaults());
    expect(() => processor.process(new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE), BLOCK_SIZE)).not.toThrow();
    expect(() => processor.process(new Float32Array(BLOCK_SIZE + 1), new Float32Array(BLOCK_SIZE + 1), BLOCK_SIZE + 1)).toThrow(RangeError);
  });
});

describe('Clipper factory presets', () => {
  it('contains complete valid parameter maps for every starting point', () => {
    const specs = new Map(clipperDefinition.params.map((param) => [param.key, param]));
    for (const preset of CLIPPER_PRESETS) {
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
