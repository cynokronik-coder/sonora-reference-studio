import { Annex2TruePeakMeter } from '../dsp/oversample';
import { analyzeLoudnessStreaming, analyzeLoudnessStreamingAsync, type AsyncStreamingLoudnessOptions } from './loudness-stream';

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

const MOMENTARY_SECONDS = 0.4;
const safeDb = (value: number): number => value > 0 ? 20 * Math.log10(value) : -Infinity;

/**
 * ITU-R BS.1770-5 / EBU Tech 3341/3342 loudness measurement.
 * The rolling-window implementation retains only 400 ms and 3 s energy rings
 * instead of allocating full-programme K-weighted left/right PCM buffers.
 */
export function analyzeLoudness(
  L: Float32Array,
  R: Float32Array,
  sampleRate: number,
  onProgress?: (fraction: number) => void,
): LoudnessReport {
  return analyzeLoudnessStreaming(L, R, sampleRate, { onProgress });
}

export type LoudnessSummary = Pick<
  LoudnessReport,
  | 'integratedLufs'
  | 'momentaryMaxLufs'
  | 'shortTermMaxLufs'
  | 'lra'
  | 'truePeakDb'
  | 'samplePeakDb'
  | 'rmsDb'
  | 'crestDb'
  | 'plrDb'
  | 'dynamicRangeDb'
>;

/**
 * Scalar-only loudness measurement for section summaries and callers that
 * don't display time-series curves. Avoids allocating momentary/short-term
 * point objects while preserving the same BS.1770/EBU measurement values.
 */
export function analyzeLoudnessSummary(
  L: Float32Array,
  R: Float32Array,
  sampleRate: number,
  onProgress?: (fraction: number) => void,
): LoudnessSummary {
  const report = analyzeLoudnessStreaming(L, R, sampleRate, {
    onProgress,
    includeTimeSeries: false,
  });
  return {
    integratedLufs: report.integratedLufs,
    momentaryMaxLufs: report.momentaryMaxLufs,
    shortTermMaxLufs: report.shortTermMaxLufs,
    lra: report.lra,
    truePeakDb: report.truePeakDb,
    samplePeakDb: report.samplePeakDb,
    rmsDb: report.rmsDb,
    crestDb: report.crestDb,
    plrDb: report.plrDb,
    dynamicRangeDb: report.dynamicRangeDb,
  };
}

export interface LoudnessAnalysisOptions extends AsyncStreamingLoudnessOptions {}

/** Cooperative, cancellable loudness analysis for long export and verification jobs. */
export function analyzeLoudnessAsync(
  L: Float32Array,
  R: Float32Array,
  sampleRate: number,
  options: LoudnessAnalysisOptions = {},
): Promise<LoudnessReport> {
  return analyzeLoudnessStreamingAsync(L, R, sampleRate, options);
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


export interface AsyncNormalizationOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

/**
 * Cooperative counterpart to normalizeToTruePeak for long export programmes.
 * The Annex 2 meter keeps its FIR history across bounded 512-frame blocks;
 * gain is then applied in-place in 16,384-frame blocks. No programme-sized
 * temporary PCM arrays are allocated.
 */
export async function normalizeToTruePeakAsync(
  L: Float32Array,
  R: Float32Array,
  targetDbTp: number,
  options: AsyncNormalizationOptions = {},
): Promise<number> {
  const n = Math.min(L.length, R.length);
  const checkAbort = () => {
    if (!options.signal?.aborted) return;
    const error = new Error('True-peak normalization cancelled.');
    error.name = 'AbortError';
    throw error;
  };
  const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  if (n === 0 || !Number.isFinite(targetDbTp)) return 1;

  const meter = new Annex2TruePeakMeter();
  let peak = 0;
  const meterBlock = 512;
  const yieldEveryFrames = 16_384;
  for (let start = 0; start < n; start += meterBlock) {
    checkAbort();
    const end = Math.min(n, start + meterBlock);
    peak = Math.max(peak, meter.process(L.subarray(start, end), R.subarray(start, end), end - start));
    if (end % yieldEveryFrames === 0 || end === n) {
      options.onProgress?.(0.5 * (end / n));
      if (end < n) await yieldToEventLoop();
    }
  }
  peak = Math.max(peak, meter.flush());
  checkAbort();
  if (!(peak > 0) || !Number.isFinite(peak)) {
    options.onProgress?.(1);
    return 1;
  }

  const gain = Math.pow(10, (targetDbTp - safeDb(peak)) / 20);
  const applyBlock = 16_384;
  for (let start = 0; start < n; start += applyBlock) {
    checkAbort();
    const end = Math.min(n, start + applyBlock);
    for (let i = start; i < end; i++) {
      L[i] *= gain;
      R[i] *= gain;
    }
    options.onProgress?.(0.5 + 0.5 * (end / n));
    if (end < n) await yieldToEventLoop();
  }
  checkAbort();
  options.onProgress?.(1);
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
