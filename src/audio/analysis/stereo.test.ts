import { describe, expect, it } from 'vitest';
import { analyzeStereo, createStereoSpectralAccum, finalizeStereoFromAccum } from './stereo';

const SAMPLE_RATE = 48_000;
const WINDOW = Math.max(16, Math.round(SAMPLE_RATE * 0.05));

function makeStereo(frames: number, negativeWindows: Set<number>, negativeTail = false) {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const windowIndex = Math.floor(i / WINDOW);
    const isTail = negativeTail && i >= Math.floor(frames / WINDOW) * WINDOW;
    const polarity = isTail || negativeWindows.has(windowIndex) ? -1 : 1;
    const sample = 0.3 * Math.sin((2 * Math.PI * 997 * i) / SAMPLE_RATE)
      + 0.07 * Math.sin((2 * Math.PI * 4_300 * i) / SAMPLE_RATE);
    left[i] = sample;
    right[i] = sample * polarity * 0.83;
  }
  return { left, right };
}

function referenceTimeDomainMetrics(left: Float32Array, right: Float32Array) {
  const n = Math.min(left.length, right.length);
  let midSum = 0;
  let sideSum = 0;
  let dot = 0;
  let leftSum = 0;
  let rightSum = 0;
  for (let i = 0; i < n; i++) {
    const mid = (left[i] + right[i]) * 0.5;
    const side = (left[i] - right[i]) * 0.5;
    midSum += mid * mid;
    sideSum += side * side;
    dot += left[i] * right[i];
    leftSum += left[i] * left[i];
    rightSum += right[i] * right[i];
  }

  let cancelled = 0;
  let totalEnergy = 0;
  for (let start = 0; start + WINDOW <= n; start += WINDOW) {
    let cross = 0;
    let energy = 0;
    for (let i = start; i < start + WINDOW; i++) {
      cross += left[i] * right[i];
      energy += left[i] * left[i] + right[i] * right[i];
    }
    totalEnergy += energy;
    if (cross < 0) cancelled += energy;
  }

  const gainToDb = (value: number) => value > 0 ? 20 * Math.log10(value) : -Infinity;
  return {
    widthDb: gainToDb(Math.sqrt(sideSum / Math.max(1e-12, midSum))),
    correlation: leftSum > 1e-12 && rightSum > 1e-12
      ? dot / Math.sqrt(leftSum * rightSum)
      : 1,
    midEnergyDb: gainToDb(Math.sqrt(midSum / n)),
    sideEnergyDb: gainToDb(Math.sqrt(sideSum / n)),
    balanceDb: gainToDb(Math.sqrt(leftSum / n)) - gainToDb(Math.sqrt(rightSum / n)),
    monoCompatibility: totalEnergy > 0 ? Math.max(0, 100 * (1 - cancelled / totalEnergy)) : 100,
  };
}

describe('single-pass stereo time-domain analysis', () => {
  it('matches reference width, correlation, balance and mono scores for mixed-polarity windows', () => {
    const frames = WINDOW * 7 + Math.floor(WINDOW / 2);
    const audio = makeStereo(frames, new Set([1, 4, 6]));
    const expected = referenceTimeDomainMetrics(audio.left, audio.right);
    const actual = analyzeStereo(audio.left, audio.right, SAMPLE_RATE);

    expect(actual.widthDb).toBeCloseTo(expected.widthDb, 11);
    expect(actual.correlation).toBeCloseTo(expected.correlation, 12);
    expect(actual.midEnergyDb).toBeCloseTo(expected.midEnergyDb, 11);
    expect(actual.sideEnergyDb).toBeCloseTo(expected.sideEnergyDb, 11);
    expect(actual.balanceDb).toBeCloseTo(expected.balanceDb, 11);
    expect(actual.monoCompatibility).toBeCloseTo(expected.monoCompatibility, 11);
  });

  it('continues to exclude an incomplete negative-correlation trailing window', () => {
    const audio = makeStereo(WINDOW * 4 + Math.floor(WINDOW / 2), new Set(), true);
    const expected = referenceTimeDomainMetrics(audio.left, audio.right);
    const actual = analyzeStereo(audio.left, audio.right, SAMPLE_RATE);

    expect(expected.monoCompatibility).toBeCloseTo(100, 10);
    expect(actual.monoCompatibility).toBeCloseTo(expected.monoCompatibility, 10);
  });

  it('uses the same fused time-domain metrics when finalizing shared FFT accumulations', () => {
    const audio = makeStereo(WINDOW * 5 + 37, new Set([2, 3]));
    const expected = referenceTimeDomainMetrics(audio.left, audio.right);
    const actual = finalizeStereoFromAccum(
      audio.left,
      audio.right,
      SAMPLE_RATE,
      createStereoSpectralAccum(),
    );

    expect(actual.widthDb).toBeCloseTo(expected.widthDb, 11);
    expect(actual.correlation).toBeCloseTo(expected.correlation, 12);
    expect(actual.midEnergyDb).toBeCloseTo(expected.midEnergyDb, 11);
    expect(actual.sideEnergyDb).toBeCloseTo(expected.sideEnergyDb, 11);
    expect(actual.balanceDb).toBeCloseTo(expected.balanceDb, 11);
    expect(actual.monoCompatibility).toBeCloseTo(expected.monoCompatibility, 11);
  });
});
