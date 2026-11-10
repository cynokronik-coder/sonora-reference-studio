import { FFT, hannWindow } from '../dsp/fft';
import { rms, gainToDb } from '../dsp/util';
import { BAND_CENTERS } from './spectrum';

export interface BandStereo {
  center: number;
  widthDb: number;
  correlation: number;
  sideEnergyDb: number;
}

export interface StereoReport {
  widthDb: number;
  correlation: number;
  midEnergyDb: number;
  sideEnergyDb: number;
  balanceDb: number;
  monoCompatibility: number;
  lowSideRatioDb: number;
  bandWidth: BandStereo[];
}

export interface StereoSpectralAccum {
  midPower: Float64Array;
  sidePower: Float64Array;
  crossRe: Float64Array;
  leftPower: Float64Array;
  rightPower: Float64Array;
  frames: number;
}

export function createStereoSpectralAccum(): StereoSpectralAccum {
  const count = BAND_CENTERS.length;
  return {
    midPower: new Float64Array(count),
    sidePower: new Float64Array(count),
    crossRe: new Float64Array(count),
    leftPower: new Float64Array(count),
    rightPower: new Float64Array(count),
    frames: 0,
  };
}

/**
 * Finish stereo descriptors from a shared FFT accumulation. The time-domain
 * global width/correlation/mono checks are kept separate from the FFT pass,
 * while all per-band spectral metrics reuse the shared transforms.
 */
export function finalizeStereoFromAccum(
  L: Float32Array,
  R: Float32Array,
  sampleRate: number,
  accum: StereoSpectralAccum,
  onProgress?: (fraction: number) => void,
): StereoReport {
  const n = Math.min(L.length, R.length);
  if (n === 0) {
    return {
      widthDb: -60, correlation: 1, midEnergyDb: -120, sideEnergyDb: -120,
      balanceDb: 0, monoCompatibility: 100, lowSideRatioDb: -60, bandWidth: [],
    };
  }

  let midSum = 0;
  let sideSum = 0;
  let dot = 0;
  let lSum = 0;
  let rSum = 0;
  for (let i = 0; i < n; i++) {
    const left = L[i];
    const right = R[i];
    const mid = (left + right) * 0.5;
    const side = (left - right) * 0.5;
    midSum += mid * mid;
    sideSum += side * side;
    dot += left * right;
    lSum += left * left;
    rSum += right * right;
    if (onProgress && (i & 0xfffff) === 0) onProgress(i / n);
  }

  const correlation = lSum > 1e-12 && rSum > 1e-12 ? dot / Math.sqrt(lSum * rSum) : 1;
  const widthDb = gainToDb(Math.sqrt(sideSum / Math.max(1e-12, midSum)));
  const midEnergyDb = gainToDb(Math.sqrt(midSum / n));
  const sideEnergyDb = gainToDb(Math.sqrt(sideSum / n));
  const balanceDb = gainToDb(Math.sqrt(lSum / n)) - gainToDb(Math.sqrt(rSum / n));

  const win = Math.max(16, Math.round(sampleRate * 0.05));
  let cancelled = 0;
  let totalEnergy = 0;
  for (let start = 0; start + win <= n; start += win) {
    let cross = 0;
    let energy = 0;
    for (let i = start; i < start + win; i++) {
      cross += L[i] * R[i];
      energy += L[i] * L[i] + R[i] * R[i];
    }
    totalEnergy += energy;
    if (cross < 0) cancelled += energy;
  }
  const monoCompatibility = totalEnergy > 0 ? Math.max(0, 100 * (1 - cancelled / totalEnergy)) : 100;

  const bandWidth: BandStereo[] = BAND_CENTERS.map((center, i) => {
    const mid = accum.midPower[i] / Math.max(1, accum.frames);
    const side = accum.sidePower[i] / Math.max(1, accum.frames);
    const corr = accum.leftPower[i] > 1e-12 && accum.rightPower[i] > 1e-12
      ? accum.crossRe[i] / Math.sqrt(accum.leftPower[i] * accum.rightPower[i])
      : 1;
    return {
      center,
      widthDb: gainToDb(Math.sqrt(side / Math.max(1e-15, mid))),
      correlation: corr,
      sideEnergyDb: 10 * Math.log10(Math.max(side, 1e-15)),
    };
  });

  const lowBands = bandWidth.filter((band) => band.center <= 120);
  const lowSideRatioDb = lowBands.length
    ? lowBands.reduce((sum, band) => sum + band.widthDb, 0) / lowBands.length
    : -60;

  if (onProgress) onProgress(1);
  return {
    widthDb,
    correlation,
    midEnergyDb,
    sideEnergyDb,
    balanceDb,
    monoCompatibility,
    lowSideRatioDb,
    bandWidth,
  };
}

/**
 * Stereo measurement.
 *
 * Global width is the side/mid energy ratio. Per-band mid/side energy and
 * correlation come from complex spectra, so the low-end side ratio is a real
 * measurement rather than a guess. Mono compatibility is the fraction of
 * short-window energy that survives a mono fold-down (negative-correlation
 * energy is cancelled).
 */
export function analyzeStereo(
  L: Float32Array,
  R: Float32Array,
  sampleRate: number,
  onProgress?: (f: number) => void,
): StereoReport {
  const n = Math.min(L.length, R.length);
  if (n === 0) {
    return {
      widthDb: -60, correlation: 1, midEnergyDb: -120, sideEnergyDb: -120,
      balanceDb: 0, monoCompatibility: 100, lowSideRatioDb: -60, bandWidth: [],
    };
  }

  let midSum = 0;
  let sideSum = 0;
  let dot = 0;
  let lSum = 0;
  let rSum = 0;
  for (let i = 0; i < n; i++) {
    const m = (L[i] + R[i]) * 0.5;
    const s = (L[i] - R[i]) * 0.5;
    midSum += m * m;
    sideSum += s * s;
    dot += L[i] * R[i];
    lSum += L[i] * L[i];
    rSum += R[i] * R[i];
    if (onProgress && (i & 0xfffff) === 0) onProgress(i / n);
  }
  const correlation = lSum > 1e-12 && rSum > 1e-12 ? dot / Math.sqrt(lSum * rSum) : 1;
  const widthDb = gainToDb(Math.sqrt(sideSum / Math.max(1e-12, midSum)));
  const midEnergyDb = gainToDb(Math.sqrt(midSum / n));
  const sideEnergyDb = gainToDb(Math.sqrt(sideSum / n));
  const balanceDb = gainToDb(Math.sqrt(lSum / n)) - gainToDb(Math.sqrt(rSum / n));

  // Mono compatibility: energy in 50 ms windows with negative correlation.
  const win = Math.max(16, Math.round(sampleRate * 0.05));
  let cancelled = 0;
  let totalEnergy = 0;
  for (let start = 0; start + win <= n; start += win) {
    let d = 0, e = 0;
    for (let i = start; i < start + win; i++) {
      d += L[i] * R[i];
      e += L[i] * L[i] + R[i] * R[i];
    }
    totalEnergy += e;
    if (d < 0) cancelled += e;
  }
  const monoCompatibility = totalEnergy > 0 ? Math.max(0, 100 * (1 - cancelled / totalEnergy)) : 100;

  // Per-band complex mid/side analysis.
  const fftSize = 4096;
  const fft = new FFT(fftSize);
  const window = hannWindow(fftSize);
  const reL = new Float64Array(fftSize);
  const imL = new Float64Array(fftSize);
  const reR = new Float64Array(fftSize);
  const imR = new Float64Array(fftSize);
  const hop = fftSize / 2;
  const binHz = sampleRate / fftSize;
  const bandCount = BAND_CENTERS.length;
  const midPower = new Float64Array(bandCount);
  const sidePower = new Float64Array(bandCount);
  const crossRe = new Float64Array(bandCount);
  const crossIm = new Float64Array(bandCount);
  const lPower = new Float64Array(bandCount);
  const rPower = new Float64Array(bandCount);
  let frames = 0;

  for (let start = 0; start + fftSize <= n; start += hop) {
    for (let i = 0; i < fftSize; i++) {
      reL[i] = L[start + i] * window[i];
      imL[i] = 0;
      reR[i] = R[start + i] * window[i];
      imR[i] = 0;
    }
    fft.forward(reL, imL);
    fft.forward(reR, imR);
    for (let k = 1; k <= fftSize / 2; k++) {
      const f = k * binHz;
      const band = bandIndexFor(f);
      if (band < 0) continue;
      const mr = (reL[k] + reR[k]) * 0.5;
      const mi = (imL[k] + imR[k]) * 0.5;
      const sr = (reL[k] - reR[k]) * 0.5;
      const si = (imL[k] - imR[k]) * 0.5;
      midPower[band] += mr * mr + mi * mi;
      sidePower[band] += sr * sr + si * si;
      // Cross spectrum L·conj(R) for per-band correlation.
      crossRe[band] += reL[k] * reR[k] + imL[k] * imR[k];
      crossIm[band] += imL[k] * reR[k] - reL[k] * imR[k];
      lPower[band] += reL[k] * reL[k] + imL[k] * imL[k];
      rPower[band] += reR[k] * reR[k] + imR[k] * imR[k];
    }
    frames++;
  }

  const bandWidth: BandStereo[] = BAND_CENTERS.map((center, i) => {
    const mid = midPower[i] / Math.max(1, frames);
    const side = sidePower[i] / Math.max(1, frames);
    const corr = lPower[i] > 1e-12 && rPower[i] > 1e-12
      ? crossRe[i] / Math.sqrt(lPower[i] * rPower[i])
      : 1;
    void crossIm;
    return {
      center,
      widthDb: gainToDb(Math.sqrt(side / Math.max(1e-15, mid))),
      correlation: corr,
      sideEnergyDb: 10 * Math.log10(Math.max(side, 1e-15)),
    };
  });

  const lowBands = bandWidth.filter((b) => b.center <= 120);
  const lowSideRatioDb = lowBands.length
    ? lowBands.reduce((a, b) => a + b.widthDb, 0) / lowBands.length
    : -60;

  void rms;
  return {
    widthDb,
    correlation,
    midEnergyDb,
    sideEnergyDb,
    balanceDb,
    monoCompatibility,
    lowSideRatioDb,
    bandWidth,
  };
}

function bandIndexFor(f: number): number {
  for (let i = 0; i < BAND_CENTERS.length; i++) {
    const center = BAND_CENTERS[i];
    const low = center / Math.pow(2, 1 / 6);
    const high = center * Math.pow(2, 1 / 6);
    if (f >= low && f < high) return i;
  }
  return -1;
}
