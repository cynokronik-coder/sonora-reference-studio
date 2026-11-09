import { Biquad } from '../dsp/biquad';
import { Annex2TruePeakMeter } from '../dsp/oversample';

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

const ABSOLUTE_GATE_LUFS = -70;
const INTEGRATED_RELATIVE_GATE_LU = -10;
const LRA_RELATIVE_GATE_LU = -20;
const MOMENTARY_SECONDS = 0.4;
const SHORT_TERM_SECONDS = 3;
const SHORT_TERM_FLUSH_SECONDS = 1.5;
const ANALYSIS_HOP_SECONDS = 0.1;

const safeDb = (value: number): number => value > 0 ? 20 * Math.log10(value) : -Infinity;
const finiteDifference = (a: number, b: number): number =>
  Number.isFinite(a) && Number.isFinite(b) ? a - b : 0;

/** EBU Tech 3342's reference percentile selection uses a rounded rank. */
function ebuPercentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.round((sorted.length - 1) * Math.max(0, Math.min(1, fraction)));
  return sorted[rank];
}

function emptyReport(): LoudnessReport {
  return {
    integratedLufs: -Infinity,
    momentaryMaxLufs: -Infinity,
    shortTermMaxLufs: -Infinity,
    lra: 0,
    truePeakDb: -Infinity,
    samplePeakDb: -Infinity,
    rmsDb: -Infinity,
    crestDb: 0,
    plrDb: 0,
    dynamicRangeDb: 0,
    shortTerm: [],
    momentary: [],
  };
}

/**
 * ITU-R BS.1770-5 Annex 1 loudness measurement for stereo programme audio,
 * with EBU Tech 3341 time windows and EBU Tech 3342 Loudness Range.
 *
 * K-weighting is applied independently per channel. Integrated loudness uses
 * complete 400 ms blocks with 75% overlap and the -70 LUFS / -10 LU relative
 * gates. Momentary and short-term values use ungated 400 ms and 3 s sliding
 * windows, updated every 100 ms. The 3 s analysis is flushed with 1.5 s of
 * trailing silence as specified for file-based LRA calculation by Tech 3342.
 * True peak uses the 4-phase FIR interpolation filter in BS.1770-5 Annex 2.
 */
export function analyzeLoudness(
  L: Float32Array,
  R: Float32Array,
  sampleRate: number,
  onProgress?: (fraction: number) => void,
): LoudnessReport {
  const n = Math.min(L.length, R.length);
  if (n === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) return emptyReport();

  // ITU-R BS.1770 K-weighting: independent shelving and RLB stages for L/R.
  const makeKWeighting = () => {
    const shelf = new Biquad();
    shelf.configure('highshelf', 1681.974450955533, 3.999843853973347, 0.7071752369554196, sampleRate);
    const rlb = new Biquad();
    rlb.configure('highpass', 38.13547087602444, 0, 0.5003270373238773, sampleRate);
    return { shelf, rlb };
  };
  const leftWeighting = makeKWeighting();
  const rightWeighting = makeKWeighting();
  const filteredL = new Float32Array(n);
  const filteredR = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    filteredL[i] = leftWeighting.rlb.process(leftWeighting.shelf.process(L[i]));
    filteredR[i] = rightWeighting.rlb.process(rightWeighting.shelf.process(R[i]));
    if (onProgress && (i & 0xfffff) === 0) onProgress(i / n);
  }

  const blockSize = Math.max(1, Math.round(sampleRate * MOMENTARY_SECONDS));
  const hop = Math.max(1, Math.round(sampleRate * ANALYSIS_HOP_SECONDS));
  const loudnessOfPower = (power: number) =>
    power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity;

  // BS.1770-5 integrated loudness: discard incomplete 400 ms gating blocks.
  const blockPowers: number[] = [];
  const blockTimes: number[] = [];
  for (let start = 0; start + blockSize <= n; start += hop) {
    let sum = 0;
    for (let i = start; i < start + blockSize; i++) {
      sum += filteredL[i] * filteredL[i] + filteredR[i] * filteredR[i];
    }
    blockPowers.push(sum / blockSize);
    blockTimes.push(start / sampleRate + MOMENTARY_SECONDS * 0.5);
  }

  const loudnessBlocks = blockPowers.map(loudnessOfPower);
  const absoluteGatedPowers = blockPowers.filter((_, i) => loudnessBlocks[i] > ABSOLUTE_GATE_LUFS);
  let integratedLufs = -Infinity;
  if (absoluteGatedPowers.length > 0) {
    const absoluteMeanPower = absoluteGatedPowers.reduce((sum, value) => sum + value, 0) / absoluteGatedPowers.length;
    const relativeGate = loudnessOfPower(absoluteMeanPower) + INTEGRATED_RELATIVE_GATE_LU;
    const gatedPowers = blockPowers.filter(
      (_, i) => loudnessBlocks[i] > ABSOLUTE_GATE_LUFS && loudnessBlocks[i] > relativeGate,
    );
    if (gatedPowers.length > 0) {
      const integratedPower = gatedPowers.reduce((sum, value) => sum + value, 0) / gatedPowers.length;
      integratedLufs = loudnessOfPower(integratedPower);
    }
  }

  // EBU Tech 3341 Momentary is an ungated 400 ms sliding window.
  const momentary: LoudnessPoint[] = blockTimes.map((time, i) => ({ time, lufs: loudnessBlocks[i] }));
  let momentaryMaxLufs = -Infinity;
  for (const point of momentary) momentaryMaxLufs = Math.max(momentaryMaxLufs, point.lufs);

  // EBU Tech 3341 Short-term is an ungated 3 s sliding window, updated at
  // 10 Hz. Tech 3342 specifies 1.5 s of trailing silence for file-based LRA
  // analysis so the final centred windows are included.
  const shortBlock = Math.max(1, Math.round(sampleRate * SHORT_TERM_SECONDS));
  const shortHop = Math.max(1, Math.round(sampleRate * ANALYSIS_HOP_SECONDS));
  const flushSamples = Math.round(sampleRate * SHORT_TERM_FLUSH_SECONDS);
  const shortTerm: LoudnessPoint[] = [];
  if (n + flushSamples >= shortBlock) {
    for (let start = 0; start < n && start + shortBlock <= n + flushSamples; start += shortHop) {
      const end = Math.min(n, start + shortBlock);
      let sum = 0;
      for (let i = start; i < end; i++) {
        sum += filteredL[i] * filteredL[i] + filteredR[i] * filteredR[i];
      }
      // Remaining samples in the 3 s window are trailing silence (zero power).
      shortTerm.push({
        time: start / sampleRate + SHORT_TERM_SECONDS * 0.5,
        lufs: loudnessOfPower(sum / shortBlock),
      });
    }
  }
  let shortTermMaxLufs = -Infinity;
  for (const point of shortTerm) shortTermMaxLufs = Math.max(shortTermMaxLufs, point.lufs);

  // EBU Tech 3342 LRA: -70 LUFS absolute gate, then -20 LU relative to
  // the mean power of the absolute-gated 3 s short-term loudness distribution.
  const absoluteGatedShortTerm = shortTerm
    .map((point) => point.lufs)
    .filter((value) => Number.isFinite(value) && value >= ABSOLUTE_GATE_LUFS);
  let lra = 0;
  if (absoluteGatedShortTerm.length > 0) {
    const meanShortTermPower = absoluteGatedShortTerm.reduce(
      (sum, value) => sum + Math.pow(10, value / 10),
      0,
    ) / absoluteGatedShortTerm.length;
    const relativeGate = 10 * Math.log10(meanShortTermPower) + LRA_RELATIVE_GATE_LU;
    const relativeGated = absoluteGatedShortTerm.filter((value) => value >= relativeGate);
    if (relativeGated.length > 0) {
      lra = ebuPercentile(relativeGated, 0.95) - ebuPercentile(relativeGated, 0.10);
    }
  }

  // Non-standard supplementary dynamic-range descriptor (P95 - P05). It is
  // intentionally kept separate from EBU LRA and must not be labelled LRA.
  const dynamicRangeDb = absoluteGatedShortTerm.length > 1
    ? ebuPercentile(absoluteGatedShortTerm, 0.95) - ebuPercentile(absoluteGatedShortTerm, 0.05)
    : 0;

  // Sample peak and RMS are measured from the original, unweighted PCM.
  let samplePeak = 0;
  let sumSquares = 0;
  for (let i = 0; i < n; i++) {
    samplePeak = Math.max(samplePeak, Math.abs(L[i]), Math.abs(R[i]));
    sumSquares += L[i] * L[i] + R[i] * R[i];
  }
  const rms = Math.sqrt(sumSquares / (n * 2));

  // True peak: BS.1770-5 Annex 2 4-phase FIR interpolation, including the
  // post-file FIR tail so the last input samples contribute to the maximum.
  const truePeakMeter = new Annex2TruePeakMeter();
  let truePeak = 0;
  for (let start = 0; start < n; start += 512) {
    const end = Math.min(n, start + 512);
    truePeak = Math.max(truePeak, truePeakMeter.process(L.subarray(start, end), R.subarray(start, end), end - start));
  }
  truePeak = Math.max(truePeak, truePeakMeter.flush());

  const samplePeakDb = safeDb(samplePeak);
  const truePeakDb = safeDb(truePeak);
  const rmsDb = safeDb(rms);
  return {
    integratedLufs,
    momentaryMaxLufs,
    shortTermMaxLufs,
    lra,
    truePeakDb,
    samplePeakDb,
    rmsDb,
    crestDb: finiteDifference(samplePeakDb, rmsDb),
    plrDb: finiteDifference(truePeakDb, integratedLufs),
    dynamicRangeDb,
    shortTerm: downsampleSeries(shortTerm, 400),
    momentary: downsampleSeries(momentary, 400),
  };
}

/**
 * Apply one common gain to stereo PCM so its Annex 2 FIR-measured true peak
 * reaches the requested dBTP value. The arrays are modified in place and the
 * applied linear gain is returned. This is intended for a final PCM buffer
 * after sample-rate conversion and before encoding.
 */
export function normalizeToTruePeak(L: Float32Array, R: Float32Array, targetDbTp: number): number {
  const n = Math.min(L.length, R.length);
  if (n === 0 || !Number.isFinite(targetDbTp)) return 1;

  const meter = new Annex2TruePeakMeter();
  let peak = 0;
  for (let start = 0; start < n; start += 512) {
    const end = Math.min(n, start + 512);
    peak = Math.max(peak, meter.process(L.subarray(start, end), R.subarray(start, end), end - start));
  }
  peak = Math.max(peak, meter.flush());
  if (!(peak > 0) || !Number.isFinite(peak)) return 1;

  const gain = Math.pow(10, (targetDbTp - safeDb(peak)) / 20);
  for (let i = 0; i < n; i++) {
    L[i] *= gain;
    R[i] *= gain;
  }
  return gain;
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
  if (end - start < sampleRate * MOMENTARY_SECONDS) return { lufs: -Infinity, crestDb: 0 };
  const report = analyzeLoudness(L.subarray(start, end), R.subarray(start, end), sampleRate);
  return { lufs: report.integratedLufs, crestDb: report.crestDb };
}
