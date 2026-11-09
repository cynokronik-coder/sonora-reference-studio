import { describe, expect, it } from 'vitest';
import { createDefaultParams } from '../registry';
import { DELAY_PRESETS, Delay, delayDefinition } from './delay';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 512;
const FRAMES = SAMPLE_RATE * 9;

function render(values: Record<string, number>, inputL: Float32Array, inputR = inputL) {
  const delay = new Delay();
  delay.prepare(SAMPLE_RATE, BLOCK_SIZE);
  delay.setValues(values);
  const left = inputL.slice();
  const right = inputR.slice();
  for (let start = 0; start < left.length; start += BLOCK_SIZE) {
    const count = Math.min(BLOCK_SIZE, left.length - start);
    delay.process(left.subarray(start, start + count), right.subarray(start, start + count), count);
  }
  return { left, right, meter: delay.meter() };
}
function impulse(at = 0, amplitude = 1): Float32Array {
  const result = new Float32Array(FRAMES);
  result[at] = amplitude;
  return result;
}
function defaults() {
  return {
    ...createDefaultParams('delay'),
    mode: 0, sync: 0, note: 4, time: 100, bpm: 120, feedback: 0,
    damping: 20_000, highpass: 20, width: 100, mix: 100, output: 0,
  };
}

describe('Delay timing and tempo synchronization', () => {
  it('places a free-time echo at the configured delay sample', () => {
    const source = impulse();
    const result = render(defaults(), source);
    const expected = Math.round(0.1 * SAMPLE_RATE);
    expect(result.left[expected]).toBeCloseTo(1, 5);
    expect(result.right[expected]).toBeCloseTo(1, 5);
    expect(result.left[expected - 1]).toBe(0);
    expect(result.left[expected + 1]).toBe(0);
  });

  it('synchronizes a quarter-note delay to the supplied BPM', () => {
    const source = impulse();
    const result = render({ ...defaults(), sync: 1, note: 6, bpm: 120 }, source);
    const expected = SAMPLE_RATE / 2;
    expect(result.left[expected]).toBeCloseTo(1, 5);
    expect(result.left[expected - 1]).toBe(0);
  });

  it('recalculates synced timing when BPM changes', () => {
    const delay = new Delay();
    delay.prepare(SAMPLE_RATE, BLOCK_SIZE);
    delay.setValues({ ...defaults(), sync: 1, note: 6, bpm: 120 });
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    left[0] = right[0] = 1;
    delay.process(left, right, BLOCK_SIZE);
    delay.setValues({ ...defaults(), sync: 1, note: 6, bpm: 60 });
    expect(() => delay.process(new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE), BLOCK_SIZE)).not.toThrow();
    expect(delay.meter().peakL).toBeGreaterThan(0);
  });
});

describe('Delay modes and long-buffer safety', () => {
  it('routes the first ping-pong repeat to the opposite channel', () => {
    const sourceL = impulse(0, 0.8);
    const sourceR = new Float32Array(FRAMES);
    const result = render({ ...defaults(), mode: 1, time: 100, mix: 100 }, sourceL, sourceR);
    const echo = Math.round(0.1 * SAMPLE_RATE * 1.5);
    expect(Math.abs(result.left[echo])).toBeLessThan(1e-6);
    expect(result.right[echo]).toBeCloseTo(0.8, 4);
  });

  it('creates second and third taps without out-of-range reads at a 3-second base time', () => {
    const source = impulse(0, 0.8);
    const result = render({ ...defaults(), mode: 3, time: 3_000, mix: 100 }, source);
    const first = 3 * SAMPLE_RATE;
    const second = 6 * SAMPLE_RATE;
    const third = 9 * SAMPLE_RATE;
    expect(result.left[first]).toBeCloseTo(0.8, 4);
    expect(result.left[second]).toBeCloseTo(0.48, 3);
    expect(result.left[third]).toBeCloseTo(0.28, 2);
    for (const sample of result.left) expect(Number.isFinite(sample)).toBe(true);
    for (const sample of result.right) expect(Number.isFinite(sample)).toBe(true);
  });

  it('keeps slapback within the advertised short-delay range', () => {
    const source = impulse();
    const result = render({ ...defaults(), mode: 2, time: 1, mix: 100 }, source);
    const minimumSlap = Math.round(0.02 * SAMPLE_RATE);
    expect(result.left[minimumSlap]).toBeGreaterThan(0.9);
    expect(result.left[1]).toBe(0);
  });

  it('keeps feedback stable below unity over a long repeat train', () => {
    const source = impulse(0, 0.8);
    const result = render({ ...defaults(), mode: 0, time: 100, feedback: 95, mix: 100 }, source);
    const first = Math.round(0.1 * SAMPLE_RATE);
    const second = first * 2;
    const third = first * 3;
    expect(Math.abs(result.left[second])).toBeLessThan(Math.abs(result.left[first]));
    expect(Math.abs(result.left[third])).toBeLessThan(Math.abs(result.left[second]));
    for (const sample of result.left) expect(Number.isFinite(sample)).toBe(true);
  });
});

describe('Delay mix, stereo and control stability', () => {
  it('returns an exact dry signal when wet mix is zero', () => {
    const sourceL = new Float32Array(FRAMES);
    const sourceR = new Float32Array(FRAMES);
    for (let i = 0; i < FRAMES; i++) {
      sourceL[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
      sourceR[i] = 0.1 * Math.sin((2 * Math.PI * 330 * i) / SAMPLE_RATE);
    }
    const result = render({ ...defaults(), mix: 0 }, sourceL, sourceR);
    expect(result.left).toEqual(sourceL);
    expect(result.right).toEqual(sourceR);
  });

  it('preserves stereo channel isolation in standard stereo mode', () => {
    const sourceL = impulse(0, 0.7);
    const sourceR = new Float32Array(FRAMES);
    const result = render({ ...defaults(), mode: 0, time: 50, mix: 100 }, sourceL, sourceR);
    const echo = Math.round(0.05 * SAMPLE_RATE);
    expect(result.left[echo]).toBeCloseTo(0.7, 4);
    expect(result.right[echo]).toBeCloseTo(0, 6);
  });

  it('ramps delay time, feedback, filtering, width, wet mix and output without non-finite samples', () => {
    const delay = new Delay();
    delay.prepare(SAMPLE_RATE, BLOCK_SIZE);
    delay.setValues(defaults());
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    for (let block = 0; block < 36; block++) {
      delay.setValues({
        ...defaults(),
        mode: block % 4,
        sync: block % 2,
        note: block % 8,
        time: 50 + block * 30,
        bpm: 60 + block * 5,
        feedback: block % 10 * 9,
        damping: 1_000 + block * 500,
        highpass: 40 + block * 20,
        width: block % 6 * 30,
        mix: block % 5 * 25,
        output: -3 + block % 6,
      });
      left.fill(0);
      right.fill(0);
      left[0] = Math.sin(block);
      right[0] = Math.cos(block);
      delay.process(left, right, BLOCK_SIZE);
      for (const sample of left) expect(Number.isFinite(sample)).toBe(true);
      for (const sample of right) expect(Number.isFinite(sample)).toBe(true);
    }
  });

  it('resets all delay and filter history without replaying previous audio', () => {
    const delay = new Delay();
    delay.prepare(SAMPLE_RATE, BLOCK_SIZE);
    delay.setValues({ ...defaults(), mix: 100 });
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    left[0] = right[0] = 0.8;
    delay.process(left, right, BLOCK_SIZE);
    delay.reset();
    left.fill(0);
    right.fill(0);
    for (let block = 0; block < 20; block++) {
      delay.process(left, right, BLOCK_SIZE);
      for (const sample of left) expect(Math.abs(sample)).toBeLessThan(1e-8);
      for (const sample of right) expect(Math.abs(sample)).toBeLessThan(1e-8);
    }
  });

  it('rejects blocks over prepared capacity', () => {
    const delay = new Delay();
    delay.prepare(SAMPLE_RATE, BLOCK_SIZE);
    expect(() => delay.process(new Float32Array(BLOCK_SIZE + 1), new Float32Array(BLOCK_SIZE + 1), BLOCK_SIZE + 1)).toThrow(RangeError);
  });
});

describe('Delay factory presets', () => {
  it('contains complete, valid parameter maps for every starting point', () => {
    const specs = new Map(delayDefinition.params.map((param) => [param.key, param]));
    expect(DELAY_PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const preset of DELAY_PRESETS) {
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
