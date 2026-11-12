import { FFT, hannWindow } from '../dsp/fft';
import { clamp, median } from '../dsp/util';

export interface SectionBoundary {
  start: number;
  end: number;
}

export interface RhythmReport {
  tempoBpm: number;
  beatConfidence: number;
  /** Alternative metrical interpretations when the pulse has a strong half/double-time alias. */
  tempoCandidatesBpm?: number[];
  /** Robust range of local tempo estimates when the track contains measurable tempo changes. */
  tempoRangeBpm?: { min: number; max: number } | null;
  /** Fraction of grouped transient strength that aligns with the estimated beat grid. */
  beatGridConfidence?: number;
  /** Fraction of grouped transient strength away from the estimated beat grid. */
  offBeatRatio?: number;
  /** Transient events per second after collapsing closely spaced FFT peaks. */
  groupedOnsetDensity?: number;
  onsetDensity: number;
  punchScore: number;
  attackSharpness: number;
  sections: SectionBoundary[];
}

export interface AnalyzeRhythmOptions {
  /** Skip nested structural segmentation when measuring an already-selected section. */
  includeSections?: boolean;
  /** Reports phase name and a monotonically increasing fraction from 0 to 1. */
  onProgress?: (stage: string, fraction: number) => void;
}

interface FeatureFrame {
  time: number;
  energy: number;
  bands: number[];
}

/**
 * Tempo, onset density and section estimation.
 *
 * Tempo comes from autocorrelation of a band-balanced, adaptively thresholded
 * spectral-flux onset envelope. Sections come from a self-similarity novelty
 * curve over 0.5 s feature frames (band energy + loudness) and are deliberately
 * labelled as estimates in the UI.
 */
export function analyzeRhythm(
  L: Float32Array,
  R: Float32Array,
  sampleRate: number,
  options: AnalyzeRhythmOptions = {},
): RhythmReport {
  const n = Math.min(L.length, R.length);
  const duration = n / sampleRate;
  if (n < sampleRate) {
    options.onProgress?.('Detecting tempo and sections', 1);
    return {
      tempoBpm: 0,
      beatConfidence: 0,
      tempoCandidatesBpm: [],
      tempoRangeBpm: null,
      beatGridConfidence: 0,
      offBeatRatio: 0,
      groupedOnsetDensity: 0,
      onsetDensity: 0,
      punchScore: 0,
      attackSharpness: 0,
      sections: options.includeSections === false ? [] : [{ start: 0, end: duration }],
    };
  }

  const fftSize = 1024;
  const hop = 512;
  const fft = new FFT(fftSize);
  const window = hannWindow(fftSize);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const prevMag = new Float64Array(fftSize / 2 + 1);
  const frequencyBands = [
    { low: 30, high: 150 },
    { low: 150, high: 500 },
    { low: 500, high: 1_800 },
    { low: 1_800, high: 6_000 },
    { low: 6_000, high: Number.POSITIVE_INFINITY },
  ];
  const bandForBin = new Int8Array(fftSize / 2 + 1);
  bandForBin.fill(-1);
  for (let k = 1; k <= fftSize / 2; k++) {
    const frequency = (k * sampleRate) / fftSize;
    const band = frequencyBands.findIndex((range) => frequency >= range.low && frequency < range.high);
    if (band >= 0) bandForBin[k] = band;
  }
  const bandFlux = new Float64Array(frequencyBands.length);
  const bandMagnitude = new Float64Array(frequencyBands.length);
  const flux: number[] = [];
  let meanEnergy = 0;
  let frames = 0;
  const totalFrames = Math.max(0, Math.floor((n - fftSize) / hop) + 1);

  for (let start = 0; start + fftSize <= n; start += hop) {
    for (let i = 0; i < fftSize; i++) {
      re[i] = ((L[start + i] + R[start + i]) * 0.5) * window[i];
      im[i] = 0;
    }
    fft.forward(re, im);
    bandFlux.fill(0);
    bandMagnitude.fill(0);
    let totalMagnitude = 0;
    for (let k = 1; k <= fftSize / 2; k++) {
      const mag = Math.hypot(re[k], im[k]);
      const diff = mag - prevMag[k];
      const band = bandForBin[k];
      if (band >= 0) {
        bandMagnitude[band] += mag;
        if (diff > 0) bandFlux[band] += diff;
      }
      totalMagnitude += mag;
      prevMag[k] = mag;
    }
    const f = combineBandFlux(bandFlux, bandMagnitude, totalMagnitude);
    flux.push(f);
    meanEnergy += f;
    frames++;
    if ((frames & 0x3f) === 0 || frames === totalFrames) {
      options.onProgress?.('Detecting onsets', 0.55 * (frames / Math.max(1, totalFrames)));
    }
  }
  const fluxMean = meanEnergy / Math.max(1, frames);
  const fluxNorm = flux.map((v) => v / Math.max(1e-9, fluxMean));
  const onset = adaptiveOnsetEnvelope(
    fluxNorm,
    Math.max(4, Math.round((sampleRate / hop) * 0.13)),
    (fraction) => options.onProgress?.('Detecting onsets', Math.min(0.58, 0.55 + fraction * 0.03)),
  );
  options.onProgress?.('Preparing onset envelope', 0.58);

  const frameRate = sampleRate / hop;
  // Keep a raw peak count for compatibility, but create a second event stream
  // that collapses very close FFT peaks from one transient into one event.
  const onsetThreshold = 0.06;
  let onsetCount = 0;
  for (let i = 1; i < onset.length - 1; i++) {
    if (onset[i] > onsetThreshold && onset[i] > onset[i - 1] && onset[i] >= onset[i + 1]) onsetCount++;
  }
  const onsetDensity = onsetCount / Math.max(1, duration);
  const attackSharpness = clamp(
    onset.filter((v) => v > onsetThreshold).reduce((a, b) => a + b, 0) / Math.max(1, onsetCount) / 4,
    0,
    1,
  );
  options.onProgress?.('Grouping transients', 0.59);
  const onsetEvents = groupOnsetEvents(onset, frameRate, onsetThreshold);
  const groupedEnvelope = new Array<number>(onset.length).fill(0);
  for (const event of onsetEvents) groupedEnvelope[event.frame] = event.strength;
  const groupedOnsetDensity = onsetEvents.length / Math.max(1, duration);

  options.onProgress?.('Estimating tempo', 0.6);
  const tempo = estimateTempo(
    groupedEnvelope,
    frameRate,
    (fraction) => options.onProgress?.('Estimating tempo', 0.6 + fraction * 0.22),
  );
  const { tempoBpm, confidence } = tempo;
  const grid = scoreBeatGrid(onsetEvents, tempoBpm, frameRate);
  options.onProgress?.('Scoring attacks', 0.83);

  const segments = options.includeSections === false
    ? []
    : estimateSections(
        L,
        R,
        sampleRate,
        duration,
        (fraction) => options.onProgress?.('Detecting song sections', 0.84 + fraction * 0.16),
      );
  options.onProgress?.('Detecting tempo and sections', 1);
  return {
    tempoBpm,
    beatConfidence: confidence,
    tempoCandidatesBpm: tempo.candidatesBpm,
    tempoRangeBpm: tempo.rangeBpm,
    beatGridConfidence: grid.confidence,
    offBeatRatio: grid.offBeatRatio,
    groupedOnsetDensity,
    onsetDensity,
    punchScore: clamp(attackSharpness * 0.7 + clamp(onsetDensity / 3, 0, 1) * 0.3, 0, 1),
    attackSharpness,
    sections: segments,
  };
}


/**
 * Combine positive spectral changes after normalising each frequency band by
 * its own energy. This prevents a loud bass or midrange element from masking
 * quieter attacks in another band, while excluding effectively silent bands.
 */
export function combineBandFlux(
  bandFlux: ArrayLike<number>,
  bandMagnitude: ArrayLike<number>,
  totalMagnitude: number,
): number {
  if (!Number.isFinite(totalMagnitude) || totalMagnitude <= 1e-12) return 0;
  const activeFloor = Math.max(1e-12, totalMagnitude * 0.00025);
  const scaleFloor = Math.max(1e-12, totalMagnitude * 0.001);
  let score = 0;
  let activeBands = 0;
  const count = Math.min(bandFlux.length, bandMagnitude.length);
  for (let i = 0; i < count; i++) {
    const energy = bandMagnitude[i];
    if (!Number.isFinite(energy) || energy <= activeFloor) continue;
    const relativeFlux = Math.max(0, bandFlux[i]) / Math.max(energy, scaleFloor);
    score += clamp(relativeFlux, 0, 2);
    activeBands++;
  }
  return activeBands ? score / activeBands : 0;
}

/**
 * Subtract a local median background and a robust MAD-derived noise margin.
 * The ~260 ms default-scale window follows slow level changes but does not
 * require attacks to fall on a beat grid; isolated syncopated transients remain
 * prominent even when their absolute level is lower than neighbouring hits.
 */
export function adaptiveOnsetEnvelope(
  flux: number[],
  radiusFrames = 12,
  onProgress?: (fraction: number) => void,
): number[] {
  const radius = Math.max(1, Math.round(radiusFrames));
  const onset = new Array<number>(flux.length).fill(0);
  for (let i = 0; i < flux.length; i++) {
    const from = Math.max(0, i - radius);
    const to = Math.min(flux.length, i + radius + 1);
    const local = flux.slice(from, to);
    const baseline = median(local);
    const deviations = local.map((value) => Math.abs(value - baseline));
    const mad = median(deviations) * 1.4826;
    const margin = Math.max(0.025, mad * 1.5);
    onset[i] = Math.max(0, flux[i] - baseline - margin);
    if (onProgress && ((i & 0x1ff) === 0 || i === flux.length - 1)) {
      onProgress((i + 1) / Math.max(1, flux.length));
    }
  }
  if (!flux.length) onProgress?.(1);
  return onset;
}


export interface OnsetEvent {
  /** Frame index of the strongest peak in the grouped transient. */
  frame: number;
  /** Normalized peak strength used for energy-weighted beat-grid scoring. */
  strength: number;
}

/**
 * Collapse nearby local maxima into one transient event. The short refractory
 * interval removes FFT-window ringing and double-counted attacks without
 * merging ordinary sixteenth-note and syncopated hits at common tempos.
 */
export function groupOnsetEvents(
  onset: number[],
  frameRate: number,
  threshold = 0.06,
  refractoryMs = 45,
): OnsetEvent[] {
  const minimumGap = Math.max(1, Math.round((Math.max(1, frameRate) * refractoryMs) / 1000));
  const events: OnsetEvent[] = [];
  for (let i = 1; i < onset.length - 1; i++) {
    const strength = onset[i];
    if (!(strength > threshold && strength > onset[i - 1] && strength >= onset[i + 1])) continue;
    const previous = events[events.length - 1];
    if (previous && i - previous.frame <= minimumGap) {
      if (strength > previous.strength) {
        previous.frame = i;
        previous.strength = strength;
      }
    } else {
      events.push({ frame: i, strength });
    }
  }
  return events;
}

export interface BeatGridScore {
  confidence: number;
  offBeatRatio: number;
  phaseFrames: number | null;
}

/**
 * Find the strongest phase for the measured BPM and calculate the weighted
 * share of transient energy close to that beat grid. Off-grid energy is kept
 * explicit because it may be syncopation, subdivisions, or ornamentation—not
 * automatically classified as an error.
 */
export function scoreBeatGrid(
  events: OnsetEvent[],
  tempoBpm: number,
  frameRate: number,
): BeatGridScore {
  if (events.length < 4 || !(tempoBpm > 0) || !(frameRate > 0)) {
    return { confidence: 0, offBeatRatio: 0, phaseFrames: null };
  }
  const periodFrames = (60 * frameRate) / tempoBpm;
  if (!Number.isFinite(periodFrames) || periodFrames < 2) {
    return { confidence: 0, offBeatRatio: 0, phaseFrames: null };
  }
  const totalStrength = events.reduce((sum, event) => sum + Math.max(0, event.strength), 0);
  if (!(totalStrength > 0)) {
    return { confidence: 0, offBeatRatio: 0, phaseFrames: null };
  }

  const tolerance = Math.max(1, periodFrames * 0.18);
  const phaseSteps = Math.max(12, Math.min(256, Math.ceil(periodFrames)));
  let bestScore = -1;
  let bestPhase = 0;
  for (let step = 0; step < phaseSteps; step++) {
    const phase = (step / phaseSteps) * periodFrames;
    let score = 0;
    for (const event of events) {
      const relative = ((event.frame - phase) % periodFrames + periodFrames) % periodFrames;
      const distance = Math.min(relative, periodFrames - relative);
      const alignment = Math.max(0, 1 - distance / tolerance);
      score += Math.max(0, event.strength) * alignment;
    }
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }

  const confidence = clamp(bestScore / totalStrength, 0, 1);
  return {
    confidence,
    offBeatRatio: clamp(1 - confidence, 0, 1),
    phaseFrames: bestPhase,
  };
}

interface TempoWindowEstimate {
  tempoBpm: number;
  confidence: number;
  candidatesBpm: number[];
}

/**
 * Estimate a track-level pulse while retaining plausible half/double-time
 * interpretations. For tracks long enough to support it, also measure
 * non-overlapping local windows and report their robust tempo range.
 */
export function estimateTempo(
  onset: number[],
  frameRate: number,
  onProgress?: (fraction: number) => void,
): {
  tempoBpm: number;
  confidence: number;
  candidatesBpm: number[];
  rangeBpm: { min: number; max: number } | null;
} {
  const global = estimateTempoWindow(onset, frameRate, (fraction) => onProgress?.(fraction * 0.55));
  if (!global.tempoBpm || onset.length < Math.round(frameRate * 16)) {
    onProgress?.(1);
    return {
      ...global,
      rangeBpm: null,
    };
  }

  // Eight-second windows provide enough beat cycles to distinguish common
  // tempos while still following arrangement-level tempo changes.
  const windowFrames = Math.max(1, Math.round(frameRate * 8));
  const starts: number[] = [];
  for (let start = 0; start + windowFrames <= onset.length; start += windowFrames) {
    starts.push(start);
  }
  const finalStart = onset.length - windowFrames;
  if (
    starts.length &&
    finalStart - starts[starts.length - 1] >= Math.round(windowFrames * 0.5)
  ) {
    starts.push(finalStart);
  }

  const local: TempoWindowEstimate[] = [];
  for (let i = 0; i < starts.length; i++) {
    const estimate = estimateTempoWindow(
      onset.slice(starts[i], starts[i] + windowFrames),
      frameRate,
    );
    // Very weak windows are often breakdowns, fades, or sparse material.
    // Excluding them prevents silence from pulling the reported tempo down.
    if (estimate.tempoBpm > 0 && estimate.confidence >= 0.08) local.push(estimate);
    onProgress?.(0.55 + 0.4 * ((i + 1) / Math.max(1, starts.length)));
  }

  if (local.length < 2) {
    onProgress?.(1);
    return { ...global, rangeBpm: null };
  }

  const localTempos = local.map((item) => item.tempoBpm).sort((a, b) => a - b);
  const localConfidences = local.map((item) => item.confidence);
  const localMedian = median(localTempos);
  const minTempo = localTempos[0];
  const maxTempo = localTempos[localTempos.length - 1];
  const spread = maxTempo - minTempo;
  const rangeBpm = spread >= 5
    ? { min: roundTempo(minTempo), max: roundTempo(maxTempo) }
    : null;

  // A median is less sensitive than a whole-song autocorrelation peak to a
  // dominant section masking a meaningful tempo change elsewhere in the song.
  const dispersion = median(localTempos.map((value) => Math.abs(value - localMedian)));
  const stability = clamp(1 - dispersion / Math.max(1, localMedian * 0.12), 0, 1);
  const confidence = clamp(
    median(localConfidences) * (0.75 + stability * 0.25),
    0,
    1,
  );

  onProgress?.(1);
  return {
    tempoBpm: roundTempo(localMedian),
    confidence,
    candidatesBpm: global.candidatesBpm,
    rangeBpm,
  };
}

function estimateTempoWindow(
  onset: number[],
  frameRate: number,
  onProgress?: (fraction: number) => void,
): TempoWindowEstimate {
  let mean = 0;
  for (const value of onset) mean += value;
  mean /= Math.max(1, onset.length);

  const centered = new Float64Array(onset.length);
  for (let i = 0; i < onset.length; i++) centered[i] = onset[i] - mean;

  const minBpm = 40;
  const maxBpm = 210;
  const minLag = Math.max(2, Math.round((60 / maxBpm) * frameRate));
  const maxLag = Math.min(centered.length - 1, Math.round((60 / minBpm) * frameRate));
  if (maxLag < minLag) {
    onProgress?.(1);
    return { tempoBpm: 0, confidence: 0, candidatesBpm: [] };
  }

  const scores = new Float64Array(maxLag + 1);
  let bestLag = 0;
  let bestScore = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  const lagCount = Math.max(1, maxLag - minLag + 1);

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let energyA = 0;
    let energyB = 0;
    for (let i = 0; i + lag < centered.length; i++) {
      const a = centered[i];
      const b = centered[i + lag];
      sum += a * b;
      energyA += a * a;
      energyB += b * b;
    }
    const denominator = Math.sqrt(energyA * energyB);
    const score = denominator > 1e-18 ? sum / denominator : 0;
    scores[lag] = score;
    scoreSum += Math.abs(score);
    scoreCount++;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
    if (onProgress && (((lag - minLag) & 0x07) === 0 || lag === maxLag)) {
      onProgress((lag - minLag + 1) / lagCount);
    }
  }

  const average = scoreCount ? scoreSum / scoreCount : 0;
  let confidence = average > 0 ? clamp(bestScore / (average * 4), 0, 1) : 0;
  if (!bestLag || bestScore <= 0) {
    return { tempoBpm: 0, confidence, candidatesBpm: [] };
  }

  const rawBpm = (60 * frameRate) / bestLag;
  // Preserve the measured pulse even below 70 BPM; low-tempo music should
  // not be silently relabelled as double-time without supporting evidence.
  const tempoBpm = roundTempo(rawBpm);
  const candidatesBpm = [tempoBpm];
  // The autocorrelation at one beat interval and at two beat intervals can
  // both be strong. Keep the second interpretation only when its own peak
  // has substantial support; do not present every mathematical subdivision.
  for (const candidate of [rawBpm / 2, rawBpm * 2]) {
    if (candidate < minBpm || candidate > maxBpm) continue;
    const lag = Math.round((60 * frameRate) / candidate);
    if (lag < minLag || lag > maxLag) continue;
    if (scores[lag] < bestScore * 0.68) continue;
    const rounded = roundTempo(candidate);
    if (!candidatesBpm.some((value) => Math.abs(value - rounded) < 1)) {
      candidatesBpm.push(rounded);
    }
  }
  if (candidatesBpm.length > 1) confidence *= 0.82;

  return { tempoBpm, confidence, candidatesBpm };
}


function roundTempo(value: number): number {
  return Math.round(value * 10) / 10;
}

function estimateSections(
  L: Float32Array,
  R: Float32Array,
  sampleRate: number,
  duration: number,
  onProgress?: (fraction: number) => void,
): SectionBoundary[] {
  const frameHop = Math.round(sampleRate * 0.5);
  const fftSize = 2048;
  const fft = new FFT(fftSize);
  const window = hannWindow(fftSize);
  const frames: FeatureFrame[] = [];
  const bands = [40, 80, 160, 320, 640, 1250, 2500, 5000, 8000, 12000];
  const sixthOctave = Math.pow(2, 1 / 6);
  const bandRanges = bands.map((center) => ({
    low: Math.floor((center / sixthOctave * fftSize) / sampleRate),
    high: Math.ceil((center * sixthOctave * fftSize) / sampleRate),
  }));
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const totalFrames = Math.max(0, Math.floor((L.length - fftSize) / frameHop) + 1);

  for (let start = 0; start + fftSize <= L.length; start += frameHop) {
    let energy = 0;
    for (let i = 0; i < fftSize; i++) {
      const x = (L[start + i] + R[start + i]) * 0.5;
      energy += x * x;
      re[i] = x * window[i];
      im[i] = 0;
    }
    fft.forward(re, im);
    const bandValues: number[] = [];
    for (const range of bandRanges) {
      let sum = 0;
      for (let k = Math.max(1, range.low); k <= Math.min(fftSize / 2, range.high); k++) {
        sum += re[k] * re[k] + im[k] * im[k];
      }
      bandValues.push(Math.log10(Math.max(sum, 1e-12)));
    }
    frames.push({ time: start / sampleRate, energy: Math.sqrt(energy / fftSize), bands: bandValues });
    if ((frames.length & 0x0f) === 0 || frames.length === totalFrames) {
      onProgress?.(0.55 * (frames.length / Math.max(1, totalFrames)));
    }
  }

  if (frames.length < 8) {
    onProgress?.(1);
    return [{ start: 0, end: duration }];
  }
  onProgress?.(0.56);

  // Normalise features so distance is not dominated by loudness alone.
  const meanBand = new Array(bands.length).fill(0);
  for (const f of frames) for (let i = 0; i < bands.length; i++) meanBand[i] += f.bands[i];
  for (let i = 0; i < bands.length; i++) meanBand[i] /= frames.length;
  const energyMean = frames.reduce((a, f) => a + f.energy, 0) / frames.length;

  const vectors = frames.map((f) => [
    ...f.bands.map((v, i) => (v - meanBand[i]) * 2),
    (f.energy - energyMean) * 4,
  ]);

  const context = 8; // 4 seconds each side
  const novelty: number[] = [];
  for (let i = 0; i < vectors.length; i++) {
    if (i < context || i >= vectors.length - context) {
      novelty.push(0);
    } else {
    let distance = 0;
    for (let d = 0; d < vectors[i].length; d++) {
      let left = 0;
      let right = 0;
      for (let k = 1; k <= context; k++) {
        left += vectors[i - k][d];
        right += vectors[i + k][d];
      }
      left /= context;
      right /= context;
      distance += (left - right) * (left - right);
    }
      novelty.push(distance);
    }
    if ((i & 0x3f) === 0 || i === vectors.length - 1) {
      onProgress?.(0.56 + 0.34 * ((i + 1) / Math.max(1, vectors.length)));
    }
  }

  const noveltyMean = novelty.reduce((a, b) => a + b, 0) / novelty.length;
  const threshold = noveltyMean * 1.6 + 1e-6;
  const boundaries: number[] = [0];
  const minSectionFrames = Math.round(12 / 0.5); // 12 s minimum section
  let lastBoundary = -minSectionFrames;
  for (let i = 2; i < novelty.length - 2; i++) {
    if (
      novelty[i] > threshold &&
      novelty[i] >= novelty[i - 1] &&
      novelty[i] >= novelty[i + 1] &&
      i - lastBoundary >= minSectionFrames
    ) {
      boundaries.push(frames[i].time);
      lastBoundary = i;
    }
  }
  boundaries.push(duration);
  onProgress?.(0.92);
  if (boundaries.length > 13) {
    // Keep the strongest boundaries plus start/end.
    const ranked = novelty
      .map((v, i) => ({ v, i }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 10)
      .map((x) => frames[x.i].time)
      .sort((a, b) => a - b);
    const result = [{ start: 0, end: ranked[0] ?? duration }, ...ranked.map((t, i) => ({ start: t, end: ranked[i + 1] ?? duration }))];
    onProgress?.(1);
    return result;
  }
  const sections: SectionBoundary[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    sections.push({ start: boundaries[i], end: boundaries[i + 1] });
  }
  onProgress?.(1);
  return sections;
}

export function labelSections(sections: { start: number; end: number; lufs: number }[]): string[] {
  if (!sections.length) return [];
  const labels = sections.map(() => 'section');
  const sorted = [...sections].map((s, i) => ({ ...s, i })).sort((a, b) => b.lufs - a.lufs);
  if (sorted.length) {
    labels[sorted[0].i] = 'chorus';
    const quietest = sorted[sorted.length - 1];
    if (quietest.i !== sorted[0].i) labels[quietest.i] = 'verse';
  }
  if (sections.length > 2) {
    if (sections[0].lufs < (sorted[0]?.lufs ?? 0) - 2) labels[0] = 'intro';
    const last = sections.length - 1;
    if (sections[last].lufs < (sorted[0]?.lufs ?? 0) - 1.5) labels[last] = 'outro';
  }
  for (let i = 1; i < sections.length - 1; i++) {
    if (labels[i] === 'section') labels[i] = 'verse';
  }
  return labels;
}
