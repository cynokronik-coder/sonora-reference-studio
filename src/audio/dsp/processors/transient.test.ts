import { describe, expect, it } from 'vitest';
import { createDefaultParams } from '../registry';
import { TransientShaper } from './transient';

const SAMPLE_RATE = 48_000;

function rms(samples: Float32Array, start = 0): number {
  let power = 0;
  for (let i = start; i < samples.length; i++) power += samples[i] * samples[i];
  return Math.sqrt(power / Math.max(1, samples.length - start));
}

function createProcessor(params: Record<string, number>): TransientShaper {
  const processor = new TransientShaper();
  processor.prepare(SAMPLE_RATE);
  processor.setValues({ ...createDefaultParams('transient'), ...params });
  return processor;
}

describe('TransientShaper', () => {
  it('is transparent at neutral settings', () => {
    const processor = createProcessor({});
    const left = Float32Array.from({ length: 2048 }, (_, i) => Math.sin(i * 0.13) * 0.4);
    const right = Float32Array.from({ length: 2048 }, (_, i) => Math.sin(i * 0.17) * 0.2);
    const expectedLeft = left.slice();
    const expectedRight = right.slice();

    processor.process(left, right, left.length);

    expect(left).toEqual(expectedLeft);
    expect(right).toEqual(expectedRight);
  });

  it('keeps negative extreme settings finite and never inverts signal polarity', () => {
    const processor = createProcessor({ attack: -100, sustain: -100, sensitivity: 100, link: 0 });
    const left = new Float32Array(8192).fill(-0.5);
    const right = new Float32Array(8192).fill(0.25);

    processor.process(left, right, left.length);

    expect(left.every(Number.isFinite)).toBe(true);
    expect(right.every(Number.isFinite)).toBe(true);
    expect(left.every((sample) => sample <= 0)).toBe(true);
    expect(right.every((sample) => sample >= 0)).toBe(true);
    expect(processor.meter().gain).toBeGreaterThan(0);
  });

  it('uses the linked channel transient feature for both outputs at full stereo link', () => {
    const renderRightGain = (link: number) => {
      const processor = createProcessor({ attack: 100, sustain: 0, link });
      const baselineL = new Float32Array(12_000).fill(0.1);
      const baselineR = new Float32Array(12_000).fill(0.1);
      processor.process(baselineL, baselineR, baselineL.length);

      const left = new Float32Array(4096).fill(0.9);
      const right = new Float32Array(4096).fill(0.1);
      processor.process(left, right, left.length);
      return rms(right) / 0.1;
    };

    expect(renderRightGain(100)).toBeGreaterThan(renderRightGain(0) * 1.1);
  });

  it('smooths output-gain changes instead of applying a block-edge step', () => {
    const processor = createProcessor({});
    const beforeL = new Float32Array(512).fill(0.25);
    const beforeR = new Float32Array(512).fill(0.25);
    processor.process(beforeL, beforeR, beforeL.length);

    processor.setValues({ ...createDefaultParams('transient'), output: 12 });
    const firstL = new Float32Array([0.25]);
    const firstR = new Float32Array([0.25]);
    processor.process(firstL, firstR, 1);
    expect(firstL[0]).toBeCloseTo(0.25, 2);

    const settledL = new Float32Array(SAMPLE_RATE).fill(0.25);
    const settledR = new Float32Array(SAMPLE_RATE).fill(0.25);
    processor.process(settledL, settledR, settledL.length);
    expect(rms(settledL, SAMPLE_RATE / 2) / 0.25).toBeCloseTo(10 ** (12 / 20), 1);
  });
});
