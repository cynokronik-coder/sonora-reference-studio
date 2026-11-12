import { analyzeLoudness, type LoudnessReport } from './loudness';
import {
  type BandLevel,
  type Resonance,
  type SpectrumReport,
} from './spectrum';
import { type StereoReport } from './stereo';
import { analyzeSpectrumAndStereo } from './spectral-analysis';
import { analyzeRhythm, labelSections, type RhythmReport } from './rhythm';
import type { SectionBoundary } from './rhythm';

export interface SectionReport {
  index: number;
  label: string;
  start: number;
  end: number;
  /** Segment-level BS.1770-5 / EBU measurements. */
  lufs: number;
  truePeakDb: number;
  samplePeakDb: number;
  rmsDb: number;
  crestDb: number;
  plrDb: number;
  /** Null when the section is too short for a stable short-term distribution. */
  lra: number | null;
  dynamicRangeDb: number;
  momentaryMaxLufs: number;
  shortTermMaxLufs: number;
  /** Segment-level stereo image measurements. */
  widthDb: number;
  correlation: number;
  monoCompatibility: number;
  lowSideRatioDb: number;
  midEnergyDb: number;
  sideEnergyDb: number;
  balanceDb: number;
  /** Segment-level spectral descriptors. */
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
  /** Section rhythm metrics; tempo is omitted for short excerpts. */
  tempoBpm: number | null;
  beatConfidence: number | null;
  attackDensity: number | null;
  attackSharpness: number | null;
  punchScore: number | null;
}

export interface AnalysisReport {
  version: 1;
  /** Version of the expanded per-section measurement payload. Older stored reports require re-analysis. */
  sectionMetricsVersion?: 2;
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

  progress('Analysing spectrum and stereo', 0.36);
  const { spectrum, stereo } = analyzeSpectrumAndStereo(
    L,
    R,
    sampleRate,
    (fraction) => progress('Analysing spectrum and stereo', 0.36 + fraction * 0.42),
  );

  progress('Detecting tempo and sections', 0.8);
  const rhythm = analyzeRhythm(L, R, sampleRate, {
    onProgress: (stage, fraction) => progress(stage, Math.min(0.85, 0.8 + fraction * 0.05)),
  });

  progress('Measuring sections', 0.85);
  const sections: SectionReport[] = [];
  const includeSections = options.includeSections ?? true;
  if (includeSections) {
    const boundaries = rhythm.sections.length ? rhythm.sections : [{ start: 0, end: duration }];
    // Measure segment loudness once. The same measured values drive automatic
    // labels and the full section report, avoiding duplicate DSP passes.
    const measuredBoundaries = boundaries.map((boundary, index) => {
      const sectionBase = index / Math.max(1, boundaries.length);
      const sectionEnd = (index + 1) / Math.max(1, boundaries.length);
      const startSample = Math.max(0, Math.floor(boundary.start * sampleRate));
      const endSample = Math.min(n, Math.ceil(boundary.end * sampleRate));
      if (endSample - startSample < sampleRate * 0.5) {
        progress('Measuring section loudness', 0.85 + sectionEnd * 0.06);
        return null;
      }
      const sectionL = L.subarray(startSample, endSample);
      const sectionR = R.subarray(startSample, endSample);
      const sectionLoudness = analyzeLoudness(
        sectionL,
        sectionR,
        sampleRate,
        (fraction) => progress('Measuring section loudness', 0.85 + (sectionBase + fraction / boundaries.length) * 0.06),
      );
      progress('Measuring section loudness', 0.85 + sectionEnd * 0.06);
      return { boundary, sectionL, sectionR, sectionLoudness };
    });
    progress('Calculating section metrics', 0.91);
    const labels = labelSections(boundaries.map((boundary, index) => ({
      ...boundary,
      lufs: measuredBoundaries[index]?.sectionLoudness.integratedLufs ?? -Infinity,
    })));
    measuredBoundaries.forEach((measured, index) => {
      const sectionStart = index / Math.max(1, boundaries.length);
      const sectionEnd = (index + 1) / Math.max(1, boundaries.length);
      const sectionProgress = (fraction: number) =>
        progress('Calculating section metrics', 0.91 + (sectionStart + fraction / boundaries.length) * 0.09);
      if (!measured) {
        progress('Calculating section metrics', 0.91 + sectionEnd * 0.09);
        return;
      }
      const { boundary, sectionL, sectionR, sectionLoudness } = measured;
      const sectionDuration = sectionL.length / sampleRate;
      const { spectrum: sectionSpectrum, stereo: sectionStereo } = analyzeSpectrumAndStereo(
        sectionL,
        sectionR,
        sampleRate,
        (fraction) => sectionProgress(fraction * 0.65),
      );
      // Structural section detection is already complete. Reuse the rhythm
      // feature engine without running another self-similarity segmentation.
      const sectionRhythm = sectionDuration >= 2
        ? analyzeRhythm(sectionL, sectionR, sampleRate, {
            includeSections: false,
            onProgress: (_stage, fraction) => sectionProgress(0.65 + fraction * 0.35),
          })
        : null;
      const sectionTempo = sectionDuration >= 8 && sectionRhythm?.tempoBpm
        ? sectionRhythm.tempoBpm
        : null;
      sections.push({
        index,
        label: labels[index] ?? 'section',
        start: boundary.start,
        end: boundary.end,
        lufs: sectionLoudness.integratedLufs,
        truePeakDb: sectionLoudness.truePeakDb,
        samplePeakDb: sectionLoudness.samplePeakDb,
        rmsDb: sectionLoudness.rmsDb,
        crestDb: sectionLoudness.crestDb,
        plrDb: sectionLoudness.plrDb,
        // Below ten seconds, the small short-term sample distribution is
        // too sparse for a dependable section LRA. Keep this explicitly null.
        lra: sectionDuration >= 10 ? sectionLoudness.lra : null,
        dynamicRangeDb: sectionLoudness.dynamicRangeDb,
        momentaryMaxLufs: sectionLoudness.momentaryMaxLufs,
        shortTermMaxLufs: sectionLoudness.shortTermMaxLufs,
        widthDb: sectionStereo.widthDb,
        correlation: sectionStereo.correlation,
        monoCompatibility: sectionStereo.monoCompatibility,
        lowSideRatioDb: sectionStereo.lowSideRatioDb,
        midEnergyDb: sectionStereo.midEnergyDb,
        sideEnergyDb: sectionStereo.sideEnergyDb,
        balanceDb: sectionStereo.balanceDb,
        bands: sectionSpectrum.bands,
        centroidHz: sectionSpectrum.centroidHz,
        rolloffHz: sectionSpectrum.rolloffHz,
        tiltDbPerOct: sectionSpectrum.tiltDbPerOct,
        flatness: sectionSpectrum.flatness,
        lowEnergyDb: sectionSpectrum.lowEnergyDb,
        highEnergyDb: sectionSpectrum.highEnergyDb,
        resonances: sectionSpectrum.resonances,
        maxBuildupDb: sectionSpectrum.maxBuildupDb,
        buildupBands: sectionSpectrum.buildupBands,
        tempoBpm: sectionTempo,
        beatConfidence: sectionTempo !== null && sectionRhythm ? sectionRhythm.beatConfidence : null,
        attackDensity: sectionRhythm?.onsetDensity ?? null,
        attackSharpness: sectionRhythm?.attackSharpness ?? null,
        punchScore: sectionRhythm?.punchScore ?? null,
      });
      sectionProgress(1);
    });
  }
  if (!sections.length) {
    sections.push({
      index: 0,
      label: 'full',
      start: 0,
      end: duration,
      lufs: loudness.integratedLufs,
      truePeakDb: loudness.truePeakDb,
      samplePeakDb: loudness.samplePeakDb,
      rmsDb: loudness.rmsDb,
      crestDb: loudness.crestDb,
      plrDb: loudness.plrDb,
      lra: duration >= 10 ? loudness.lra : null,
      dynamicRangeDb: loudness.dynamicRangeDb,
      momentaryMaxLufs: loudness.momentaryMaxLufs,
      shortTermMaxLufs: loudness.shortTermMaxLufs,
      widthDb: stereo.widthDb,
      correlation: stereo.correlation,
      monoCompatibility: stereo.monoCompatibility,
      lowSideRatioDb: stereo.lowSideRatioDb,
      midEnergyDb: stereo.midEnergyDb,
      sideEnergyDb: stereo.sideEnergyDb,
      balanceDb: stereo.balanceDb,
      bands: spectrum.bands,
      centroidHz: spectrum.centroidHz,
      rolloffHz: spectrum.rolloffHz,
      tiltDbPerOct: spectrum.tiltDbPerOct,
      flatness: spectrum.flatness,
      lowEnergyDb: spectrum.lowEnergyDb,
      highEnergyDb: spectrum.highEnergyDb,
      resonances: spectrum.resonances,
      maxBuildupDb: spectrum.maxBuildupDb,
      buildupBands: spectrum.buildupBands,
      tempoBpm: duration >= 8 && rhythm.tempoBpm ? rhythm.tempoBpm : null,
      beatConfidence: duration >= 8 ? rhythm.beatConfidence : null,
      attackDensity: duration >= 2 ? rhythm.onsetDensity : null,
      attackSharpness: duration >= 2 ? rhythm.attackSharpness : null,
      punchScore: duration >= 2 ? rhythm.punchScore : null,
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
    sectionMetricsVersion: 2,
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

export function bandsRelativeMap(bands: BandLevel[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const b of bands) map.set(b.center, b.relativeDb);
  return map;
}
