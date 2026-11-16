import { describe, expect, it } from 'vitest';
import { createDefaultParams } from '../registry';
import { RESONANCE_PRESETS, ResonanceSuppressor, resonanceDefinition } from './resonance';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 256;
const FRAME_COUNT = SAMPLE_RATE;

function tone(frequency: number, amplitude: number, start: number, frames: number, sampleRate = SAMPLE_RATE): Float32Array {
  const result = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    result[i] = amplitude * Math.sin((2 * Math.PI * frequency * (start + i)) / sampleRate);
  }
  return result;
}

function rms(values: Float32Array, start = Math.floor(values.length / 2)): number {
  let energy = 0;
  for (let i = start; i < values.length; i++) energy += values[i] * values[i];
  return Math.sqrt(energy / Math.max(1, values.length - start));
}

function projection(values: Float32Array, frequency: number, start = Math.floor(values.length / 2)): number {
  let sinProjection = 0;
  let cosProjection = 0;
  for (let i = start; i < values.length; i++) {
    const angle = (2 * Math.PI * frequency * i) / SAMPLE_RATE;
    sinProjection += values[i] * Math.sin(angle);
    cosProjection += values[i] * Math.cos(angle);
  }
  return (2 * Math.hypot(sinProjection, cosProjection)) / Math.max(1, values.length - start);
}

function defaults() {
  return {
    ...createDefaultParams('resonance'),
    sensitivity: 50,
    range: 12,
    attack: 0.1,
    release: 100,
    link: 100,
    b0_on: 1,
    b0_freq: 3200,
    b0_q: 12,
    b0_threshold: -20,
    b1_on: 0,
    b2_on: 0,
    mix: 100,
    output: 0,
  };
}

function render(values: Record<string, number>, sourceL: Float32Array, sourceR = sourceL, sampleRate = SAMPLE_RATE) {
  const processor = new ResonanceSuppressor();
  processor.prepare(sampleRate, BLOCK_SIZE);
  processor.setValues(values);
  processor.reset();
  const left = sourceL.slice();
  const right = sourceR.slice();
  for (let start = 0; start < left.length; start += BLOCK_SIZE) {
    const frames = Math.min(BLOCK_SIZE, left.length - start);
    processor.process(left.subarray(start, start + frames), right.subarray(start, start + frames), frames);
  }
  return { left, right, meter: processor.meter() };
}

describe('Resonance suppressor processing', () => {
  it('keeps the previous 2 ms attack, 60 ms release and linked detector defaults', () => {
    const defaultsByKey = new Map(resonanceDefinition.params.map((spec) => [spec.key, spec.default]));
    expect(defaultsByKey.get('attack')).toBe(2);
    expect(defaultsByKey.get('release')).toBe(60);
    expect(defaultsByKey.get('link')).toBe(100);
  });

  it('keeps legacy parameter maps equivalent to explicit compatibility defaults', () => {
    const source = tone(3200, 0.8, 0, FRAME_COUNT);
    const legacy = {
      sensitivity: 50, range: 12, b0_on: 1, b0_freq: 3200, b0_q: 12, b0_threshold: -20,
      b1_on: 0, b2_on: 0, mix: 100, output: 0,
    };
    const fromLegacy = render(legacy, source);
    const explicit = render({ ...legacy, attack: 2, release: 60, link: 100 }, source);

    expect(fromLegacy.left).toEqual(explicit.left);
    expect(fromLegacy.right).toEqual(explicit.right);
  });

  it('is exactly dry at 0% mix and uses a linear parallel blend', () => {
    const source = tone(3200, 0.8, 0, FRAME_COUNT);
    const dry = render({ ...defaults(), mix: 0 }, source);
    expect(dry.left).toEqual(source);

    const wet = render({ ...defaults(), mix: 100 }, source);
    const half = render({ ...defaults(), mix: 50 }, source);
    for (let i = 0; i < source.length; i++) {
      expect(half.left[i]).toBeCloseTo((dry.left[i] + wet.left[i]) / 2, 5);
    }
  });

  it('reduces a narrow resonant tone while preserving unrelated low-frequency content', () => {
    const source = new Float32Array(FRAME_COUNT);
    for (let i = 0; i < source.length; i++) {
      source[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) + 0.5 * Math.sin((2 * Math.PI * 3200 * i) / SAMPLE_RATE);
    }
    const result = render(defaults(), source);

    expect(result.meter.reduction ?? 0).toBeGreaterThan(4);
    expect(Math.abs(projection(result.left, 3200))).toBeLessThan(0.35);
    expect(Math.abs(projection(result.left, 220))).toBeCloseTo(0.2, 1);
  });

  it('keeps left/right detection independent when unlinked and matches reductions when linked', () => {
    const left = tone(3200, 0.8, 0, FRAME_COUNT);
    const right = tone(3200, 0.05, 0, FRAME_COUNT);
    const independent = render({ ...defaults(), link: 0 }, left, right);
    const linked = render({ ...defaults(), link: 100 }, left, right);

    const independentRightGain = rms(independent.right) / rms(right);
    expect(rms(independent.left) / rms(left)).toBeLessThan(0.7);
    expect(independentRightGain).toBeGreaterThan(0.9);
    expect(rms(linked.left) / rms(left)).toBeCloseTo(rms(linked.right) / rms(right), 2);
  });

  it('remains finite and bounded while resonance frequencies and Q change', () => {
    const processor = new ResonanceSuppressor();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    let previousL = 0;
    let previousR = 0;
    let largestStep = 0;

    for (let block = 0; block < 40; block++) {
      const frequency = block % 2 === 0 ? 3200 : 6800;
      processor.setValues({ ...defaults(), b0_freq: frequency, b0_q: block % 2 === 0 ? 8 : 24 });
      const left = tone(4800, 0.75, block * BLOCK_SIZE, BLOCK_SIZE);
      const right = tone(4800, 0.4, block * BLOCK_SIZE, BLOCK_SIZE);
      processor.process(left, right, BLOCK_SIZE);
      for (let i = 0; i < BLOCK_SIZE; i++) {
        expect(Number.isFinite(left[i])).toBe(true);
        expect(Number.isFinite(right[i])).toBe(true);
        expect(Math.abs(left[i])).toBeLessThan(2);
        expect(Math.abs(right[i])).toBeLessThan(2);
        largestStep = Math.max(largestStep, Math.abs(left[i] - previousL), Math.abs(right[i] - previousR));
        previousL = left[i];
        previousR = right[i];
      }
    }
    expect(largestStep).toBeLessThan(1.5);
  });

  it('clears notch state on reset before processing a quiet signal', () => {
    const processor = new ResonanceSuppressor();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    processor.setValues(defaults());
    const loudL = tone(3200, 0.8, 0, BLOCK_SIZE);
    const loudR = tone(3200, 0.8, 0, BLOCK_SIZE);
    processor.process(loudL, loudR, BLOCK_SIZE);
    processor.reset();
    const quietL = tone(3200, 0.01, BLOCK_SIZE, BLOCK_SIZE);
    const quietR = quietL.slice();
    processor.process(quietL, quietR, BLOCK_SIZE);

    const expected = tone(3200, 0.01, BLOCK_SIZE, BLOCK_SIZE);
    let maximumError = 0;
    for (let i = 0; i < BLOCK_SIZE; i++) maximumError = Math.max(maximumError, Math.abs(quietL[i] - expected[i]));
    expect(maximumError).toBeLessThan(1e-7);
  });

  it('rejects blocks larger than the buffers allocated by prepare', () => {
    const processor = new ResonanceSuppressor();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    expect(() => processor.process(new Float32Array(BLOCK_SIZE + 1), new Float32Array(BLOCK_SIZE + 1), BLOCK_SIZE + 1)).toThrow(
      /exceeds its prepared buffers/,
    );
  });

  it('produces finite output at supported sample rates and near Nyquist', () => {
    for (const sampleRate of [44_100, 48_000, 96_000]) {
      const processor = new ResonanceSuppressor();
      processor.prepare(sampleRate, BLOCK_SIZE);
      processor.setValues({ ...defaults(), b0_freq: sampleRate * 0.44 });
      const left = tone(sampleRate * 0.44, 0.6, 0, BLOCK_SIZE, sampleRate);
      const right = tone(sampleRate * 0.44, 0.3, 0, BLOCK_SIZE, sampleRate);
      processor.process(left, right, BLOCK_SIZE);
      expect([...left, ...right].every(Number.isFinite)).toBe(true);
    }
  });
});

describe('Resonance suppressor presets', () => {
  it('keeps every starting point complete and inside parameter bounds', () => {
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
