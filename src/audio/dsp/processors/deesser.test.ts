import { describe, expect, it } from 'vitest';
import { createDefaultParams } from '../registry';
import { DEESSER_PRESETS, DeEsser, deEsserDefinition } from './deesser';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 256;
const FRAME_COUNT = BLOCK_SIZE * 96;

function sine(
  frequency: number,
  amplitude: number,
  frames = FRAME_COUNT,
  sampleRate = SAMPLE_RATE,
  startSample = 0,
): Float32Array {
  const result = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    result[i] = amplitude * Math.sin((2 * Math.PI * frequency * (startSample + i)) / sampleRate);
  }
  return result;
}

function rms(values: Float32Array, start = Math.floor(values.length / 2)): number {
  let energy = 0;
  for (let i = start; i < values.length; i++) energy += values[i] * values[i];
  return Math.sqrt(energy / Math.max(1, values.length - start));
}

function projection(values: Float32Array, frequency: number, start = Math.floor(values.length / 2), sampleRate = SAMPLE_RATE): number {
  let sinProjection = 0;
  let cosProjection = 0;
  for (let i = start; i < values.length; i++) {
    const angle = (2 * Math.PI * frequency * i) / sampleRate;
    sinProjection += values[i] * Math.sin(angle);
    cosProjection += values[i] * Math.cos(angle);
  }
  return (2 * Math.hypot(sinProjection, cosProjection)) / Math.max(1, values.length - start);
}

function defaults() {
  return {
    ...createDefaultParams('deesser'),
    frequency: 6500,
    threshold: -20,
    range: 12,
    ratio: 5,
    attack: 0.5,
    release: 60,
    link: 100,
    mode: 0,
    mix: 100,
    output: 0,
  };
}

function render(values: Record<string, number>, sourceL: Float32Array, sourceR = sourceL, sampleRate = SAMPLE_RATE) {
  const processor = new DeEsser();
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

describe('De-esser split-band processing', () => {
  it('preserves legacy 5:1 ratio and fully linked defaults for old parameter maps', () => {
    const defaultsByKey = new Map(deEsserDefinition.params.map((spec) => [spec.key, spec.default]));
    expect(defaultsByKey.get('ratio')).toBe(5);
    expect(defaultsByKey.get('link')).toBe(100);

    const oldValues = { frequency: 6500, threshold: -20, range: 12, attack: 0.5, release: 60, mode: 0 };
    const source = sine(10000, 0.8);
    const legacy = render(oldValues, source);
    const explicit = render({ ...oldValues, ratio: 5, link: 100, mix: 100, output: 0 }, source);
    expect(legacy.left).toEqual(explicit.left);
    expect(legacy.right).toEqual(explicit.right);
  });

  it('is exactly dry at 0% mix and uses a linear parallel blend', () => {
    const source = sine(10000, 0.8);
    const dry = render({ ...defaults(), mix: 0 }, source);
    expect(dry.left).toEqual(source);

    const wet = render({ ...defaults(), mix: 100 }, source);
    const half = render({ ...defaults(), mix: 50 }, source);
    for (let i = 0; i < source.length; i++) {
      expect(half.left[i]).toBeCloseTo((dry.left[i] + wet.left[i]) / 2, 5);
    }
  });

  it('reconstructs the LR4 crossover around and away from the split with no detection', () => {
    for (const sampleRate of [44_100, 48_000, 96_000]) {
      for (const frequency of [250, 3000, 6500, 10000]) {
        const source = sine(frequency, 0.3, FRAME_COUNT, sampleRate);
        const result = render({ ...defaults(), threshold: 0, range: 0 }, source, source, sampleRate);
        const gain = projection(result.left, frequency, Math.floor(FRAME_COUNT / 2), sampleRate) / 0.3;
        expect(gain).toBeGreaterThan(0.97);
        expect(gain).toBeLessThan(1.03);
      }
    }
  });

  it('reduces high-frequency sibilance while preserving the low band in split mode', () => {
    const low = sine(250, 0.15);
    const high = sine(10000, 0.8);
    const source = new Float32Array(FRAME_COUNT);
    for (let i = 0; i < source.length; i++) source[i] = low[i] + high[i];
    const result = render(defaults(), source);

    expect(result.meter.reduction ?? 0).toBeGreaterThan(3);
    expect(Math.abs(projection(result.left, 250))).toBeCloseTo(0.15, 1);
    expect(Math.abs(projection(result.left, 10000))).toBeLessThan(0.7);
  });

  it('applies detected reduction to low frequencies in wideband mode', () => {
    const low = sine(250, 0.15);
    const high = sine(10000, 0.8);
    const source = new Float32Array(FRAME_COUNT);
    for (let i = 0; i < source.length; i++) source[i] = low[i] + high[i];
    const split = render(defaults(), source);
    const wide = render({ ...defaults(), mode: 1 }, source);

    expect(Math.abs(projection(split.left, 250))).toBeCloseTo(0.15, 1);
    expect(Math.abs(projection(wide.left, 250))).toBeLessThan(0.13);
  });

  it('uses independent channel envelopes when unlinked and matching gain when linked', () => {
    const left = sine(10000, 0.8);
    const right = sine(10000, 0.05);
    const independent = render({ ...defaults(), link: 0 }, left, right);
    const linked = render({ ...defaults(), link: 100 }, left, right);

    expect(rms(independent.left) / rms(left)).toBeLessThan(0.8);
    expect(rms(independent.right) / rms(right)).toBeGreaterThan(0.9);
    expect(rms(linked.left) / rms(left)).toBeCloseTo(rms(linked.right) / rms(right), 2);
  });

  it('ramps stereo-link changes without a block-boundary gain jump', () => {
    const processor = new DeEsser();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    processor.setValues({ ...defaults(), link: 0 });
    processor.reset();
    let previousRight = 0;
    let sampleOffset = 0;

    for (let block = 0; block < 20; block++) {
      const left = sine(10000, 0.8, BLOCK_SIZE, SAMPLE_RATE, sampleOffset);
      const right = sine(10000, 0.05, BLOCK_SIZE, SAMPLE_RATE, sampleOffset);
      processor.process(left, right, BLOCK_SIZE);
      previousRight = right[BLOCK_SIZE - 1];
      sampleOffset += BLOCK_SIZE;
    }

    processor.setValues({ ...defaults(), link: 100 });
    const transitionLeft = new Float32Array(BLOCK_SIZE * 5);
    const transitionRight = new Float32Array(BLOCK_SIZE * 5);
    let largestStep = 0;
    for (let block = 0; block < 5; block++) {
      const left = sine(10000, 0.8, BLOCK_SIZE, SAMPLE_RATE, sampleOffset);
      const right = sine(10000, 0.05, BLOCK_SIZE, SAMPLE_RATE, sampleOffset);
      processor.process(left, right, BLOCK_SIZE);
      transitionLeft.set(left, block * BLOCK_SIZE);
      transitionRight.set(right, block * BLOCK_SIZE);
      for (let i = 0; i < BLOCK_SIZE; i++) {
        largestStep = Math.max(largestStep, Math.abs(right[i] - previousRight));
        previousRight = right[i];
      }
      sampleOffset += BLOCK_SIZE;
    }

    const finalStart = BLOCK_SIZE * 3;
    const inputL = sine(10000, 0.8, BLOCK_SIZE * 2, SAMPLE_RATE, sampleOffset - BLOCK_SIZE * 2);
    const inputR = sine(10000, 0.05, BLOCK_SIZE * 2, SAMPLE_RATE, sampleOffset - BLOCK_SIZE * 2);
    expect(rms(transitionLeft.subarray(finalStart)) / rms(inputL)).toBeCloseTo(
      rms(transitionRight.subarray(finalStart)) / rms(inputR),
      2,
    );
    expect(largestStep).toBeLessThan(0.2);
  });

  it('responds to ratio changes without exceeding the configured reduction range', () => {
    const source = sine(10000, 0.8);
    const lowRatio = render({ ...defaults(), ratio: 2 }, source);
    const highRatio = render({ ...defaults(), ratio: 8 }, source);
    const capped = render({ ...defaults(), threshold: -50, range: 6, ratio: 12 }, source);

    expect(lowRatio.meter.reduction ?? 0).toBeLessThan(highRatio.meter.reduction ?? 0);
    expect(highRatio.meter.reduction ?? 0).toBeLessThanOrEqual(12);
    expect(capped.meter.reduction ?? 0).toBeLessThanOrEqual(6);
  });

  it('smooths crossover and mode changes while keeping output finite', () => {
    const processor = new DeEsser();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    let previous = 0;
    let largestStep = 0;

    for (let block = 0; block < 48; block++) {
      processor.setValues({
        ...defaults(),
        frequency: block % 2 === 0 ? 4200 : 9000,
        mode: block % 2,
      });
      const left = sine(8000, 0.75, BLOCK_SIZE);
      const right = sine(8000, 0.4, BLOCK_SIZE);
      processor.process(left, right, BLOCK_SIZE);
      for (let i = 0; i < BLOCK_SIZE; i++) {
        expect(Number.isFinite(left[i])).toBe(true);
        expect(Number.isFinite(right[i])).toBe(true);
        largestStep = Math.max(largestStep, Math.abs(left[i] - previous));
        previous = left[i];
      }
    }
    expect(largestStep).toBeLessThan(1.5);
  });

  it('rejects blocks larger than the buffers allocated by prepare', () => {
    const processor = new DeEsser();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    expect(() => processor.process(new Float32Array(BLOCK_SIZE + 1), new Float32Array(BLOCK_SIZE + 1), BLOCK_SIZE + 1)).toThrow(
      /exceeds its prepared buffers/,
    );
  });

  it('restores the selected crossover coefficients after reset', () => {
    const values = { ...defaults(), frequency: 8500, threshold: 0 };
    const source = sine(5000, 0.2);
    const expected = render(values, source);
    const processor = new DeEsser();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    processor.setValues(values);
    processor.reset();
    const left = source.slice();
    const right = source.slice();
    for (let start = 0; start < left.length; start += BLOCK_SIZE) {
      processor.process(left.subarray(start, start + BLOCK_SIZE), right.subarray(start, start + BLOCK_SIZE), BLOCK_SIZE);
    }

    expect(left).toEqual(expected.left);
  });

  it('reduces a voiced synthetic sibilance burst while retaining the vocal fundamental', () => {
    const frames = SAMPLE_RATE / 2;
    const source = new Float32Array(frames);
    const burstStart = Math.floor(SAMPLE_RATE * 0.2);
    const burstEnd = Math.floor(SAMPLE_RATE * 0.4);
    for (let i = 0; i < frames; i++) {
      const voice =
        0.18 * Math.sin((2 * Math.PI * 130 * i) / SAMPLE_RATE) +
        0.08 * Math.sin((2 * Math.PI * 260 * i) / SAMPLE_RATE) +
        0.04 * Math.sin((2 * Math.PI * 390 * i) / SAMPLE_RATE);
      const envelope = i >= burstStart && i < burstEnd ? Math.min(1, (i - burstStart) / 96, (burstEnd - i) / 96) : 0;
      const sibilance =
        envelope *
        (0.25 * Math.sin((2 * Math.PI * 7000 * i) / SAMPLE_RATE) +
          0.2 * Math.sin((2 * Math.PI * 8500 * i) / SAMPLE_RATE) +
          0.15 * Math.sin((2 * Math.PI * 10500 * i) / SAMPLE_RATE));
      source[i] = voice + sibilance;
    }
    const result = render({ ...defaults(), threshold: -30, range: 10 }, source);
    const activeRange = [Math.floor(SAMPLE_RATE * 0.25), Math.floor(SAMPLE_RATE * 0.38)] as const;

    expect(projection(result.left, 8000, activeRange[0])).toBeLessThan(projection(source, 8000, activeRange[0]) * 0.85);
    expect(projection(result.left, 130, activeRange[0])).toBeCloseTo(projection(source, 130, activeRange[0]), 2);
  });
});

describe('De-esser presets', () => {
  it('keeps every starting point complete and inside parameter bounds', () => {
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
