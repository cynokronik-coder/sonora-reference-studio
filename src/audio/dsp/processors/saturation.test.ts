import { describe, expect, it } from 'vitest';
import { createDefaultParams } from '../registry';
import { SATURATION_PRESETS, Saturator, SATURATION_MODES, saturationDefinition } from './saturation';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 512;
const FRAME_COUNT = BLOCK_SIZE * 96;

function tone(frequency: number, amplitude: number, phase = 0): Float32Array {
  const result = new Float32Array(FRAME_COUNT);
  for (let i = 0; i < result.length; i++) result[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE + phase);
  return result;
}
function amplitudeAt(values: Float32Array, frequency: number, start = FRAME_COUNT / 2): number {
  let real = 0, imag = 0, count = 0;
  for (let i = start; i < values.length; i++) {
    const angle = (2 * Math.PI * frequency * i) / SAMPLE_RATE;
    real += values[i] * Math.cos(angle);
    imag -= values[i] * Math.sin(angle);
    count++;
  }
  return (2 * Math.hypot(real, imag)) / Math.max(1, count);
}
function render(values: Record<string, number>, sourceL: Float32Array, sourceR = sourceL) {
  const processor = new Saturator();
  processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
  processor.setValues(values);
  const left = sourceL.slice(), right = sourceR.slice();
  for (let start = 0; start < FRAME_COUNT; start += BLOCK_SIZE) {
    processor.process(left.subarray(start, start + BLOCK_SIZE), right.subarray(start, start + BLOCK_SIZE), BLOCK_SIZE);
  }
  return { left, right, meter: processor.meter() };
}
function renderLeftOnly(values: Record<string, number>, source: Float32Array): Float32Array {
  const processor = new Saturator();
  processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
  processor.setValues(values);
  const left = source.slice(), right = new Float32Array(FRAME_COUNT);
  for (let start = 0; start < FRAME_COUNT; start += BLOCK_SIZE) {
    processor.process(left.subarray(start, start + BLOCK_SIZE), right.subarray(start, start + BLOCK_SIZE), BLOCK_SIZE);
  }
  return left;
}
function defaults() {
  return { ...createDefaultParams('saturation'), mode: 0, drive: 8, tone: 0, mix: 100, output: 0, oversample: 2 };
}

describe('Saturation stereo processing', () => {
  it('keeps left and right filter histories independent', () => {
    const values = { ...defaults(), mode: 1, drive: 10, tone: 5, oversample: 1 };
    const leftSource = tone(430, 0.5), rightSource = tone(1_700, 0.2, 0.35);
    const stereo = render(values, leftSource, rightSource);
    const leftSolo = renderLeftOnly(values, leftSource);
    const rightSolo = renderLeftOnly(values, rightSource);
    for (let i = 2_000; i < FRAME_COUNT; i++) {
      expect(stereo.left[i]).toBeCloseTo(leftSolo[i], 6);
      expect(stereo.right[i]).toBeCloseTo(rightSolo[i], 6);
    }
  });

  it('preserves a bit-transparent dry signal at 0% mix with 4x oversampling selected', () => {
    const sourceL = tone(997, 0.37), sourceR = tone(2_317, 0.19, 0.3);
    const result = render({ ...defaults(), mix: 0, oversample: 2, drive: 24, tone: 8 }, sourceL, sourceR);
    expect(result.left).toEqual(sourceL);
    expect(result.right).toEqual(sourceR);
  });

  it('keeps every waveshaping mode finite and genuinely changes the signal', () => {
    const source = tone(440, 0.65);
    for (let mode = 0; mode < SATURATION_MODES.length; mode++) {
      const result = render({ ...defaults(), mode, drive: 12, oversample: 1 }, source);
      let error = 0;
      for (let i = 0; i < FRAME_COUNT; i++) {
        expect(Number.isFinite(result.left[i])).toBe(true);
        error += (result.left[i] - source[i]) ** 2;
      }
      expect(error).toBeGreaterThan(0.01);
    }
  });

  it('processes the prepared render quantum without allocation-induced buffer errors', () => {
    const processor = new Saturator();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    processor.setValues(defaults());
    const left = tone(1_000, 0.4).subarray(0, BLOCK_SIZE);
    const right = tone(2_000, 0.2).subarray(0, BLOCK_SIZE);
    expect(() => processor.process(left, right, BLOCK_SIZE)).not.toThrow();
    for (const sample of left) expect(Number.isFinite(sample)).toBe(true);
    for (const sample of right) expect(Number.isFinite(sample)).toBe(true);
  });

  it('rejects blocks larger than prepared capacity instead of allocating on the audio thread', () => {
    const processor = new Saturator();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    expect(() => processor.process(new Float32Array(BLOCK_SIZE + 1), new Float32Array(BLOCK_SIZE + 1), BLOCK_SIZE + 1)).toThrow(RangeError);
  });

  it('keeps output finite while drive, tone, output, mix and style change', () => {
    const processor = new Saturator();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    processor.setValues(defaults());
    const left = new Float32Array(BLOCK_SIZE), right = new Float32Array(BLOCK_SIZE);
    for (let block = 0; block < 32; block++) {
      processor.setValues({
        ...defaults(), mode: block % SATURATION_MODES.length, drive: 2 + block * 0.7,
        tone: -5 + (block % 10), output: -3 + (block % 6), mix: 25 + (block % 4) * 25,
      });
      left.set(tone(1_000, 0.4).subarray(0, BLOCK_SIZE));
      right.set(tone(1_700, 0.2).subarray(0, BLOCK_SIZE));
      processor.process(left, right, BLOCK_SIZE);
      for (const sample of left) expect(Number.isFinite(sample)).toBe(true);
      for (const sample of right) expect(Number.isFinite(sample)).toBe(true);
    }
  });

  it('reduces a folded third-harmonic alias when switching from 1x to 4x', () => {
    const source = tone(9_000, 0.65);
    const off = render({ ...defaults(), mode: 4, drive: 15, oversample: 0 }, source);
    const fourX = render({ ...defaults(), mode: 4, drive: 15, oversample: 2 }, source);
    const aliasOff = amplitudeAt(off.left, 21_000);
    const aliasFourX = amplitudeAt(fourX.left, 21_000);
    expect(aliasOff).toBeGreaterThan(0.005);
    expect(aliasFourX).toBeLessThan(aliasOff * 0.8);
  });

  it('reports finite peak and drive meter values', () => {
    const result = render({ ...defaults(), mode: 1, drive: 14 }, tone(440, 0.7));
    expect(Number.isFinite(result.meter.peakL ?? 0)).toBe(true);
    expect(Number.isFinite(result.meter.peakR ?? 0)).toBe(true);
    expect(Number.isFinite(result.meter.gain ?? 0)).toBe(true);
  });
});

describe('Saturation factory presets', () => {
  it('contains complete valid parameter maps for each harmonic style', () => {
    const specs = new Map(saturationDefinition.params.map((param) => [param.key, param]));
    expect(SATURATION_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const preset of SATURATION_PRESETS) {
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
