import { FFT, hannWindow } from '../dsp/fft';
import { clamp, median } from '../dsp/util';

export interface SectionBoundary {
  start: number;
  end: number;
}

export interface RhythmReport {
  tempoBpm: number;
  beatConfidence: number;
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
 * Tempo comes from autocorrelation of a spectral-flux onset envelope, folded
 * into a musically plausible range. Sections come from a self-similarity
 * novelty curve over 0.5 s feature frames (band energy + loudness) and are
 * deliberately labelled as estimates in the UI.
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
    let f = 0;
    for (let k = 1; k <= fftSize / 2; k++) {
      const mag = Math.hypot(re[k], im[k]);
      const diff = mag - prevMag[k];
      if (diff > 0) f += diff;
      prevMag[k] = mag;
    }
    flux.push(f);
    meanEnergy += f;
    frames++;
    if ((frames & 0x3f) === 0 || frames === totalFrames) {
      options.onProgress?.('Detecting onsets', 0.55 * (frames / Math.max(1, totalFrames)));
    }
  }
  options.onProgress?.('Preparing onset envelope', 0.58);
  const fluxMean = meanEnergy / Math.max(1, frames);
  const fluxNorm = flux.map((v) => v / Math.max(1e-9, fluxMean));
  // Onset strength above the local average.
  const onset = fluxNorm.map((v, i) => {
    const from = Math.max(0, i - 8);
    const to = Math.min(fluxNorm.length, i + 8);
    let local = 0;
    for (let j = from; j < to; j++) local += fluxNorm[j];
    local /= to - from;
    return Math.max(0, v - local * 0.92);
  });

  const frameRate = sampleRate / hop;
  options.onProgress?.('Estimating tempo', 0.6);
  const { tempoBpm, confidence } = estimateTempo(
    onset,
    frameRate,
    (fraction) => options.onProgress?.('Estimating tempo', 0.6 + fraction * 0.22),
  );
  options.onProgress?.('Scoring attacks', 0.83);
  const onsetThreshold = Math.max(0.35, median(onset.filter((v) => v > 0.05)) * 1.6);
  let onsetCount = 0;
  for (let i = 1; i < onset.length - 1; i++) {
    if (onset[i] > onsetThreshold && onset[i] >= onset[i - 1] && onset[i] >= onset[i + 1]) onsetCount++;
  }
  const onsetDensity = onsetCount / Math.max(1, duration);
  const attackSharpness = clamp(
    onset.filter((v) => v > onsetThreshold).reduce((a, b) => a + b, 0) / Math.max(1, onsetCount) / 4,
    0,
    1,
  );

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
    onsetDensity,
    punchScore: clamp(attackSharpness * 0.7 + clamp(onsetDensity / 3, 0, 1) * 0.3, 0, 1),
    attackSharpness,
    sections: segments,
  };
}

function estimateTempo(
  onset: number[],
  frameRate: number,
  onProgress?: (fraction: number) => void,
): { tempoBpm: number; confidence: number } {
  let mean = 0;
  for (const v of onset) mean += v;
  mean /= Math.max(1, onset.length);
  const centered = onset.map((v) => v - mean);
  let bestLag = 0;
  let bestScore = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  const minBpm = 60;
  const maxBpm = 200;
  const minLag = Math.max(2, Math.round((60 / maxBpm) * frameRate));
  const maxLag = Math.min(centered.length - 1, Math.round((60 / minBpm) * frameRate));
  const lagCount = Math.max(1, maxLag - minLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < centered.length; i++) sum += centered[i] * centered[i + lag];
    const score = sum / Math.max(1, centered.length - lag);
    scoreSum += Math.abs(score);
    scoreCount++;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
    if (((lag - minLag) & 0x07) === 0 || lag === maxLag) {
      onProgress?.((lag - minLag + 1) / lagCount);
    }
  }
  const average = scoreCount ? scoreSum / scoreCount : 0;
  const confidence = average > 0 ? clamp(bestScore / (average * 4), 0, 1) : 0;
  if (!bestLag) return { tempoBpm: 0, confidence };
  let bpm = (60 * frameRate) / bestLag;
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return { tempoBpm: Math.round(bpm * 10) / 10, confidence };
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
