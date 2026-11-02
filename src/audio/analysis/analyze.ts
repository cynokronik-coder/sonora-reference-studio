import { analyzeLoudness, type LoudnessReport } from './loudness';
import {
  accumulateSpectrum,
  createSpectrumAccum,
  finalizeSpectrum,
  type BandLevel,
  type Resonance,
  type SpectrumReport,
} from './spectrum';
import { analyzeStereo, type StereoReport } from './stereo';
import { analyzeRhythm, labelSections, type RhythmReport } from './rhythm';
import type { SectionBoundary } from './rhythm';

export interface SectionReport {
  index: number;
  label: string;
  start: number;
  end: number;
  lufs: number;
  crestDb: number;
  widthDb: number;
  correlation: number;
  bands: BandLevel[];
  punchScore: number;
}

export interface AnalysisReport {
  version: 1;
  createdAt: number;
  sampleRate: number;
  channels: number;
  duration: number;
  loudness: LoudnessReport;
  spectrum: SpectrumReport;
  stereo: StereoReport;
  rhythm: RhythmReport;
  sections: SectionReport[];
  transients: {
    crestDb: number;
    plrDb: number;
    attackDensity: number;
    punchScore: number;
    maxShortTermLufs: number;
  };
  resonances: Resonance[];
  warnings: string[];
}

export interface AnalysisInput {
  assetId: string;
  L: Float32Array;
  R: Float32Array;
  sampleRate: number;
}

export interface AnalyzeOptions {
  onProgress?: (stage: string, fraction: number) => void;
  includeSections?: boolean;
}

/**
 * Runs the complete measurement pipeline. All measurements are derived from
 * the actual audio — nothing is synthesised or estimated by a language model.
 */
export function analyzeAudio(input: AnalysisInput, options: AnalyzeOptions = {}): AnalysisReport {
  const { L, R, sampleRate } = input;
  const n = Math.min(L.length, R.length);
  const duration = n / sampleRate;
  const progress = options.onProgress ?? (() => {});
  const warnings: string[] = [];

  progress('Measuring loudness', 0.02);
  const loudness = analyzeLoudness(L, R, sampleRate, (f) => progress('Measuring loudness', 0.02 + f * 0.33));

  progress('Analysing spectrum', 0.36);
  const accum = createSpectrumAccum(sampleRate);
  accumulateSpectrum(accum, L, R, 0, n, (f) => progress('Analysing spectrum', 0.36 + f * 0.22));
  const spectrum = finalizeSpectrum(accum);

  progress('Analysing stereo image', 0.6);
  const stereo = analyzeStereo(L, R, sampleRate, (f) => progress('Analysing stereo image', 0.6 + f * 0.18));

  progress('Detecting tempo and sections', 0.8);
  const rhythm = analyzeRhythm(L, R, sampleRate);

  progress('Measuring sections', 0.85);
  const sections: SectionReport[] = [];
  const includeSections = options.includeSections ?? true;
  if (includeSections) {
    const boundaries = rhythm.sections.length ? rhythm.sections : [{ start: 0, end: duration }];
    const labels = labelSections(
      boundaries.map((b) => ({
        ...b,
        lufs: quickLufs(L, R, sampleRate, b.start, b.end),
      })),
    );
    boundaries.forEach((boundary: SectionBoundary, index: number) => {
      const startSample = Math.floor(boundary.start * sampleRate);
      const endSample = Math.min(n, Math.ceil(boundary.end * sampleRate));
      if (endSample - startSample < sampleRate * 0.5) return;
      const sectionL = L.subarray(startSample, endSample);
      const sectionR = R.subarray(startSample, endSample);
      const sectionLoudness = analyzeLoudness(sectionL, sectionR, sampleRate);
      const sectionStereo = analyzeStereo(sectionL, sectionR, sampleRate);
      const sectionAccum = createSpectrumAccum(sampleRate);
      accumulateSpectrum(sectionAccum, sectionL, sectionR);
      const sectionSpectrum = finalizeSpectrum(sectionAccum);
      sections.push({
        index,
        label: labels[index] ?? 'section',
        start: boundary.start,
        end: boundary.end,
        lufs: sectionLoudness.integratedLufs,
        crestDb: sectionLoudness.crestDb,
        widthDb: sectionStereo.widthDb,
        correlation: sectionStereo.correlation,
        bands: sectionSpectrum.bands,
        punchScore: 0,
      });
      progress('Measuring sections', 0.85 + ((index + 1) / boundaries.length) * 0.15);
    });
  }
  if (!sections.length) {
    sections.push({
      index: 0,
      label: 'full',
      start: 0,
      end: duration,
      lufs: loudness.integratedLufs,
      crestDb: loudness.crestDb,
      widthDb: stereo.widthDb,
      correlation: stereo.correlation,
      bands: spectrum.bands,
      punchScore: rhythm.punchScore,
    });
  }

  if (loudness.truePeakDb > 0) warnings.push('Source exceeds 0 dBTP and may already be clipping.');
  if (stereo.correlation < 0) warnings.push('Stereo correlation is negative; the track may collapse or change in mono.');
  if (stereo.monoCompatibility < 75) warnings.push('Mono compatibility is below 75%; significant side energy may cancel in mono.');
  if (loudness.lra < 3) warnings.push('Loudness range is very low; the source is already heavily compressed.');
  if (duration < 10) warnings.push('Short files give less reliable tempo and section estimates.');

  progress('Done', 1);
  return {
    version: 1,
    createdAt: Date.now(),
    sampleRate,
    channels: 2,
    duration,
    loudness,
    spectrum,
    stereo,
    rhythm: { ...rhythm, sections: rhythm.sections.length ? rhythm.sections : [{ start: 0, end: duration }] },
    sections,
    transients: {
      crestDb: loudness.crestDb,
      plrDb: loudness.plrDb,
      attackDensity: rhythm.onsetDensity,
      punchScore: rhythm.punchScore,
      maxShortTermLufs: loudness.shortTermMaxLufs,
    },
    resonances: spectrum.resonances,
    warnings,
  };
}

function quickLufs(L: Float32Array, R: Float32Array, sr: number, start: number, end: number): number {
  const s = Math.max(0, Math.floor(start * sr));
  const e = Math.min(L.length, Math.ceil(end * sr));
  if (e - s < sr * 0.3) return -Infinity;
  return analyzeLoudness(L.subarray(s, e), R.subarray(s, e), sr).integratedLufs;
}

export function bandsRelativeMap(bands: BandLevel[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const b of bands) map.set(b.center, b.relativeDb);
  return map;
}
