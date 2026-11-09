import { describe, expect, it } from 'vitest';
import { MultibandCompressor, MULTIBAND_COMP_PRESETS, multibandCompDefinition } from './multiband';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 256;
const FRAME_COUNT = SAMPLE_RATE;

function completeDefaults(): Record<string, number> {
  return Object.fromEntries(multibandCompDefinition.params.map((param) => [param.key, param.default]));
}

function makeTone(frequency: number, amplitude: number, start: number, frames: number): Float32Array {
  const result = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    result[i] = amplitude * Math.sin((2 * Math.PI * frequency * (start + i)) / SAMPLE_RATE);
  }
  return result;
}

function runSidechainCase(keyFrequency: number): number {
  const processor = new MultibandCompressor();
  processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
  processor.setValues({
    ...completeDefaults(),
    xLow: 180,
    xHigh: 4_500,
    b0_on: 1,
    b0_threshold: -36,
    b0_ratio: 12,
    b0_attack: 0.1,
    b0_release: 100,
    b0_knee: 0,
    b1_on: 0,
    b2_on: 0,
  });

  const targetL = new Float32Array(BLOCK_SIZE);
  const targetR = new Float32Array(BLOCK_SIZE);
  const keyL = new Float32Array(BLOCK_SIZE);
  const keyR = new Float32Array(BLOCK_SIZE);
  for (let start = 0; start < FRAME_COUNT; start += BLOCK_SIZE) {
    const target = makeTone(80, 0.12, start, BLOCK_SIZE);
    const key = makeTone(keyFrequency, 0.8, start, BLOCK_SIZE);
    targetL.set(target);
    targetR.set(target);
    keyL.set(key);
    keyR.set(key);
    processor.setSidechain(keyL, keyR);
    processor.process(targetL, targetR, BLOCK_SIZE);
  }
  return Math.abs(processor.meter().bands?.[0] ?? 0);
}

describe('MultibandCompressor', () => {
  it('reconstructs unity magnitude when all three compressors are bypassed', () => {
    const processor = new MultibandCompressor();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    processor.setValues({
      ...completeDefaults(),
      b0_on: 0,
      b1_on: 0,
      b2_on: 0,
    });

    let inputPower = 0;
    let outputPower = 0;
    let count = 0;
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    for (let start = 0; start < FRAME_COUNT; start += BLOCK_SIZE) {
      const input = makeTone(1_000, 0.5, start, BLOCK_SIZE);
      left.set(input);
      right.set(input);
      processor.process(left, right, BLOCK_SIZE);
      if (start >= FRAME_COUNT / 2) {
        for (let i = 0; i < BLOCK_SIZE; i++) {
          inputPower += input[i] * input[i];
          outputPower += left[i] * left[i];
          count++;
        }
      }
    }
    const ratio = Math.sqrt(outputPower / Math.max(1, inputPower));
    expect(count).toBeGreaterThan(0);
    expect(ratio).toBeGreaterThan(0.97);
    expect(ratio).toBeLessThan(1.03);
  });

  it('splits an external sidechain into the same frequency bands as the programme', () => {
    const highKeyReduction = runSidechainCase(8_000);
    const lowKeyReduction = runSidechainCase(80);
    expect(lowKeyReduction).toBeGreaterThan(6);
    expect(highKeyReduction).toBeLessThan(0.5);
  });

  it('supports band solo without changing the stored compression enable state', () => {
    const processor = new MultibandCompressor();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    processor.setValues({
      ...completeDefaults(),
      b0_on: 0,
      b1_on: 0,
      b2_on: 0,
      b0_solo: 1,
    });

    let highProjection = 0;
    let highReferencePower = 0;
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    for (let start = 0; start < FRAME_COUNT; start += BLOCK_SIZE) {
      for (let i = 0; i < BLOCK_SIZE; i++) {
        const absolute = start + i;
        left[i] = 0.3 * Math.sin((2 * Math.PI * 80 * absolute) / SAMPLE_RATE)
          + 0.3 * Math.sin((2 * Math.PI * 10_000 * absolute) / SAMPLE_RATE);
        right[i] = left[i];
      }
      processor.process(left, right, BLOCK_SIZE);
      if (start >= FRAME_COUNT / 2) {
        for (let i = 0; i < BLOCK_SIZE; i++) {
          const reference = Math.sin((2 * Math.PI * 10_000 * (start + i)) / SAMPLE_RATE);
          highProjection += left[i] * reference;
          highReferencePower += reference * reference;
        }
      }
    }
    expect(Math.abs(highProjection / highReferencePower)).toBeLessThan(0.01);
  });

  it('reports maximum reduction and individual band reductions with negative gain values', () => {
    const processor = new MultibandCompressor();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    processor.setValues({
      ...completeDefaults(),
      b0_on: 1,
      b0_threshold: -42,
      b0_ratio: 10,
      b0_attack: 0.1,
      b1_on: 0,
      b2_on: 0,
    });
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    for (let start = 0; start < FRAME_COUNT; start += BLOCK_SIZE) {
      const tone = makeTone(70, 0.9, start, BLOCK_SIZE);
      left.set(tone);
      right.set(tone);
      processor.process(left, right, BLOCK_SIZE);
    }
    const meter = processor.meter();
    expect(meter.reduction).toBeGreaterThan(2);
    expect(meter.bands).toHaveLength(3);
    expect(meter.bands?.[0]).toBeLessThan(-2);
  });

  it('keeps all factory presets complete and within the live parameter registry', () => {
    const specs = new Map(multibandCompDefinition.params.map((param) => [param.key, param]));
    for (const preset of MULTIBAND_COMP_PRESETS) {
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
        }
      }
    }
  });
});
