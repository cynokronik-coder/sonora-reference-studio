import { describe, expect, it } from 'vitest';
import { analyzeRhythm } from './rhythm';

const SAMPLE_RATE = 48_000;

describe('section rhythm feature analysis', () => {
  it('computes rhythm descriptors without performing another structural segmentation pass', () => {
    const left = new Float32Array(SAMPLE_RATE * 6);
    const right = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) {
      const pulse = Math.floor(i / (SAMPLE_RATE * 0.5)) % 2 === 0 ? 0.2 : 0.04;
      const sample = pulse * Math.sin((2 * Math.PI * 120 * i) / SAMPLE_RATE);
      left[i] = sample;
      right[i] = sample;
    }

    const rhythm = analyzeRhythm(left, right, SAMPLE_RATE, { includeSections: false });

    expect(rhythm.sections).toEqual([]);
    expect(Number.isFinite(rhythm.onsetDensity)).toBe(true);
    expect(Number.isFinite(rhythm.attackSharpness)).toBe(true);
    expect(Number.isFinite(rhythm.punchScore)).toBe(true);
  });
});
