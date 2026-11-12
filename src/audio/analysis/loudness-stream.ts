import { Biquad } from '../dsp/biquad';
import { Annex2TruePeakMeter } from '../dsp/oversample';
import type { LoudnessPoint, LoudnessReport } from './loudness';

const ABSOLUTE_GATE_LUFS = -70;
const INTEGRATED_RELATIVE_GATE_LU = -10;
const LRA_RELATIVE_GATE_LU = -20;
const MOMENTARY_SECONDS = 0.4;
const SHORT_TERM_SECONDS = 3;
const SHORT_TERM_FLUSH_SECONDS = 1.5;
const ANALYSIS_HOP_SECONDS = 0.1;
const DEFAULT_BLOCK_FRAMES = 16_384;
const TRUE_PEAK_BLOCK_FRAMES = 512;

const safeDb = (value: number): number => value > 0 ? 20 * Math.log10(value) : -Infinity;
const finiteDifference = (a: number, b: number): number =>
  Number.isFinite(a) && Number.isFinite(b) ? a - b : 0;

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

function downsampleSeries(points: LoudnessPoint[], maxPoints: number): LoudnessPoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out: LoudnessPoint[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  return out;
}

function loudnessOfPower(power: number): number {
  return power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity;
}

function makeKWeighting(sampleRate: number) {
  const shelf = new Biquad();
  shelf.configure('highshelf', 1681.974450955533, 3.999843853973347, 0.7071752369554196, sampleRate);
  const rlb = new Biquad();
  rlb.configure('highpass', 38.13547087602444, 0, 0.5003270373238773, sampleRate);
  return { shelf, rlb };
}

/**
 * Stateful BS.1770/EBU accumulator. Only the 400 ms and 3 s energy windows
 * are retained; filtered programme-sized L/R buffers are never allocated.
 */
export class StreamingLoudnessAnalyzer {
  private readonly sampleRate: number;
  private readonly momentarySize: number;
  private readonly shortTermSize: number;
  private readonly momentaryHop: number;
  private readonly shortTermHop: number;
  private readonly flushSamples: number;
  private readonly leftWeighting: ReturnType<typeof makeKWeighting>;
  private readonly rightWeighting: ReturnType<typeof makeKWeighting>;
  private readonly momentaryRing: Float64Array;
  private readonly shortTermRing: Float64Array;
  private readonly blockPowers: number[] = [];
  private readonly shortTermValues: number[] = [];
  private readonly truePeakMeter = new Annex2TruePeakMeter();
  private count = 0;
  private momentarySum = 0;
  private shortTermSum = 0;
  private samplePeak = 0;
  private sumSquares = 0;
  private truePeak = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.momentarySize = Math.max(1, Math.round(sampleRate * MOMENTARY_SECONDS));
    this.shortTermSize = Math.max(1, Math.round(sampleRate * SHORT_TERM_SECONDS));
    this.momentaryHop = Math.max(1, Math.round(sampleRate * ANALYSIS_HOP_SECONDS));
    this.shortTermHop = Math.max(1, Math.round(sampleRate * ANALYSIS_HOP_SECONDS));
    this.flushSamples = Math.round(sampleRate * SHORT_TERM_FLUSH_SECONDS);
    this.leftWeighting = makeKWeighting(sampleRate);
    this.rightWeighting = makeKWeighting(sampleRate);
    this.momentaryRing = new Float64Array(this.momentarySize);
    this.shortTermRing = new Float64Array(this.shortTermSize);
  }

  get framesProcessed(): number {
    return this.count;
  }

  /** Process a contiguous input range while preserving filter and window state. */
  process(L: Float32Array, R: Float32Array, start: number, end: number): void {
    const safeEnd = Math.min(end, L.length, R.length);
    for (let i = start; i < safeEnd; i++) {
      const left = L[i];
      const right = R[i];
      const weightedL = Math.fround(this.leftWeighting.rlb.process(this.leftWeighting.shelf.process(left)));
      const weightedR = Math.fround(this.rightWeighting.rlb.process(this.rightWeighting.shelf.process(right)));
      const power = weightedL * weightedL + weightedR * weightedR;

      const momentarySlot = this.count % this.momentarySize;
      if (this.count >= this.momentarySize) this.momentarySum -= this.momentaryRing[momentarySlot];
      this.momentaryRing[momentarySlot] = power;
      this.momentarySum += power;

      const shortTermSlot = this.count % this.shortTermSize;
      if (this.count >= this.shortTermSize) this.shortTermSum -= this.shortTermRing[shortTermSlot];
      this.shortTermRing[shortTermSlot] = power;
      this.shortTermSum += power;

      const nextCount = this.count + 1;
      if (nextCount >= this.momentarySize) {
        const windowStart = nextCount - this.momentarySize;
        if (windowStart % this.momentaryHop === 0) {
          this.blockPowers.push(Math.max(0, this.momentarySum) / this.momentarySize);
        }
      }

      if (nextCount >= this.shortTermSize) {
        const windowStart = nextCount - this.shortTermSize;
        if (windowStart % this.shortTermHop === 0) {
          this.shortTermValues.push(loudnessOfPower(Math.max(0, this.shortTermSum) / this.shortTermSize));
        }
      }

      this.samplePeak = Math.max(this.samplePeak, Math.abs(left), Math.abs(right));
      this.sumSquares += left * left + right * right;
      this.count = nextCount;
    }

    // The FIR meter retains its history between these bounded calls, including
    // when a programme is split into cooperative event-loop work blocks.
    for (let offset = start; offset < safeEnd; offset += TRUE_PEAK_BLOCK_FRAMES) {
      const blockEnd = Math.min(safeEnd, offset + TRUE_PEAK_BLOCK_FRAMES);
      this.truePeak = Math.max(
        this.truePeak,
        this.truePeakMeter.process(L.subarray(offset, blockEnd), R.subarray(offset, blockEnd), blockEnd - offset),
      );
    }
  }

  finish(includeTimeSeries = true): LoudnessReport {
    const n = this.count;
    if (n === 0) return emptyReport();

    // File-based EBU LRA includes 1.5 s of trailing silence. Build only the
    // remaining partial windows from the retained 3 s rolling energy ring.
    if (n + this.flushSamples >= this.shortTermSize) {
      const lastFullStart = n >= this.shortTermSize
        ? Math.floor((n - this.shortTermSize) / this.shortTermHop) * this.shortTermHop
        : -this.shortTermHop;
      let start = lastFullStart + this.shortTermHop;
      if (start < n && start + this.shortTermSize <= n + this.flushSamples) {
        let tailPower = 0;
        for (let i = start; i < n; i++) tailPower += this.shortTermRing[i % this.shortTermSize];

        while (start < n && start + this.shortTermSize <= n + this.flushSamples) {
          this.shortTermValues.push(loudnessOfPower(Math.max(0, tailPower) / this.shortTermSize));
          const nextStart = start + this.shortTermHop;
          for (let i = start; i < Math.min(nextStart, n); i++) {
            tailPower -= this.shortTermRing[i % this.shortTermSize];
          }
          start = nextStart;
        }
      }
    }

    this.truePeak = Math.max(this.truePeak, this.truePeakMeter.flush());
    const loudnessBlocks = this.blockPowers.map(loudnessOfPower);
    const absoluteGatedPowers = this.blockPowers.filter(
      (_, i) => loudnessBlocks[i] > ABSOLUTE_GATE_LUFS,
    );
    let integratedLufs = -Infinity;
    if (absoluteGatedPowers.length > 0) {
      const absoluteMeanPower = absoluteGatedPowers.reduce((sum, value) => sum + value, 0) / absoluteGatedPowers.length;
      const relativeGate = loudnessOfPower(absoluteMeanPower) + INTEGRATED_RELATIVE_GATE_LU;
      const gatedPowers = this.blockPowers.filter(
        (_, i) => loudnessBlocks[i] > ABSOLUTE_GATE_LUFS && loudnessBlocks[i] > relativeGate,
      );
      if (gatedPowers.length > 0) {
        const integratedPower = gatedPowers.reduce((sum, value) => sum + value, 0) / gatedPowers.length;
        integratedLufs = loudnessOfPower(integratedPower);
      }
    }

    let momentaryMaxLufs = -Infinity;
    for (const value of loudnessBlocks) momentaryMaxLufs = Math.max(momentaryMaxLufs, value);

    let shortTermMaxLufs = -Infinity;
    for (const value of this.shortTermValues) shortTermMaxLufs = Math.max(shortTermMaxLufs, value);

    const absoluteGatedShortTerm = this.shortTermValues
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

    const dynamicRangeDb = absoluteGatedShortTerm.length > 1
      ? ebuPercentile(absoluteGatedShortTerm, 0.95) - ebuPercentile(absoluteGatedShortTerm, 0.05)
      : 0;
    const shortTerm: LoudnessPoint[] = includeTimeSeries
      ? downsampleSeries(this.shortTermValues.map((lufs, index) => ({
          time: (index * this.shortTermHop) / this.sampleRate + SHORT_TERM_SECONDS * 0.5,
          lufs,
        })), 400)
      : [];
    const momentary: LoudnessPoint[] = includeTimeSeries
      ? downsampleSeries(loudnessBlocks.map((lufs, index) => ({
          time: (index * this.momentaryHop) / this.sampleRate + MOMENTARY_SECONDS * 0.5,
          lufs,
        })), 400)
      : [];

    const rms = Math.sqrt(this.sumSquares / (n * 2));
    const samplePeakDb = safeDb(this.samplePeak);
    const truePeakDb = safeDb(this.truePeak);
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
      shortTerm,
      momentary,
    };
  }
}

export interface StreamingLoudnessOptions {
  onProgress?: (fraction: number) => void;
  blockFrames?: number;
  /** Skip allocating display-only momentary/short-term point objects for scalar summaries. */
  includeTimeSeries?: boolean;
}

export interface AsyncStreamingLoudnessOptions extends StreamingLoudnessOptions {
  signal?: AbortSignal;
}

export function analyzeLoudnessStreaming(
  L: Float32Array,
  R: Float32Array,
  sampleRate: number,
  options: StreamingLoudnessOptions = {},
): LoudnessReport {
  const n = Math.min(L.length, R.length);
  if (n === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) return emptyReport();

  const blockFrames = Number.isFinite(options.blockFrames)
    ? Math.max(1, Math.floor(options.blockFrames as number))
    : DEFAULT_BLOCK_FRAMES;
  const analyzer = new StreamingLoudnessAnalyzer(sampleRate);
  for (let start = 0; start < n; start += blockFrames) {
    const end = Math.min(n, start + blockFrames);
    analyzer.process(L, R, start, end);
    options.onProgress?.(end / n);
  }
  return analyzer.finish(options.includeTimeSeries ?? true);
}

export async function analyzeLoudnessStreamingAsync(
  L: Float32Array,
  R: Float32Array,
  sampleRate: number,
  options: AsyncStreamingLoudnessOptions = {},
): Promise<LoudnessReport> {
  const n = Math.min(L.length, R.length);
  const checkAbort = () => {
    if (!options.signal?.aborted) return;
    const error = new Error('Loudness analysis cancelled.');
    error.name = 'AbortError';
    throw error;
  };
  const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  if (n === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) return emptyReport();

  const blockFrames = Number.isFinite(options.blockFrames)
    ? Math.max(1, Math.floor(options.blockFrames as number))
    : DEFAULT_BLOCK_FRAMES;
  const analyzer = new StreamingLoudnessAnalyzer(sampleRate);
  for (let start = 0; start < n; start += blockFrames) {
    checkAbort();
    const end = Math.min(n, start + blockFrames);
    analyzer.process(L, R, start, end);
    options.onProgress?.(end / n);
    if (end < n) await yieldToEventLoop();
  }
  checkAbort();
  const report = analyzer.finish(options.includeTimeSeries ?? true);
  options.onProgress?.(1);
  return report;
}
