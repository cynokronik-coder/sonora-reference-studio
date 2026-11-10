import { describe, expect, it } from 'vitest';
import { analyzeRhythm, estimateTempo } from './rhythm';

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


describe('section FFT scratch-buffer reuse', () => {
  it('keeps frame features deterministic across repeated multi-frame analyses', () => {
    const frames = SAMPLE_RATE * 18;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      const seconds = i / SAMPLE_RATE;
      const movement = seconds < 6 ? 1 : seconds < 12 ? 0.55 : 0.8;
      const low = Math.sin((2 * Math.PI * 90 * i) / SAMPLE_RATE);
      const mid = Math.sin((2 * Math.PI * (seconds < 6 ? 440 : 1_200) * i) / SAMPLE_RATE);
      const high = Math.sin((2 * Math.PI * 5_600 * i) / SAMPLE_RATE);
      left[i] = movement * (0.12 * low + 0.07 * mid + 0.025 * high);
      right[i] = movement * (0.11 * low + 0.065 * mid + 0.03 * high);
    }

    const first = analyzeRhythm(left, right, SAMPLE_RATE);
    const second = analyzeRhythm(left, right, SAMPLE_RATE);

    expect(second).toEqual(first);
    expect(first.sections.length).toBeGreaterThan(0);
    for (const section of first.sections) {
      expect(section.start).toBeGreaterThanOrEqual(0);
      expect(section.end).toBeGreaterThan(section.start);
      expect(section.end).toBeLessThanOrEqual(frames / SAMPLE_RATE);
    }
  });
});


describe('robust tempo estimation', () => {
  it('keeps a supported half/double-time interpretation instead of hiding it', () => {
    const frameRate = 100;
    const onset = new Array(frameRate * 30).fill(0);
    for (let beat = 0; beat < 60; beat++) {
      onset[Math.round(beat * frameRate * 0.5)] = beat % 2 === 0 ? 1 : 0.75;
    }

    const result = estimateTempo(onset, frameRate);

    expect(result.tempoBpm).toBeCloseTo(120, 0);
    expect(result.candidatesBpm).toContain(120);
    expect(result.candidatesBpm).toContain(60);
    expect(result.rangeBpm).toBeNull();
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('does not force a clearly measured 60 BPM pulse into double-time', () => {
    const frameRate = 100;
    const onset = new Array(frameRate * 32).fill(0);
    for (let beat = 0; beat < 32; beat++) onset[beat * frameRate] = 1;

    const result = estimateTempo(onset, frameRate);

    expect(result.tempoBpm).toBeCloseTo(60, 0);
    expect(result.candidatesBpm).toContain(60);
    expect(result.candidatesBpm).not.toContain(120);
  });

  it('reports local tempo movement instead of relying only on one whole-track peak', () => {
    const frameRate = 100;
    const duration = 24;
    const onset = new Array(frameRate * duration).fill(0);
    let time = 0;
    while (time < duration) {
      onset[Math.round(time * frameRate)] = 1;
      time += 60 / (time < 12 ? 100 : 140);
    }

    const result = estimateTempo(onset, frameRate);

    expect(result.tempoBpm).toBeGreaterThanOrEqual(95);
    expect(result.tempoBpm).toBeLessThanOrEqual(145);
    expect(result.rangeBpm).not.toBeNull();
    expect(result.rangeBpm!.min).toBeLessThanOrEqual(105);
    expect(result.rangeBpm!.max).toBeGreaterThanOrEqual(135);
  });

  it('keeps tempo progress monotonic across global and local analysis passes', () => {
    const frameRate = 100;
    const onset = new Array(frameRate * 24).fill(0);
    for (let beat = 0; beat < 40; beat++) {
      const time = beat < 20 ? beat * 0.6 : 12 + (beat - 20) * (60 / 140);
      const frame = Math.round(time * frameRate);
      if (frame < onset.length) onset[frame] = 1;
    }
    const progress: number[] = [];

    estimateTempo(onset, frameRate, (fraction) => progress.push(fraction));

    expect(progress[progress.length - 1]).toBe(1);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    }
  });
});
