import { describe, expect, it } from 'vitest';
import { analyzeAudio } from './analyze';
import { absoluteBeatPhaseSeconds } from './rhythm';

const SAMPLE_RATE = 48_000;

function stereoTone(durationSeconds: number, rightGain = 0.8) {
  const frames = Math.round(durationSeconds * SAMPLE_RATE);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const sample = 0.2 * Math.sin((2 * Math.PI * 1_000 * i) / SAMPLE_RATE);
    left[i] = sample;
    right[i] = sample * rightGain;
  }
  return { left, right };
}

describe('complete section analysis', () => {
  it('stores measured loudness, stereo, spectral and rhythm metrics for detected sections', () => {
    const audio = stereoTone(20);
    const progress: { stage: string; fraction: number }[] = [];
    const report = analyzeAudio({
      assetId: 'section-analysis-test',
      L: audio.left,
      R: audio.right,
      sampleRate: SAMPLE_RATE,
    }, {
      onProgress: (stage, fraction) => progress.push({ stage, fraction }),
    });

    expect(report.sectionMetricsVersion).toBe(4);
    expect(report.sections.length).toBeGreaterThan(0);
    expect(progress.some((item) => item.stage === 'Measuring section loudness')).toBe(true);
    expect(progress.some((item) => item.stage === 'Calculating section metrics')).toBe(true);
    expect(progress[progress.length - 1].fraction).toBe(1);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i].fraction).toBeGreaterThanOrEqual(progress[i - 1].fraction);
    }

    for (const section of report.sections) {
      expect(Number.isFinite(section.lufs)).toBe(true);
      expect(Number.isFinite(section.truePeakDb)).toBe(true);
      expect(Number.isFinite(section.samplePeakDb)).toBe(true);
      expect(Number.isFinite(section.rmsDb)).toBe(true);
      expect(Number.isFinite(section.crestDb)).toBe(true);
      expect(Number.isFinite(section.plrDb)).toBe(true);
      expect(Number.isFinite(section.widthDb)).toBe(true);
      expect(Number.isFinite(section.correlation)).toBe(true);
      expect(Number.isFinite(section.monoCompatibility)).toBe(true);
      expect(Number.isFinite(section.lowSideRatioDb)).toBe(true);
      expect(Number.isFinite(section.centroidHz)).toBe(true);
      expect(Number.isFinite(section.rolloffHz)).toBe(true);
      expect(Number.isFinite(section.tiltDbPerOct)).toBe(true);
      expect(Number.isFinite(section.flatness)).toBe(true);
      expect(Number.isFinite(section.attackDensity)).toBe(true);
      expect(Number.isFinite(section.punchScore)).toBe(true);
      expect(Number.isFinite(section.groupedAttackDensity)).toBe(true);
      if (section.beatGridConfidence !== null) {
        expect(section.beatGridConfidence).toBeGreaterThanOrEqual(0);
        expect(section.beatGridConfidence).toBeLessThanOrEqual(1);
        expect(section.offBeatRatio).toBeGreaterThanOrEqual(0);
        expect(section.offBeatRatio).toBeLessThanOrEqual(1);
        expect(section.beatPhaseSeconds).not.toBeNull();
      }
      if (section.beatContinuity !== null) {
        expect(section.beatContinuity).toBeGreaterThanOrEqual(0);
        expect(section.beatContinuity).toBeLessThanOrEqual(1);
      }
      expect(section.bands.length).toBeGreaterThan(0);
    }

    const longSection = report.sections.find((section) => section.end - section.start >= 10);
    expect(longSection).toBeDefined();
    expect(Number.isFinite(longSection?.lra)).toBe(true);
    expect(longSection?.truePeakDb).toBeGreaterThanOrEqual(longSection?.samplePeakDb ?? 0);
  });

  it('marks LRA and tempo unavailable for short segments instead of fabricating values', () => {
    const audio = stereoTone(4);
    const report = analyzeAudio({
      assetId: 'short-section-analysis-test',
      L: audio.left,
      R: audio.right,
      sampleRate: SAMPLE_RATE,
    });
    const section = report.sections[0];

    expect(section.end - section.start).toBeCloseTo(4, 1);
    expect(section.lra).toBeNull();
    expect(section.tempoBpm).toBeNull();
    expect(section.beatConfidence).toBeNull();
    expect(section.beatGridConfidence).toBeNull();
    expect(section.offBeatRatio).toBeNull();
    expect(section.beatPhaseSeconds).toBeNull();
    expect(section.tempoChangeBpm).toBeNull();
    expect(section.beatPhaseShiftMs).toBeNull();
    expect(section.beatContinuity).toBeNull();
    expect(section.groupedAttackDensity).not.toBeNull();
    expect(section.attackDensity).not.toBeNull();
    expect(section.punchScore).not.toBeNull();
  });
});


describe('section-relative beat phase', () => {
  it('maps a local section phase to the song timeline without changing tempo', () => {
    expect(absoluteBeatPhaseSeconds(16, 0.12, 120)).toBeCloseTo(0.12, 6);
    expect(absoluteBeatPhaseSeconds(16.25, 0.12, 120)).toBeCloseTo(0.37, 6);
  });

  it('wraps phase to the beat interval and rejects unavailable measurements', () => {
    expect(absoluteBeatPhaseSeconds(16.4, 0.12, 120)).toBeCloseTo(0.02, 6);
    expect(absoluteBeatPhaseSeconds(8, null, 120)).toBeNull();
    expect(absoluteBeatPhaseSeconds(8, 0.1, 0)).toBeNull();
  });
});
