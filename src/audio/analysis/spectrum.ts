import { FFT, hannWindow } from '../dsp/fft';
import { gainToDb } from '../dsp/util';

export const BAND_CENTERS = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
  1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
];

export interface BandLevel {
  center: number;
  db: number;
  /** Level relative to the broadband average, used for tonal comparison. */
  relativeDb: number;
}

export interface Resonance {
  frequency: number;
  excessDb: number;
}

export interface SpectrumReport {
  bands: BandLevel[];
  centroidHz: number;
  rolloffHz: number;
  tiltDbPerOct: number;
  flatness: number;
  lowEnergyDb: number;
  highEnergyDb: number;
  resonances: Resonance[];
  maxBuildupDb: number;
  buildupBands: number[];
}

export interface SpectrumAccum {
  power: Float64Array; // per FFT bin
  frames: number;
  sampleRate: number;
  fftSize: number;
}

const FFT_SIZE = 4096;

export function createSpectrumAccum(sampleRate: number): SpectrumAccum {
  return { power: new Float64Array(FFT_SIZE / 2 + 1), frames: 0, sampleRate, fftSize: FFT_SIZE };
}

/**
 * Accumulate stereo power without downmixing first. A simple L/R mono sum can
 * cancel out-of-phase material and falsely report missing frequency energy.
 * Each channel is windowed and transformed independently; their powers are
 * averaged. Frames overlap by 50%.
 */
export function accumulateSpectrum(
  accum: SpectrumAccum,
  L: Float32Array,
  R: Float32Array,
  startSample = 0,
  endSample?: number,
  onProgress?: (f: number) => void,
): SpectrumAccum {
  const n = Math.min(L.length, R.length, endSample ?? Infinity);
  const fft = new FFT(FFT_SIZE);
  const window = hannWindow(FFT_SIZE);
  const reL = new Float64Array(FFT_SIZE);
  const imL = new Float64Array(FFT_SIZE);
  const reR = new Float64Array(FFT_SIZE);
  const imR = new Float64Array(FFT_SIZE);
  const hop = FFT_SIZE / 2;
  let frames = 0;
  for (let start = startSample; start + FFT_SIZE <= n; start += hop) {
    for (let i = 0; i < FFT_SIZE; i++) {
      reL[i] = L[start + i] * window[i];
      reR[i] = R[start + i] * window[i];
      imL[i] = 0;
      imR[i] = 0;
    }
    fft.forward(reL, imL);
    fft.forward(reR, imR);
    for (let k = 0; k <= FFT_SIZE / 2; k++) {
      const leftPower = reL[k] * reL[k] + imL[k] * imL[k];
      const rightPower = reR[k] * reR[k] + imR[k] * imR[k];
      accum.power[k] += (leftPower + rightPower) * 0.5;
    }
    frames++;
    if (onProgress && (frames & 0xff) === 0) onProgress((start - startSample) / Math.max(1, n - startSample));
  }
  accum.frames += frames;
  return accum;
}

/** Convert an accumulated power spectrum into band levels and descriptors. */
export function finalizeSpectrum(accum: SpectrumAccum): SpectrumReport {
  const sr = accum.sampleRate;
  const binHz = sr / accum.fftSize;
  const frames = Math.max(1, accum.frames);
  const power = accum.power.map((p) => p / frames);

  const bands: BandLevel[] = BAND_CENTERS.map((center) => {
    const low = center / Math.pow(2, 1 / 6);
    const high = center * Math.pow(2, 1 / 6);
    let sum = 0;
    let count = 0;
    for (let k = 0; k <= accum.fftSize / 2; k++) {
      const f = k * binHz;
      if (f >= low && f < high) {
        sum += power[k];
        count++;
      }
    }
    const db = 10 * Math.log10(Math.max(sum / Math.max(1, count), 1e-12));
    return { center, db, relativeDb: 0 };
  });
  const averageDb = bands.reduce((a, b) => a + b.db, 0) / bands.length;
  for (const band of bands) band.relativeDb = band.db - averageDb;

  let centroidNum = 0;
  let centroidDen = 0;
  let totalPower = 0;
  for (let k = 1; k <= accum.fftSize / 2; k++) {
    const f = k * binHz;
    centroidNum += f * power[k];
    centroidDen += power[k];
    totalPower += power[k];
  }
  const centroidHz = centroidDen > 0 ? centroidNum / centroidDen : 0;

  let cumulative = 0;
  let rolloffHz = 0;
  const target = totalPower * 0.85;
  for (let k = 0; k <= accum.fftSize / 2; k++) {
    cumulative += power[k];
    if (cumulative >= target) {
      rolloffHz = k * binHz;
      break;
    }
  }

  // Spectral tilt: least-squares slope of dB against octaves, 100 Hz–10 kHz.
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, count = 0;
  for (const band of bands) {
    if (band.center < 100 || band.center > 10000) continue;
    const x = Math.log2(band.center);
    sumX += x;
    sumY += band.db;
    sumXY += x * band.db;
    sumXX += x * x;
    count++;
  }
  const tilt = count > 1 ? (count * sumXY - sumX * sumY) / Math.max(1e-9, count * sumXX - sumX * sumX) : 0;

  // Spectral flatness from the raw bin magnitudes (1 Hz–10 kHz).
  let logSum = 0;
  let linSum = 0;
  let flatCount = 0;
  for (let k = 1; k <= accum.fftSize / 2; k++) {
    const f = k * binHz;
    if (f < 20 || f > 16000) continue;
    const p = Math.max(power[k], 1e-15);
    logSum += Math.log(p);
    linSum += p;
    flatCount++;
  }
  const flatness = flatCount
    ? Math.exp(logSum / flatCount) / Math.max(1e-15, linSum / flatCount)
    : 0;

  // Energy extremes.
  const lowBands = bands.filter((b) => b.center <= 120);
  const highBands = bands.filter((b) => b.center >= 6000);
  const lowEnergy = lowBands.reduce((a, b) => a + b.db, 0) / Math.max(1, lowBands.length);
  const highEnergy = highBands.reduce((a, b) => a + b.db, 0) / Math.max(1, highBands.length);

  // Resonance / buildup detection: band level above a 1/3-octave median envelope.
  const smoothed = bands.map((_, i) => {
    const window = bands.slice(Math.max(0, i - 3), Math.min(bands.length, i + 4));
    const sorted = window.map((b) => b.db).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  });
  const deviations = bands.map((b, i) => b.db - smoothed[i]);
  const resonances: Resonance[] = deviations
    .map((dev, i) => ({ frequency: bands[i].center, excessDb: dev }))
    .filter((r) => r.excessDb > 4)
    .sort((a, b) => b.excessDb - a.excessDb)
    .slice(0, 5);
  const maxBuildup = Math.max(0, ...deviations);
  const buildupBands = deviations
    .map((dev, i) => ({ dev, center: bands[i].center }))
    .filter((x) => x.dev > 3)
    .map((x) => x.center);

  void gainToDb;
  return {
    bands,
    centroidHz,
    rolloffHz,
    tiltDbPerOct: tilt,
    flatness,
    lowEnergyDb: Number.isFinite(lowEnergy) ? lowEnergy : -120,
    highEnergyDb: Number.isFinite(highEnergy) ? highEnergy : -120,
    resonances,
    maxBuildupDb: maxBuildup,
    buildupBands,
  };
}

/** Peak-hold spectrum for the live analyser in the UI (2048 bins max). */
export function spectrumForDisplay(
  L: Float32Array,
  R: Float32Array,
  sampleRate: number,
  bins = 512,
): Float32Array {
  const size = 4096;
  const fft = new FFT(size);
  const window = hannWindow(size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const n = Math.min(L.length, R.length);
  const offset = Math.max(0, n - size);
  for (let i = 0; i < size; i++) {
    const idx = offset + i;
    re[i] = idx < n ? ((L[idx] + R[idx]) * 0.5) * window[i] : 0;
    im[i] = 0;
  }
  fft.forward(re, im);
  const out = new Float32Array(bins);
  const half = size / 2;
  for (let b = 0; b < bins; b++) {
    const low = Math.floor(Math.pow(b / bins, 2) * half);
    const high = Math.max(low + 1, Math.floor(Math.pow((b + 1) / bins, 2) * half));
    let sum = 0;
    for (let k = low; k < high; k++) sum += re[k] * re[k] + im[k] * im[k];
    out[b] = 10 * Math.log10(Math.max(sum / (high - low), 1e-12));
  }
  void sampleRate;
  return out;
}
