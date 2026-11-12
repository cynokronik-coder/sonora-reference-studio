import { describe, expect, it } from 'vitest';
import { createDefaultParams } from '../registry';
import { GATE_PRESETS, Gate, gateDefinition } from './gate';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 256;
const FRAME_COUNT = BLOCK_SIZE * 188;

function sine(amplitude: number): Float32Array {
  const out = new Float32Array(FRAME_COUNT);
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * 1_000 * i) / SAMPLE_RATE);
  return out;
}
function rms(values: Float32Array, start = Math.floor(values.length / 2)): number {
  let energy = 0;
  for (let i = start; i < values.length; i++) energy += values[i] * values[i];
  return Math.sqrt(energy / Math.max(1, values.length - start));
}
function render(values: Record<string, number>, sourceL: Float32Array, sourceR = sourceL) {
  const processor = new Gate();
  processor.prepare(SAMPLE_RATE);
  processor.setValues(values);
  const left = sourceL.slice();
  const right = sourceR.slice();
  for (let start = 0; start < FRAME_COUNT; start += BLOCK_SIZE) {
    processor.process(left.subarray(start, start + BLOCK_SIZE), right.subarray(start, start + BLOCK_SIZE), BLOCK_SIZE);
  }
  return { left, right, meter: processor.meter() };
}
function defaults() {
  return {
    ...createDefaultParams('gate'),
    threshold: -30, ratio: 4, knee: 0, range: 40,
    attack: 1, hold: 0, release: 80, link: 100, mix: 100, output: 0,
  };
}

describe('Gate / downward expander transfer behaviour', () => {
  it('does not attenuate above-threshold programme material', () => {
    const source = sine(0.3);
    const result = render(defaults(), source);
    expect(rms(result.left)).toBeCloseTo(rms(source), 2);
    expect(result.meter.reduction ?? 0).toBeLessThan(0.2);
  });

  it('follows the selected downward-expansion ratio below threshold', () => {
    const source = sine(0.01);
    const ratioTwo = render({ ...defaults(), ratio: 2 }, source);
    const ratioFour = render({ ...defaults(), ratio: 4 }, source);
    const gainTwo = rms(ratioTwo.left) / rms(source);
    const gainFour = rms(ratioFour.left) / rms(source);
    expect(gainTwo).toBeLessThan(0.4);
    expect(gainFour).toBeLessThan(gainTwo * 0.2);
    expect(ratioFour.meter.reduction ?? 0).toBeGreaterThan(20);
  });

  it('has a continuous soft-knee transition close to threshold', () => {
    const source = sine(0.03);
    const result = render({ ...defaults(), knee: 12 }, source);
    expect(result.meter.reduction ?? 0).toBeLessThan(1);
    expect(rms(result.left) / rms(source)).toBeGreaterThan(0.9);
  });

  it('keeps a quieter channel open when stereo-linked to an above-threshold channel', () => {
    const left = sine(0.3);
    const right = sine(0.01);
    const unlinked = render({ ...defaults(), link: 0 }, left, right);
    const linked = render({ ...defaults(), link: 100 }, left, right);
    const unlinkedRightGain = rms(unlinked.right) / rms(right);
    const linkedRightGain = rms(linked.right) / rms(right);
    expect(unlinkedRightGain).toBeLessThan(0.1);
    expect(linkedRightGain).toBeGreaterThan(0.9);
  });

  it('blends to a transparent dry path at 0% wet mix', () => {
    const source = sine(0.01);
    const processor = new Gate();
    processor.prepare(SAMPLE_RATE);
    processor.setValues({ ...defaults(), mix: 0 });
    processor.reset();
    const output = source.slice();
    for (let start = 0; start < FRAME_COUNT; start += BLOCK_SIZE) {
      processor.process(output.subarray(start, start + BLOCK_SIZE), output.subarray(start, start + BLOCK_SIZE), BLOCK_SIZE);
    }
    expect(output).toEqual(source);
  });

  it('keeps output finite with rapid parameter changes and low-level input', () => {
    const processor = new Gate();
    processor.prepare(SAMPLE_RATE);
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    for (let block = 0; block < 30; block++) {
      processor.setValues({
        ...defaults(),
        threshold: -70 + block,
        ratio: 1 + (block % 10),
        knee: block % 20,
        output: -6 + (block % 12),
      });
      const source = sine(0.02);
      left.set(source.subarray(0, BLOCK_SIZE));
      right.set(source.subarray(0, BLOCK_SIZE));
      processor.process(left, right, BLOCK_SIZE);
      for (const sample of left) expect(Number.isFinite(sample)).toBe(true);
      for (const sample of right) expect(Number.isFinite(sample)).toBe(true);
    }
  });
});

describe('Gate factory presets', () => {
  it('contains complete valid parameter maps for every starting point', () => {
    const specs = new Map(gateDefinition.params.map((param) => [param.key, param]));
    for (const preset of GATE_PRESETS) {
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
