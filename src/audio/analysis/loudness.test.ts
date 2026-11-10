import { describe, expect, it } from 'vitest';
import { analyzeLoudness, loudnessOfRange, normalizeToTruePeak, normalizeToTruePeakAsync } from './loudness';

const SAMPLE_RATE = 48_000;

function stereoTone(
  frequency: number,
  peakDb: number,
  durationSeconds: number,
  startSeconds = 0,
): { left: Float32Array; right: Float32Array } {
  const frames = Math.round(durationSeconds * SAMPLE_RATE);
  const start = Math.round(startSeconds * SAMPLE_RATE);
  const amplitude = Math.pow(10, peakDb / 20);
  const left = new Float32Array(start + frames);
  const right = new Float32Array(start + frames);
  for (let i = 0; i < frames; i++) {
    const sample = amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE);
    left[start + i] = sample;
    right[start + i] = sample;
  }
  return { left, right };
}

describe('BS.1770-5 integrated and EBU time-window loudness', () => {
  it('measures a calibrated dual-mono 1 kHz reference tone at its peak level', () => {
    const { left, right } = stereoTone(1_000, -20, 10);
    const report = analyzeLoudness(left, right, SAMPLE_RATE);
    expect(report.integratedLufs).toBeGreaterThanOrEqual(-20.1);
    expect(report.integratedLufs).toBeLessThanOrEqual(-19.9);
    expect(report.momentaryMaxLufs).toBeGreaterThanOrEqual(-20.1);
    expect(report.shortTermMaxLufs).toBeGreaterThanOrEqual(-20.1);
    expect(report.momentaryMaxLufs).toBeLessThanOrEqual(-19.9);
    expect(report.shortTermMaxLufs).toBeLessThanOrEqual(-19.9);
    expect(report.samplePeakDb).toBeGreaterThanOrEqual(-20.1);
    expect(report.samplePeakDb).toBeLessThanOrEqual(-19.9);
    expect(report.truePeakDb).toBeGreaterThanOrEqual(-20.1);
    expect(report.truePeakDb).toBeLessThanOrEqual(-19.9);
  });

  it('uses only complete 400 ms blocks for integrated loudness', () => {
    const short = stereoTone(1_000, -20, 0.39);
    const shortReport = analyzeLoudness(short.left, short.right, SAMPLE_RATE);
    expect(shortReport.integratedLufs).toBe(-Infinity);
    expect(shortReport.momentary).toHaveLength(0);

    const full = stereoTone(1_000, -20, 0.4);
    const fullReport = analyzeLoudness(full.left, full.right, SAMPLE_RATE);
    expect(fullReport.integratedLufs).toBeGreaterThanOrEqual(-20.1);
    expect(fullReport.integratedLufs).toBeLessThanOrEqual(-19.9);
    expect(fullReport.momentary).toHaveLength(1);
  });

  it('updates momentary and short-term measurements at 100 ms intervals', () => {
    const { left, right } = stereoTone(1_000, -20, 5);
    const report = analyzeLoudness(left, right, SAMPLE_RATE);
    expect(report.momentary.length).toBeGreaterThan(40);
    expect(report.shortTerm.length).toBeGreaterThan(20);
    expect(report.momentary[1].time - report.momentary[0].time).toBeCloseTo(0.1, 5);
    expect(report.shortTerm[1].time - report.shortTerm[0].time).toBeCloseTo(0.1, 5);
    expect(report.momentary[0].time).toBeCloseTo(0.2, 5);
    expect(report.shortTerm[0].time).toBeCloseTo(1.5, 5);
  });

  it('calculates an approximately 10 LU range for a 20 second / 20 second 10 dB step', () => {
    const first = stereoTone(1_000, -20, 20);
    const second = stereoTone(1_000, -30, 20, 20);
    const left = new Float32Array(first.left.length + second.left.length - SAMPLE_RATE * 20);
    const right = new Float32Array(left.length);
    left.set(first.left);
    right.set(first.right);
    left.set(second.left.subarray(SAMPLE_RATE * 20), SAMPLE_RATE * 20);
    right.set(second.right.subarray(SAMPLE_RATE * 20), SAMPLE_RATE * 20);
    const report = analyzeLoudness(left, right, SAMPLE_RATE);
    expect(report.lra).toBeGreaterThanOrEqual(9);
    expect(report.lra).toBeLessThanOrEqual(11);
  });

  it('passes the EBU 5 LU range minimum-requirements test', () => {
    const first = stereoTone(1_000, -20, 20);
    const second = stereoTone(1_000, -15, 20, 20);
    const left = new Float32Array(SAMPLE_RATE * 40);
    const right = new Float32Array(left.length);
    left.set(first.left);
    right.set(first.right);
    left.set(second.left.subarray(SAMPLE_RATE * 20), SAMPLE_RATE * 20);
    right.set(second.right.subarray(SAMPLE_RATE * 20), SAMPLE_RATE * 20);
    const report = analyzeLoudness(left, right, SAMPLE_RATE);
    expect(report.lra).toBeGreaterThanOrEqual(4);
    expect(report.lra).toBeLessThanOrEqual(6);
  });

  it('passes the EBU 20 LU range minimum-requirements test', () => {
    const first = stereoTone(1_000, -40, 20);
    const second = stereoTone(1_000, -20, 20, 20);
    const left = new Float32Array(SAMPLE_RATE * 40);
    const right = new Float32Array(left.length);
    left.set(first.left);
    right.set(first.right);
    left.set(second.left.subarray(SAMPLE_RATE * 20), SAMPLE_RATE * 20);
    right.set(second.right.subarray(SAMPLE_RATE * 20), SAMPLE_RATE * 20);
    const report = analyzeLoudness(left, right, SAMPLE_RATE);
    expect(report.lra).toBeGreaterThanOrEqual(19);
    expect(report.lra).toBeLessThanOrEqual(21);
  });

  it('applies the absolute gate to silent programme and returns no invented loudness', () => {
    const silent = new Float32Array(SAMPLE_RATE * 4);
    const report = analyzeLoudness(silent, silent, SAMPLE_RATE);
    expect(report.integratedLufs).toBe(-Infinity);
    expect(report.momentaryMaxLufs).toBe(-Infinity);
    expect(report.shortTermMaxLufs).toBe(-Infinity);
    expect(report.lra).toBe(0);
    expect(report.truePeakDb).toBe(-Infinity);
  });

  it('uses the Annex 2 FIR true-peak estimate for inter-sample peaks', () => {
    const frames = SAMPLE_RATE * 2;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    const amplitude = Math.pow(10, -1 / 20);
    for (let i = 0; i < frames; i++) {
      left[i] = amplitude * Math.sin((2 * Math.PI * 12_000 * i) / SAMPLE_RATE + Math.PI / 4);
      right[i] = left[i];
    }
    const report = analyzeLoudness(left, right, SAMPLE_RATE);
    expect(report.samplePeakDb).toBeLessThan(-3);
    expect(report.truePeakDb).toBeGreaterThan(-1.1);
    expect(report.truePeakDb).toBeLessThan(-0.7);
  });

  it('normalizes PCM to a requested Annex 2 true-peak ceiling', () => {
    const frames = SAMPLE_RATE * 2;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    const amplitude = Math.pow(10, -9 / 20);
    for (let i = 0; i < frames; i++) {
      left[i] = amplitude * Math.sin((2 * Math.PI * 12_000 * i) / SAMPLE_RATE + Math.PI / 4);
      right[i] = amplitude * 0.5 * Math.sin((2 * Math.PI * 12_000 * i) / SAMPLE_RATE + Math.PI / 4);
    }
    const appliedGain = normalizeToTruePeak(left, right, -1);
    const measured = analyzeLoudness(left, right, SAMPLE_RATE);
    expect(appliedGain).toBeGreaterThan(1);
    expect(measured.truePeakDb).toBeGreaterThanOrEqual(-1.05);
    expect(measured.truePeakDb).toBeLessThanOrEqual(-0.95);
    expect(measured.samplePeakDb).toBeLessThan(measured.truePeakDb);
    expect(left[100]).toBeCloseTo(right[100] * 2, 6);
  });

  it('leaves digital silence unchanged during true-peak normalization', () => {
    const left = new Float32Array(4_096);
    const right = new Float32Array(4_096);
    expect(normalizeToTruePeak(left, right, -1)).toBe(1);
    expect(left.every((sample) => sample === 0)).toBe(true);
    expect(right.every((sample) => sample === 0)).toBe(true);
  });

  it('reports silent or too-short subranges without fabricating LUFS', () => {
    const { left, right } = stereoTone(1_000, -20, 1);
    expect(loudnessOfRange(left, right, SAMPLE_RATE, 0, 0.3).lufs).toBe(-Infinity);
    expect(loudnessOfRange(left, right, SAMPLE_RATE, 0, 1).lufs).toBeGreaterThanOrEqual(-20.1);
  });

  it('keeps the supplementary dynamic-range descriptor distinct from EBU LRA', () => {
    // Use a longer programme so the required 1.5 s file-based LRA flush is
    // below the 10th percentile and does not dominate a short-file result.
    const { left, right } = stereoTone(1_000, -20, 40);
    const report = analyzeLoudness(left, right, SAMPLE_RATE);
    expect(report.lra).toBe(0);
    expect(report.dynamicRangeDb).toBeGreaterThanOrEqual(0);
    expect(report.dynamicRangeDb).toBeLessThan(2);
  });
});


describe('cooperative true-peak normalization', () => {
  it('matches the synchronous gain and modifies the same PCM samples in place', async () => {
    const source = stereoTone(1_000, -3, 1);
    const expectedL = source.left.slice();
    const expectedR = source.right.slice();
    const actualL = source.left.slice();
    const actualR = source.right.slice();
    const expectedGain = normalizeToTruePeak(expectedL, expectedR, -1);
    const actualGain = await normalizeToTruePeakAsync(actualL, actualR, -1);
    expect(actualGain).toBeCloseTo(expectedGain, 12);
    expect(actualL[12_345]).toBeCloseTo(expectedL[12_345], 7);
    expect(actualR[12_345]).toBeCloseTo(expectedR[12_345], 7);
  });

  it('reports progress and can cancel between meter blocks', async () => {
    const source = stereoTone(1_000, -6, 2);
    const controller = new AbortController();
    const progress: number[] = [];
    await expect(normalizeToTruePeakAsync(source.left, source.right, -1, {
      signal: controller.signal,
      onProgress: (value) => {
        progress.push(value);
        if (value > 0) controller.abort();
      },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(progress.length).toBeGreaterThan(0);
  });
});
