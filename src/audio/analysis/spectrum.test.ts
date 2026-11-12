import { describe, expect, it } from 'vitest';
import {
  BAND_CENTERS,
  accumulateSpectrum,
  createSpectrumAccum,
  finalizeSpectrum,
  getSpectrumBandBinMap,
} from './spectrum';

const SAMPLE_RATE = 48_000;
const FFT_SIZE = 4_096;

describe('cached spectrum band-bin maps', () => {
  it('matches the original half-open frequency ranges and first-match stereo map', () => {
    const actual = getSpectrumBandBinMap(SAMPLE_RATE, FFT_SIZE);
    const second = getSpectrumBandBinMap(SAMPLE_RATE, FFT_SIZE);
    expect(second).toBe(actual);

    const expectedBins: number[][] = BAND_CENTERS.map(() => []);
    const expectedFirst = new Int16Array(FFT_SIZE / 2 + 1);
    expectedFirst.fill(-1);
    const binHz = SAMPLE_RATE / FFT_SIZE;
    const sixthOctave = Math.pow(2, 1 / 6);
    for (let k = 0; k <= FFT_SIZE / 2; k++) {
      const frequency = k * binHz;
      for (let band = 0; band < BAND_CENTERS.length; band++) {
        const center = BAND_CENTERS[band];
        if (frequency >= center / sixthOctave && frequency < center * sixthOctave) {
          expectedBins[band].push(k);
          if (expectedFirst[k] < 0) expectedFirst[k] = band;
        }
      }
    }

    expect([...actual.binBand]).toEqual([...expectedFirst]);
    expect(actual.bandBins.map((bins) => [...bins])).toEqual(expectedBins);
  });

  it('preserves finalized spectrum band levels exactly', () => {
    const left = new Float32Array(FFT_SIZE * 3);
    const right = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) {
      left[i] = 0.24 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE)
        + 0.08 * Math.sin((2 * Math.PI * 5_300 * i) / SAMPLE_RATE);
      right[i] = 0.17 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE + 0.2)
        + 0.11 * Math.sin((2 * Math.PI * 8_100 * i) / SAMPLE_RATE);
    }

    const accum = createSpectrumAccum(SAMPLE_RATE);
    accumulateSpectrum(accum, left, right);
    const actual = finalizeSpectrum(accum);

    const binHz = SAMPLE_RATE / accum.fftSize;
    const frames = Math.max(1, accum.frames);
    const power = accum.power.map((value) => value / frames);
    const expectedBands = BAND_CENTERS.map((center) => {
      const low = center / Math.pow(2, 1 / 6);
      const high = center * Math.pow(2, 1 / 6);
      let sum = 0;
      let count = 0;
      for (let k = 0; k <= accum.fftSize / 2; k++) {
        const frequency = k * binHz;
        if (frequency >= low && frequency < high) {
          sum += power[k];
          count++;
        }
      }
      return {
        center,
        db: 10 * Math.log10(Math.max(sum / Math.max(1, count), 1e-12)),
      };
    });
    const averageDb = expectedBands.reduce((sum, band) => sum + band.db, 0) / expectedBands.length;

    expect(actual.bands).toEqual(expectedBands.map((band) => ({
      ...band,
      relativeDb: band.db - averageDb,
    })));
  });

  it('keeps separate cache entries for different sample rates and FFT sizes', () => {
    const first = getSpectrumBandBinMap(44_100, FFT_SIZE);
    const second = getSpectrumBandBinMap(48_000, FFT_SIZE);
    const third = getSpectrumBandBinMap(48_000, 2_048);
    expect(first).not.toBe(second);
    expect(second).not.toBe(third);
    expect(first.binBand).toHaveLength(FFT_SIZE / 2 + 1);
    expect(third.binBand).toHaveLength(1_025);
  });
});
