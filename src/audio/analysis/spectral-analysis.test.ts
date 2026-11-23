import { describe, expect, it } from 'vitest';
import { analyzeSpectrumAndStereo } from './spectral-analysis';
import { accumulateSpectrum, createSpectrumAccum, finalizeSpectrum } from './spectrum';
import { analyzeStereo } from './stereo';

const SAMPLE_RATE = 48_000;

function stereoSignal(frames: number, variant: number) {
  const L = new Float32Array(frames);
  const R = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const fundamental = Math.sin((2 * Math.PI * (variant === 0 ? 440 : 1_750) * i) / SAMPLE_RATE);
    const harmonic = 0.31 * Math.sin((2 * Math.PI * 6_200 * i) / SAMPLE_RATE + 0.21);
    const transient = i % 7_919 < 40 ? 0.12 * Math.sin((2 * Math.PI * 9_000 * i) / SAMPLE_RATE) : 0;
    L[i] = 0.28 * fundamental + harmonic + transient;
    R[i] = variant === 1
      ? -0.22 * fundamental + 0.17 * harmonic - transient
      : 0.19 * fundamental + 0.72 * harmonic + transient * 0.4;
  }
  return { L, R };
}

function expectCloseReports(actual: unknown, expected: unknown) {
  expect(actual).toEqual(expected);
}

describe('shared spectrum and stereo FFT pass', () => {
  it.each([0, 1])('matches independent spectrum and stereo metrics for stereo fixture %i', (variant) => {
    const { L, R } = stereoSignal(SAMPLE_RATE * 5 + 1_237, variant);
    const independentAccum = createSpectrumAccum(SAMPLE_RATE);
    accumulateSpectrum(independentAccum, L, R, 0, L.length);
    const independentSpectrum = finalizeSpectrum(independentAccum);
    const independentStereo = analyzeStereo(L, R, SAMPLE_RATE);

    const combined = analyzeSpectrumAndStereo(L, R, SAMPLE_RATE);

    expectCloseReports(combined.spectrum, independentSpectrum);
    expectCloseReports(combined.stereo, independentStereo);
  });

  it('handles audio shorter than one FFT frame without fabricating spectral or stereo detail', () => {
    const { L, R } = stereoSignal(1_024, 0);
    const combined = analyzeSpectrumAndStereo(L, R, SAMPLE_RATE);
    const independentAccum = createSpectrumAccum(SAMPLE_RATE);
    const independentSpectrum = finalizeSpectrum(independentAccum);
    const independentStereo = analyzeStereo(L, R, SAMPLE_RATE);

    expect(combined.spectrum).toEqual(independentSpectrum);
    expect(combined.stereo).toEqual(independentStereo);
  });

  it('reports completed shared-pass progress', () => {
    const { L, R } = stereoSignal(SAMPLE_RATE * 2, 0);
    const values: number[] = [];
    analyzeSpectrumAndStereo(L, R, SAMPLE_RATE, (fraction) => values.push(fraction));
    expect(values.length).toBeGreaterThan(0);
    expect(values[values.length - 1]).toBe(1);
    expect(values.every((value) => value >= 0 && value <= 1)).toBe(true);
  });
});
