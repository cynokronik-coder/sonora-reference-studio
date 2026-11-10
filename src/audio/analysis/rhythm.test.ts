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


describe('rhythm analysis progress reporting', () => {
  it('reports monotonic onset, tempo and section phases without changing measurements', () => {
    const frames = SAMPLE_RATE * 30;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    const beatFrames = Math.round(SAMPLE_RATE * 0.5);
    for (let i = 0; i < frames; i++) {
      const withinBeat = i % beatFrames;
      const envelope = withinBeat < SAMPLE_RATE * 0.07
        ? 0.8 * Math.exp(-withinBeat / (SAMPLE_RATE * 0.025))
        : 0.12;
      const tone = Math.sin((2 * Math.PI * 120 * i) / SAMPLE_RATE);
      const high = Math.sin((2 * Math.PI * 2_400 * i) / SAMPLE_RATE);
      left[i] = envelope * (0.17 * tone + 0.025 * high);
      right[i] = envelope * (0.15 * tone + 0.03 * high);
    }

    const expected = analyzeRhythm(left, right, SAMPLE_RATE);
    const progress: { stage: string; fraction: number }[] = [];
    const actual = analyzeRhythm(left, right, SAMPLE_RATE, {
      onProgress: (stage, fraction) => progress.push({ stage, fraction }),
    });

    expect(actual).toEqual(expected);
    expect(progress.some((item) => item.stage === 'Detecting onsets')).toBe(true);
    expect(progress.some((item) => item.stage === 'Estimating tempo')).toBe(true);
    expect(progress.some((item) => item.stage === 'Detecting song sections')).toBe(true);
    expect(progress[progress.length - 1].fraction).toBe(1);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i].fraction).toBeGreaterThanOrEqual(progress[i - 1].fraction);
    }
  });

  it('completes progress for clips too short for tempo analysis', () => {
    const short = new Float32Array(Math.floor(SAMPLE_RATE * 0.5));
    const progress: number[] = [];
    const result = analyzeRhythm(short, short, SAMPLE_RATE, {
      onProgress: (_stage, fraction) => progress.push(fraction),
    });
    expect(result.tempoBpm).toBe(0);
    expect(progress).toEqual([1]);
  });
});
