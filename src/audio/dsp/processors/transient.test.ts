import { describe, expect, it } from 'vitest';
import { createDefaultParams } from '../registry';
import { TRANSIENT_PRESETS, TransientShaper, transientDefinition } from './transient';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 256;
const FRAME_COUNT = BLOCK_SIZE * 188;

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
function makeSine(amplitude: number): Float32Array {
  const result = new Float32Array(FRAME_COUNT);
  for (let i = 0; i < result.length; i++) result[i] = amplitude * Math.sin((2 * Math.PI * 1_000 * i) / SAMPLE_RATE);
  return result;
}
function render(values: Record<string, number>, leftInput: Float32Array, rightInput = leftInput) {
  const processor = new TransientShaper();
  processor.prepare(SAMPLE_RATE);
  processor.setValues(values);
  const left = leftInput.slice();
  const right = rightInput.slice();
  for (let start = 0; start < FRAME_COUNT; start += BLOCK_SIZE) {
    processor.process(left.subarray(start, start + BLOCK_SIZE), right.subarray(start, start + BLOCK_SIZE), BLOCK_SIZE);
  }
  return { left, right, meter: processor.meter() };
}
function defaults() {
  return {
    ...createDefaultParams('transient'),
    attack: 0, sustain: 0, sensitivity: 50, link: 100, mix: 100, output: 0,
  };
}

describe('Transient shaper envelope and gain behaviour', () => {
  it('is transparent with neutral attack, sustain and output settings', () => {
    const source = makeSine(0.3);
    const result = render(defaults(), source);
    expect(result.left).toEqual(source);
    expect(result.right).toEqual(source);
  });

  it('adds measurable gain to sustained body when sustain is increased', () => {
    const source = makeSine(0.2);
    const result = render({ ...defaults(), sustain: 80 }, source);
    const gain = rms(result.left) / rms(source);
    expect(gain).toBeGreaterThan(1.35);
    expect(gain).toBeLessThan(2.2);
  });

  it('does not invert polarity or produce non-finite output with maximum negative controls', () => {
    const source = makeSine(0.4);
    const result = render({ ...defaults(), attack: -100, sustain: -100 }, source);
    for (let i = 0; i < source.length; i++) {
      expect(Number.isFinite(result.left[i])).toBe(true);
      expect(result.left[i] * source[i]).toBeGreaterThanOrEqual(-1e-7);
    }
  });

  it('uses a common gain envelope with 100% stereo link', () => {
    const left = makeSine(0.8);
    const right = makeSine(0.05);
    const result = render({ ...defaults(), sustain: 80, link: 100 }, left, right);
    const leftGain = rms(result.left) / rms(left);
    const rightGain = rms(result.right) / rms(right);
    expect(leftGain).toBeCloseTo(rightGain, 3);
  });

  it('keeps independent channel envelope behaviour with 0% stereo link', () => {
    const left = makeSine(0.8);
    const right = makeSine(0.05);
    const result = render({ ...defaults(), sustain: 80, link: 0 }, left, right);
    const leftGain = rms(result.left) / rms(left);
    const rightGain = rms(result.right) / rms(right);
    expect(leftGain).toBeGreaterThan(rightGain * 1.1);
  });

  it('keeps the dry path transparent at 0% mix after selecting the target', () => {
    const source = makeSine(0.3);
    const processor = new TransientShaper();
    processor.prepare(SAMPLE_RATE);
    processor.setValues({ ...defaults(), attack: 80, sustain: 60, mix: 0 });
    processor.reset();
    const output = source.slice();
    for (let start = 0; start < FRAME_COUNT; start += BLOCK_SIZE) {
      processor.process(output.subarray(start, start + BLOCK_SIZE), output.subarray(start, start + BLOCK_SIZE), BLOCK_SIZE);
    }
    expect(output).toEqual(source);
  });

  it('reports finite peak and gain values under strong transient shaping', () => {
    const source = new Float32Array(FRAME_COUNT);
    for (let start = 4_000; start < 18_000; start++) {
      source[start] = 0.25 * Math.sin((2 * Math.PI * 1_000 * start) / SAMPLE_RATE);
    }
    source[4_000] = 0.95;
    const result = render({ ...defaults(), attack: 100, sustain: -50 }, source);
    expect(Number.isFinite(result.meter.peakL ?? 0)).toBe(true);
    expect(Number.isFinite(result.meter.gain ?? 0)).toBe(true);
    for (const sample of result.left) expect(Number.isFinite(sample)).toBe(true);
  });
});

describe('Transient shaper factory presets', () => {
  it('contains complete valid parameter maps for all presets', () => {
    const specs = new Map(transientDefinition.params.map((param) => [param.key, param]));
    for (const preset of TRANSIENT_PRESETS) {
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
