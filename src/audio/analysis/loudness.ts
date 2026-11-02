import { Biquad } from '../dsp/biquad';
import { TruePeakMeter } from '../dsp/oversample';
import { gainToDb, percentile } from '../dsp/util';

export interface LoudnessPoint {
  time: number;
  lufs: number;
}

export interface LoudnessReport {
  integratedLufs: number;
  momentaryMaxLufs: number;
  shortTermMaxLufs: number;
  lra: number;
  truePeakDb: number;
  samplePeakDb: number;
  rmsDb: number;
  crestDb: number;
  plrDb: number;
  dynamicRangeDb: number;
  shortTerm: LoudnessPoint[];
  momentary: LoudnessPoint[];
}

/**
 * ITU-R BS.1770-4 loudness measurement.
 *
 * Two-stage K-weighting (high shelf then RLB high-pass) is applied per channel,
 * 400 ms blocks are gated at -70 LUFS absolute and -10 LU relative, and the
 * integrated value is the gated mean power. True peak is estimated with 4x
 * oversampling, not from the sample peak.
 */
export function analyzeLoudness(
  L: Float32Array,
  R: Float32Array,
  sampleRate: number,
  onProgress?: (fraction: number) => void,
): LoudnessReport {
  const n = Math.min(L.length, R.length);
  if (n === 0) {
    return {
      integratedLufs: -Infinity, momentaryMaxLufs: -Infinity, shortTermMaxLufs: -Infinity,
      lra: 0, truePeakDb: -Infinity, samplePeakDb: -Infinity, rmsDb: -Infinity,
      crestDb: 0, plrDb: 0, dynamicRangeDb: 0, shortTerm: [], momentary: [],
    };
  }

  const sheen = (() => {
    const bq = new Biquad();
    bq.configure('highshelf', 1681.974450955533, 3.999843853973347, 0.7071752369554196, sampleRate);
    return bq;
  })();
  const rlb = (() => {
    const bq = new Biquad();
    bq.configure('highpass', 38.13547087602444, 0, 0.5003270373238773, sampleRate);
    return bq;
  })();

  const filteredL = new Float32Array(n);
  const filteredR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    filteredL[i] = rlb.process(sheen.process(L[i]));
    filteredR[i] = rlb.process(sheen.process(R[i]));
    if (onProgress && (i & 0xfffff) === 0) onProgress(i / n);
  }

  const blockSize = Math.max(1, Math.round(sampleRate * 0.4));
  const hop = Math.max(1, Math.round(sampleRate * 0.1));
  const blockPowers: number[] = [];
  const blockTimes: number[] = [];
  for (let start = 0; start + blockSize <= n; start += hop) {
    let sum = 0;
    for (let i = start; i < start + blockSize; i++) {
      sum += filteredL[i] * filteredL[i] + filteredR[i] * filteredR[i];
    }
    blockPowers.push(sum / blockSize);
    blockTimes.push(start / sampleRate);
  }
  if (blockPowers.length === 0) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += filteredL[i] * filteredL[i] + filteredR[i] * filteredR[i];
    blockPowers.push(sum / n);
    blockTimes.push(0);
  }
  const loudnessOf = (power: number) => -0.691 + 10 * Math.log10(Math.max(power, 1e-12));
  const loudnessBlocks = blockPowers.map(loudnessOf);

  const absGated = blockPowers.filter((_, i) => loudnessBlocks[i] > -70);
  const absMeanPower = absGated.length
    ? absGated.reduce((a, b) => a + b, 0) / absGated.length
    : blockPowers[0];
  const relativeGate = loudnessOf(absMeanPower) - 10;
  const gated = blockPowers.filter((_, i) => loudnessBlocks[i] > -70 && loudnessBlocks[i] > relativeGate);
  const integratedPower = gated.length
    ? gated.reduce((a, b) => a + b, 0) / gated.length
    : absMeanPower;
  const integratedLufs = loudnessOf(integratedPower);

  // Momentary (400 ms, ungated) and short-term (3 s) series.
  const momentary: LoudnessPoint[] = blockTimes.map((t, i) => ({ time: t, lufs: loudnessBlocks[i] }));
  const shortBlock = Math.round(sampleRate * 3);
  const shortHop = Math.round(sampleRate * 0.1);
  const shortTerm: LoudnessPoint[] = [];
  for (let start = 0; start + shortBlock <= n; start += shortHop) {
    let sum = 0;
    for (let i = start; i < start + shortBlock; i++) {
      sum += filteredL[i] * filteredL[i] + filteredR[i] * filteredR[i];
    }
    shortTerm.push({ time: start / sampleRate, lufs: loudnessOf(sum / shortBlock) });
  }
  if (shortTerm.length === 0) shortTerm.push({ time: 0, lufs: integratedLufs });

  // EBU Tech 3342 loudness range: 10th to 95th percentile of gated short-term.
  const stValues = shortTerm.map((p) => p.lufs).filter((v) => Number.isFinite(v) && v > -70);
  const stMeanPower = stValues.length
    ? stValues.reduce((a, v) => a + Math.pow(10, v / 10), 0) / stValues.length
    : 0;
  const stRelativeGate = (stMeanPower > 0 ? 10 * Math.log10(stMeanPower) : -70) - 20;
  const lraValues = stValues.filter((v) => v > stRelativeGate);
  const lra = lraValues.length > 1 ? percentile(lraValues, 0.95) - percentile(lraValues, 0.1) : 0;
  const dynamicRangeDb =
    stValues.length > 1 ? percentile(stValues, 0.95) - percentile(stValues, 0.05) : 0;

  // Peaks.
  let samplePeak = 0;
  let sumSquares = 0;
  for (let i = 0; i < n; i++) {
    const al = Math.abs(L[i]);
    const ar = Math.abs(R[i]);
    if (al > samplePeak) samplePeak = al;
    if (ar > samplePeak) samplePeak = ar;
    sumSquares += L[i] * L[i] + R[i] * R[i];
  }
  const rms = Math.sqrt(sumSquares / (n * 2));
  const tpMeter = new TruePeakMeter(sampleRate, 2, 2048);
  let truePeak = 0;
  for (let start = 0; start < n; start += 512) {
    const end = Math.min(n, start + 512);
    const lChunk = L.subarray(start, end);
    const rChunk = R.subarray(start, end);
    const tp = tpMeter.process(lChunk, rChunk, end - start);
    if (tp > truePeak) truePeak = tp;
  }

  const samplePeakDb = gainToDb(samplePeak);
  const truePeakDb = gainToDb(truePeak);
  const rmsDb = gainToDb(rms);
  return {
    integratedLufs,
    momentaryMaxLufs: Math.max(...momentary.map((p) => p.lufs)),
    shortTermMaxLufs: Math.max(...shortTerm.map((p) => p.lufs)),
    lra,
    truePeakDb,
    samplePeakDb,
    rmsDb,
    crestDb: samplePeakDb - rmsDb,
    plrDb: truePeakDb - integratedLufs,
    dynamicRangeDb,
    shortTerm: downsampleSeries(shortTerm, 400),
    momentary: downsampleSeries(momentary, 400),
  };
}

function downsampleSeries(points: LoudnessPoint[], maxPoints: number): LoudnessPoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out: LoudnessPoint[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  return out;
}

/** Integrated loudness of a sub-range, used for section analysis. */
export function loudnessOfRange(
  L: Float32Array,
  R: Float32Array,
  sampleRate: number,
  startSec: number,
  endSec: number,
): { lufs: number; crestDb: number } {
  const start = Math.max(0, Math.floor(startSec * sampleRate));
  const end = Math.min(L.length, Math.floor(endSec * sampleRate));
  if (end - start < sampleRate * 0.2) return { lufs: -Infinity, crestDb: 0 };
  const report = analyzeLoudness(L.subarray(start, end), R.subarray(start, end), sampleRate);
  return { lufs: report.integratedLufs, crestDb: report.crestDb };
}
