import { describe, expect, it } from 'vitest';
import { createDefaultParams } from '../registry';
import { expansionReductionDb, Gate, legacyExpansionReductionDb } from './gate';

const SAMPLE_RATE = 48_000;

function rms(samples: Float32Array, start = 0): number {
  let power = 0;
  for (let i = start; i < samples.length; i++) power += samples[i] * samples[i];
  return Math.sqrt(power / Math.max(1, samples.length - start));
}

function render(link: number): { left: Float32Array; right: Float32Array; meter: ReturnType<Gate['meter']> } {
  const processor = new Gate();
  processor.prepare(SAMPLE_RATE);
  processor.setValues({
    ...createDefaultParams('gate'),
    threshold: -20,
    ratio: 4,
    range: 40,
    knee: 0,
    attack: 0.1,
    release: 100,
    hold: 0,
    link,
    mix: 100,
  });
  const left = new Float32Array(SAMPLE_RATE).fill(0.8);
  const right = new Float32Array(SAMPLE_RATE).fill(0.01);
  processor.process(left, right, left.length);
  return { left, right, meter: processor.meter() };
}

describe('Gate / Expander', () => {
  it('uses the conventional hard-knee expansion slope', () => {
    expect(expansionReductionDb(-30, -20, 4, 0)).toBe(30);
    expect(expansionReductionDb(-40, -20, 4, 0)).toBe(60);
    expect(expansionReductionDb(-10, -20, 4, 0)).toBe(0);
  });

  it('retains the original transfer curve for migrated projects', () => {
    expect(legacyExpansionReductionDb(-30, -20, 4)).toBe(9);
    expect(legacyExpansionReductionDb(-10, -20, 4)).toBe(0);
  });

  it('applies the migrated curve mode in the processor without changing ratio values', () => {
    const renderCurve = (curve: number) => {
      const processor = new Gate();
      processor.prepare(SAMPLE_RATE);
      processor.setValues({
        ...createDefaultParams('gate'),
        threshold: -20,
        ratio: 4,
        range: 80,
        knee: 0,
        curve,
        link: 0,
        mix: 100,
      });
      const left = new Float32Array(SAMPLE_RATE);
      const right = new Float32Array(SAMPLE_RATE).fill(0.01);
      processor.process(left, right, right.length);
      return rms(right, 24_000);
    };

    expect(renderCurve(1)).toBeGreaterThan(renderCurve(0) * 5);
  });

  it('has a continuous quadratic soft knee', () => {
    expect(expansionReductionDb(-20, -20, 4, 6)).toBe(0);
    expect(expansionReductionDb(-23, -20, 4, 6)).toBeCloseTo(2.25, 8);
    expect(expansionReductionDb(-26, -20, 4, 6)).toBeCloseTo(9, 8);
    expect(expansionReductionDb(-30, -20, 4, 6)).toBeCloseTo(21, 8);
  });

  it('uses independent channel detectors at 0% link and common detection at 100%', () => {
    const independent = render(0);
    const linked = render(100);

    expect(rms(independent.right, 36_000)).toBeLessThan(0.002);
    expect(rms(independent.left, 36_000)).toBeGreaterThan(0.79);
    expect(independent.meter.reductionR).toBeGreaterThan(39);
    expect(independent.meter.reductionR).toBeLessThanOrEqual(40);
    expect(rms(linked.right, 36_000)).toBeGreaterThan(0.009);
    expect(linked.meter.reductionL).toBeCloseTo(linked.meter.reductionR ?? -1, 5);
  });

  it('preserves the dry signal after the wet/dry control reaches zero', () => {
    const processor = new Gate();
    processor.prepare(SAMPLE_RATE);
    processor.setValues({
      ...createDefaultParams('gate'),
      threshold: -20,
      ratio: 10,
      mix: 0,
    });
    const left = new Float32Array(SAMPLE_RATE).fill(0.1);
    const right = new Float32Array(SAMPLE_RATE).fill(-0.2);
    processor.process(left, right, left.length);

    expect(left.slice(24_000)).toEqual(new Float32Array(24_000).fill(0.1));
    expect(right.slice(24_000)).toEqual(new Float32Array(24_000).fill(-0.2));
  });

  it('keeps output finite for hostile parameter values', () => {
    const processor = new Gate();
    processor.prepare(SAMPLE_RATE);
    processor.setValues({ threshold: Number.NaN, ratio: 200, knee: Number.NaN, output: 200, mix: 100, link: -20 });
    const left = new Float32Array(SAMPLE_RATE).fill(0.3);
    const right = new Float32Array(SAMPLE_RATE).fill(-0.3);
    processor.process(left, right, left.length);

    expect(left.every(Number.isFinite)).toBe(true);
    expect(right.every(Number.isFinite)).toBe(true);
  });
});
