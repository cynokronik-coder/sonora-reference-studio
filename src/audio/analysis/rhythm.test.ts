import { describe, expect, it } from 'vitest';
import { adaptiveOnsetEnvelope, analyzeRhythm, combineBandFlux, estimateTempo } from './rhythm';

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

    expect([60, 120]).toContain(result.tempoBpm);
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


describe('adaptive multiband onset detection', () => {
  it('lets a quiet active frequency band contribute despite a dominant loud band', () => {
    const loudBandOnly = combineBandFlux([2, 0, 0], [1_000, 0, 0], 1_000);
    const withQuietPercussion = combineBandFlux([2, 0.2, 0], [1_000, 2, 0], 1_002);

    expect(withQuietPercussion).toBeGreaterThan(loudBandOnly * 10);
    expect(combineBandFlux([0, 0], [0, 0], 0)).toBe(0);
  });

  it('retains weak irregular attacks over a slowly changing background', () => {
    const flux = Array.from({ length: 280 }, (_, i) =>
      0.6 + i * 0.00025 + 0.009 * Math.sin(i * 0.31) + 0.004 * Math.sin(i * 0.73)
    );
    const attacks = [26, 43, 67, 84, 109, 123, 151, 176, 194, 221, 239, 263];
    const strengths = [0.16, 0.09, 0.13, 0.08, 0.12, 0.07, 0.15, 0.09, 0.11, 0.08, 0.14, 0.09];
    attacks.forEach((frame, index) => { flux[frame] += strengths[index]; });

    const envelope = adaptiveOnsetEnvelope(flux, 12);
    for (const frame of attacks) {
      expect(envelope[frame]).toBeGreaterThan(0.04);
      expect(envelope[frame]).toBeGreaterThan(envelope[frame - 1]);
      expect(envelope[frame]).toBeGreaterThanOrEqual(envelope[frame + 1]);
    }
  });

  it('does not turn a smooth noisy floor into a stream of false attacks', () => {
    const flux = Array.from({ length: 500 }, (_, i) =>
      0.8 + 0.008 * Math.sin(i * 0.17) + 0.006 * Math.sin(i * 0.43)
    );

    const envelope = adaptiveOnsetEnvelope(flux, 12);

    expect(envelope.every((value) => value === 0)).toBe(true);
  });

  it('detects quiet syncopated high-frequency percussion over a strong sustained bass', () => {
    const duration = 8;
    const length = SAMPLE_RATE * duration;
    const withoutPercussionL = new Float32Array(length);
    const withoutPercussionR = new Float32Array(length);
    const withPercussionL = new Float32Array(length);
    const withPercussionR = new Float32Array(length);
    const hitTimes = [
      0.25, 0.75, 1.125, 1.5, 2.0, 2.375, 2.75, 3.25,
      3.625, 4.0, 4.5, 4.875, 5.25, 5.75, 6.125, 6.5,
      7.0, 7.375,
    ];

    for (let i = 0; i < length; i++) {
      const time = i / SAMPLE_RATE;
      const bass = 0.22 * Math.sin(2 * Math.PI * 72 * time)
        + 0.07 * Math.sin(2 * Math.PI * 144 * time);
      withoutPercussionL[i] = bass;
      withoutPercussionR[i] = bass * 0.98;
      withPercussionL[i] = bass;
      withPercussionR[i] = bass * 0.98;
    }
    for (const hitTime of hitTimes) {
      const start = Math.round(hitTime * SAMPLE_RATE);
      const end = Math.min(length, start + Math.ceil(0.035 * SAMPLE_RATE));
      for (let i = start; i < end; i++) {
        const time = i / SAMPLE_RATE;
        const elapsed = time - hitTime;
        const decay = Math.exp(-elapsed / 0.009);
        const percussion = 0.012 * decay * (
          Math.sin(2 * Math.PI * 2_400 * time)
          + 0.7 * Math.sin(2 * Math.PI * 5_200 * time)
          + 0.35 * Math.sin(2 * Math.PI * 8_600 * time)
        );
        withPercussionL[i] += percussion;
        withPercussionR[i] += percussion * 0.9;
      }
    }

    const baseline = analyzeRhythm(withoutPercussionL, withoutPercussionR, SAMPLE_RATE, { includeSections: false });
    const detected = analyzeRhythm(withPercussionL, withPercussionR, SAMPLE_RATE, { includeSections: false });

    expect(detected.onsetDensity).toBeGreaterThan(baseline.onsetDensity + 1);
    expect(detected.attackSharpness).toBeGreaterThan(baseline.attackSharpness);
  });
});
