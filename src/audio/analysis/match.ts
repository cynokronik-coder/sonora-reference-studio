import type { AnalysisReport, SectionReport } from './analyze';
import { BAND_CENTERS, type BandLevel } from './spectrum';
import { createDefaultParams } from '../dsp/registry';
import { ParametricEq } from '../dsp/processors/eq';
import { clamp } from '../dsp/util';
import type { MatchSettings, ProcessorNodeState } from '../model/types';
import { uid } from '../model/defaults';

export interface MatchCategory {
  key: keyof CategorySource;
  label: string;
  description: string;
}

export type CategorySource = {
  frequencyBalance: number;
  loudness: number;
  dynamics: number;
  stereoWidth: number;
  punch: number;
  saturation: number;
  character: number;
};

export interface MetricDiff {
  label: string;
  target: string;
  reference: string;
  delta: string;
  severity: 'low' | 'medium' | 'high';
}

export interface MatchProposal {
  id: string;
  category: keyof CategorySource;
  processorType: string;
  processorName: string;
  params: Record<string, number>;
  reason: string;
  expected: string;
  confidence: number;
  before: MetricDiff[];
  predicted: Record<string, number | number[] | string>;
}

export interface MatchWarning {
  kind: 'info' | 'limitation' | 'warning';
  message: string;
}

export interface MatchPlan {
  id: string;
  createdAt: number;
  intensity: number;
  referenceAssetIds: string[];
  proposals: MatchProposal[];
  diagnostics: MetricDiff[];
  warnings: MatchWarning[];
  predicted: {
    integratedLufs: number;
    truePeakDb: number;
    crestDb: number;
    widthDb: number;
    toneDeltaDb: number[];
    bands: number[];
  };
  effectiveScale: CategorySource;
}

export interface MatchGenerationOptions {
  settings: MatchSettings;
  target: AnalysisReport;
  references: { assetId: string; report: AnalysisReport; weight?: number }[];
  targetTruePeakDb?: number;
}

export const MATCH_CATEGORIES: MatchCategory[] = [
  { key: 'frequencyBalance', label: 'Frequency balance', description: 'Tonal balance and spectral tilt' },
  { key: 'loudness', label: 'Loudness', description: 'Integrated level and peak ceiling' },
  { key: 'dynamics', label: 'Dynamics', description: 'Crest factor, PLR and loudness range' },
  { key: 'stereoWidth', label: 'Stereo width', description: 'Side energy and mono compatibility' },
  { key: 'punch', label: 'Punch & transients', description: 'Attack density and transient emphasis' },
  { key: 'saturation', label: 'Saturation & harmonics', description: 'Harmonic density and high-frequency texture' },
  { key: 'character', label: 'Overall character', description: 'Style of compression and harmonic colour' },
];

/**
 * Perceptual intensity curve.
 *
 * The global intensity is not a multiplier on every parameter — each category
 * maps through its own curve. Tonal corrections use a stronger exponent so a
 * 25% request really is subtle, while loudness uses a slightly softer curve
 * because level changes are highly audible.
 */
export function intensityScale(global: number, category: number, exponent: number): number {
  const g = clamp(global / 100, 0, 1);
  const c = clamp(category / 100, 0, 1);
  return Math.pow(g, exponent) * c;
}

export function effectiveScales(settings: MatchSettings): CategorySource {
  const tonal = intensityScale(settings.intensity, settings.frequencyBalance, 1.25);
  return {
    frequencyBalance: settings.matchTonal ? tonal : 0,
    loudness: settings.matchLoudness ? intensityScale(settings.intensity, settings.loudness, 0.9) : 0,
    dynamics: settings.matchDynamics ? intensityScale(settings.intensity, settings.dynamics, 1.1) : 0,
    stereoWidth: settings.matchStereo ? intensityScale(settings.intensity, settings.stereoWidth, 1.0) : 0,
    punch: settings.matchPunch ? intensityScale(settings.intensity, settings.punch, 1.0) : 0,
    saturation: intensityScale(settings.intensity, settings.saturation, 1.1),
    character: intensityScale(settings.intensity, settings.character, 1.0),
  };
}

function pickSection(report: AnalysisReport, which: 'full' | 'chorus' | 'verse'): SectionReport | null {
  if (which === 'full') return null;
  const matching = report.sections.filter((s) => s.label === which);
  if (!matching.length) return null;
  // Choose the most representative (longest) matching section.
  return matching.reduce((a, b) => ((b.end - b.start) > (a.end - a.start) ? b : a));
}

function bandsFor(report: AnalysisReport, section: 'full' | 'chorus' | 'verse'): BandLevel[] {
  const s = pickSection(report, section);
  return s ? s.bands : report.spectrum.bands;
}

interface Metrics {
  lufs: number;
  truePeakDb: number;
  crestDb: number;
  lra: number;
  plrDb: number;
  widthDb: number;
  correlation: number;
  monoCompatibility: number;
  lowSideDb: number;
  punchScore: number;
  attackDensity: number;
  flatness: number;
  tiltDbPerOct: number;
  highEnergyDb: number;
  lowEnergyDb: number;
  tempoBpm: number;
  bands: BandLevel[];
  sectionFallback: boolean;
  duration: number;
}

type ReferenceInput = { assetId: string; report: AnalysisReport; weight?: number };

export interface ResolvedReferenceMetrics {
  metrics: Metrics;
  assetIds: string[];
  fallbackAssetIds: string[];
  name: string;
  agreement: CategorySource;
  quality: number;
}

function metricsFrom(report: AnalysisReport, section: 'full' | 'chorus' | 'verse'): Metrics {
  const sec = pickSection(report, section);
  return {
    lufs: sec ? sec.lufs : report.loudness.integratedLufs,
    truePeakDb: report.loudness.truePeakDb,
    crestDb: sec ? sec.crestDb : report.loudness.crestDb,
    lra: report.loudness.lra,
    plrDb: report.loudness.plrDb,
    widthDb: sec ? sec.widthDb : report.stereo.widthDb,
    correlation: sec ? sec.correlation : report.stereo.correlation,
    monoCompatibility: report.stereo.monoCompatibility,
    lowSideDb: report.stereo.lowSideRatioDb,
    punchScore: report.rhythm.punchScore,
    attackDensity: report.rhythm.onsetDensity,
    flatness: report.spectrum.flatness,
    tiltDbPerOct: report.spectrum.tiltDbPerOct,
    highEnergyDb: report.spectrum.highEnergyDb,
    lowEnergyDb: report.spectrum.lowEnergyDb,
    tempoBpm: report.rhythm.tempoBpm,
    bands: sec ? sec.bands : report.spectrum.bands,
    sectionFallback: section !== 'full' && !sec,
    duration: report.duration,
  };
}

function weightedMean(values: number[], weights: number[]): number {
  let sum = 0;
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i]) || !(weights[i] > 0)) continue;
    sum += values[i] * weights[i];
    total += weights[i];
  }
  return total > 0 ? sum / total : -Infinity;
}

function weightedDbMean(values: number[], weights: number[], reference: 'power' | 'amplitude'): number {
  const factor = reference === 'power' ? 10 : 20;
  const linear = values.map((value) => Number.isFinite(value) ? Math.pow(10, value / factor) : Number.NaN);
  const mean = weightedMean(linear, weights);
  return mean > 0 ? factor * Math.log10(mean) : -Infinity;
}

function weightedSpread(values: number[], weights: number[], tolerance: number): number {
  const mean = weightedMean(values, weights);
  if (!Number.isFinite(mean)) return 0.2;
  let variance = 0;
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i]) || !(weights[i] > 0)) continue;
    variance += weights[i] * Math.pow(values[i] - mean, 2);
    total += weights[i];
  }
  return clamp(1 - Math.sqrt(variance / Math.max(1e-12, total)) / tolerance, 0.2, 1);
}

/**
 * Resolve either one explicitly selected reference or a weighted consensus.
 * A negative source index means "blend all references"; zero-weight references
 * are excluded from that blend. If every weight is zero, equal weights are used
 * rather than producing an empty or silent reference.
 */
export function resolveReferenceMetrics(
  sourceIndex: number | undefined,
  references: ReferenceInput[],
  section: 'full' | 'chorus' | 'verse',
): ResolvedReferenceMetrics {
  if (!references.length) throw new Error('At least one analysed reference is required.');
  const blended = sourceIndex === undefined || Math.round(sourceIndex) < 0;
  const selected = blended ? references : [references[clamp(Math.round(sourceIndex), 0, references.length - 1)]];
  const selectedMetrics = selected.map((entry) => metricsFrom(entry.report, section));
  let weights = selected.map((entry) => blended && Number.isFinite(entry.weight) ? Math.max(0, entry.weight as number) : 1);
  if (weights.every((weight) => weight <= 0)) weights = selected.map(() => 1);
  const sum = weights.reduce((a, b) => a + b, 0);
  weights = weights.map((weight) => weight / sum);

  const first = selectedMetrics[0];
  const numericKeys: (keyof Omit<Metrics, 'bands' | 'sectionFallback' | 'duration' | 'lufs' | 'truePeakDb'>)[] = [
    'crestDb', 'lra', 'plrDb', 'widthDb', 'correlation', 'monoCompatibility',
    'lowSideDb', 'punchScore', 'attackDensity', 'flatness', 'tiltDbPerOct',
    'highEnergyDb', 'lowEnergyDb', 'tempoBpm',
  ];
  const metrics: Metrics = {
    ...first,
    lufs: weightedDbMean(selectedMetrics.map((value) => value.lufs), weights, 'power'),
    truePeakDb: weightedDbMean(selectedMetrics.map((value) => value.truePeakDb), weights, 'amplitude'),
    bands: [],
    sectionFallback: selectedMetrics.some((value) => value.sectionFallback),
    duration: weightedMean(selectedMetrics.map((value) => value.duration), weights),
  };
  for (const key of numericKeys) {
    (metrics as unknown as Record<string, number>)[key] = weightedMean(
      selectedMetrics.map((value) => value[key] as number),
      weights,
    );
  }

  const bandCount = Math.max(...selectedMetrics.map((value) => value.bands.length));
  metrics.bands = Array.from({ length: bandCount }, (_, index) => {
    const center = selectedMetrics.find((value) => value.bands[index])?.bands[index]?.center ?? 0;
    const db = weightedDbMean(
      selectedMetrics.map((value) => value.bands[index]?.db ?? Number.NaN),
      weights,
      'power',
    );
    return { center, db, relativeDb: 0 };
  });
  const averageDb = metrics.bands.reduce((total, band) => total + band.db, 0) / Math.max(1, metrics.bands.length);
  metrics.bands.forEach((band) => { band.relativeDb = band.db - averageDb; });

  const relativeByReference = selectedMetrics.map((value) => {
    const avg = value.bands.reduce((total, band) => total + band.db, 0) / Math.max(1, value.bands.length);
    return value.bands.map((band) => band.db - avg);
  });
  const tonalSpread = Math.sqrt(
    metrics.bands.reduce((total, band, index) => {
      const mean = band.relativeDb;
      const variance = weightedMean(
        relativeByReference.map((values) => Number.isFinite(values[index]) ? Math.pow(values[index] - mean, 2) : Number.NaN),
        weights,
      );
      return total + (Number.isFinite(variance) ? variance : 0);
    }, 0) / Math.max(1, metrics.bands.length),
  );
  const spread = (key: keyof Metrics, tolerance: number) =>
    weightedSpread(selectedMetrics.map((value) => value[key] as number), weights, tolerance);
  const agreement: CategorySource = {
    frequencyBalance: clamp(1 - tonalSpread / 10, 0.2, 1),
    loudness: spread('lufs', 6),
    dynamics: Math.min(spread('crestDb', 6), spread('lra', 5)),
    stereoWidth: spread('widthDb', 8),
    punch: spread('punchScore', 0.35),
    saturation: Math.min(spread('flatness', 0.25), spread('tiltDbPerOct', 4)),
    character: Math.min(spread('lra', 5), spread('crestDb', 6)),
  };
  const quality = weightedMean(selectedMetrics.map((value) => {
    const loudnessQuality = Number.isFinite(value.lufs) && value.lufs > -60 ? 1 : 0.55;
    const durationQuality = clamp(Math.log10(Math.max(1, value.duration)) / Math.log10(30), 0.55, 1);
    const sectionQuality = value.sectionFallback ? 0.9 : 1;
    return loudnessQuality * durationQuality * sectionQuality;
  }), weights);
  const fallbackAssetIds = selected.filter((entry, index) => selectedMetrics[index].sectionFallback).map((entry) => entry.assetId);

  return {
    metrics,
    assetIds: selected.map((entry) => entry.assetId),
    fallbackAssetIds,
    name: blended ? 'weighted reference blend' : (selected.length === 1 ? 'selected reference' : 'reference'),
    agreement,
    quality: Number.isFinite(quality) ? quality : 0.55,
  };
}

function referenceFor(
  sources: CategorySource,
  category: keyof CategorySource,
  references: ReferenceInput[],
  section: 'full' | 'chorus' | 'verse',
): ResolvedReferenceMetrics {
  return resolveReferenceMetrics(sources[category], references, section);
}

function confidenceFor(
  base: number,
  reference: ResolvedReferenceMetrics,
  category: keyof CategorySource,
): number {
  // This is a transparent heuristic, not a calibrated probability. Agreement
  // between references and source-analysis quality reduce overconfident advice.
  const agreementFactor = 0.65 + 0.35 * reference.agreement[category];
  const qualityFactor = 0.8 + 0.2 * reference.quality;
  return clamp(base * agreementFactor * qualityFactor, 0.1, 0.95);
}

function fmtDb(v: number, digits = 1): string {
  return Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(digits)} dB` : '—';
}

function relativeBands(bands: BandLevel[]): Float32Array {
  const out = new Float32Array(bands.length);
  const average = bands.reduce((a, b) => a + b.db, 0) / Math.max(1, bands.length);
  bands.forEach((b, i) => {
    out[i] = b.db - average;
  });
  return out;
}

function severityFor(deltaDb: number): 'low' | 'medium' | 'high' {
  const a = Math.abs(deltaDb);
  if (a >= 6) return 'high';
  if (a >= 3) return 'medium';
  return 'low';
}

function referenceFor(
  sources: CategorySource,
  category: keyof CategorySource,
  references: MatchGenerationOptions['references'],
): MatchGenerationOptions['references'][number] {
  const index = Math.round(sources[category]) || 0;
  return references[clamp(index, 0, references.length - 1)];
}

/**
 * Compose up to six EQ bands from a smoothed tonal-error curve.
 * Peaks are selected in order of magnitude with a minimum one-octave spacing;
 * edge corrections become shelves so the result stays musical.
 */
function buildEqProposals(
  deltas: Float32Array,
  settings: MatchSettings,
  scale: number,
): { params: Record<string, number>; bands: { freq: number; gain: number }[]; predicted: Float32Array } {
  const params: Record<string, number> = { ...createDefaultParams('eq') };
  const smooth = new Float32Array(deltas.length);
  for (let i = 0; i < deltas.length; i++) {
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, i - 1); k <= Math.min(deltas.length - 1, i + 1); k++) {
      sum += deltas[k];
      count++;
    }
    smooth[i] = sum / count;
  }

  const maxBoost = Math.max(0, settings.maxEqBoost);
  const maxCut = Math.max(0, settings.maxEqCut);
  const boosted = smooth.map((v) => clamp(v * scale, -maxCut, maxBoost));

  // Protection and exclusion ranges.
  for (let i = 0; i < boosted.length; i++) {
    const freq = BAND_CENTERS[i];
    if (settings.protectLowEnd && freq < 80) boosted[i] = 0;
    if (settings.protectHighEnd && freq > 16000) boosted[i] = 0;
    if (freq < settings.excludeLowHz || freq > settings.excludeHighHz) boosted[i] = 0;
  }

  const selected: { index: number; magnitude: number }[] = [];
  const used = new Set<number>();
  for (let pick = 0; pick < 6; pick++) {
    let best = -1;
    let bestMag = 0.9; // ignore negligible corrections
    for (let i = 0; i < boosted.length; i++) {
      if (used.has(i)) continue;
      if (selected.some((s) => Math.abs(Math.log2(BAND_CENTERS[s.index] / BAND_CENTERS[i])) < 1)) continue;
      if (Math.abs(boosted[i]) > bestMag) {
        bestMag = Math.abs(boosted[i]);
        best = i;
      }
    }
    if (best < 0) break;
    selected.push({ index: best, magnitude: boosted[best] });
    used.add(best);
  }

  const bands: { freq: number; gain: number }[] = [];
  selected.forEach((sel, slot) => {
    const freq = BAND_CENTERS[sel.index];
    const gain = boosted[sel.index];
    const isEdge = sel.index <= 1 || sel.index >= BAND_CENTERS.length - 2;
    let bandwidth = freq * 1.5;
    for (let i = sel.index + 1; i < boosted.length; i++) {
      if (Math.sign(boosted[i]) !== Math.sign(gain) || Math.abs(boosted[i]) < Math.abs(gain) * 0.4) {
        bandwidth = BAND_CENTERS[i] / freq;
        break;
      }
    }
    const q = clamp(1 / Math.max(0.35, Math.log2(Math.max(1.05, bandwidth))), 0.4, 2.6);
    const p = `b${slot}`;
    params[`${p}_on`] = 1;
    params[`${p}_type`] = isEdge && Math.abs(gain) > 1.5 ? (sel.index <= 1 ? 1 : 2) : 0;
    params[`${p}_freq`] = Math.min(20000, Math.max(20, freq));
    params[`${p}_gain`] = Number(gain.toFixed(2));
    params[`${p}_q`] = Number(q.toFixed(2));
    params[`${p}_route`] = 0;
    bands.push({ freq, gain });
  });

  const freqs = new Float32Array(BAND_CENTERS);
  const response = ParametricEq.response(params, 48000, freqs);
  return { params, bands, predicted: response };
}

/**
 * Decision engine: measurement → proposed processing.
 *
 * Every proposal carries the reason, the expected result, a confidence value
 * and before/after measurements. It is fully editable after generation; this
 * function never mutates the project.
 */
export function generateMatchPlan(options: MatchGenerationOptions): MatchPlan {
  const { settings, target, references } = options;
  const sources = settings.categorySource as CategorySource;
  const scales = effectiveScales(settings);
  const tgt = metricsFrom(target, settings.targetSection);
  const warnings: MatchWarning[] = [
    {
      kind: 'info',
      message:
        'Reference matching corrects measurable production characteristics. It cannot recreate the arrangement, performance or instruments of the reference.',
    },
  ];
  if (!references.length) {
    throw new Error('At least one analysed reference is required.');
  }

  const proposals: MatchProposal[] = [];
  const diagnostics: MetricDiff[] = [];

  const sectionFallbackWarnings = new Set<string>();
  if (settings.targetSection !== 'full' && !pickSection(target, settings.targetSection)) {
    warnings.push({
      kind: 'limitation',
      message: `The requested target section (“${settings.targetSection}”) was not detected. Full-track measurements are being used for the target.`,
    });
  }
  const refFor = (category: keyof CategorySource) => {
    const resolved = referenceFor(sources, category, references, settings.referenceSection);
    for (const assetId of resolved.fallbackAssetIds) sectionFallbackWarnings.add(assetId);
    if (resolved.fallbackAssetIds.length) {
      warnings.push({
        kind: 'limitation',
        message: `The requested reference section (“${settings.referenceSection}”) was not detected in ${resolved.fallbackAssetIds.length} selected reference(s). Full-track measurements are used for those files.`,
      });
    }
    return resolved;
  };

  // ---------- Tonal balance ----------
  if (scales.frequencyBalance > 0.01) {
    const ref = refFor('frequencyBalance');
    const tgtBands = relativeBands(tgt.bands);
    const refBands = relativeBands(ref.metrics.bands);
    const deltas = new Float32Array(BAND_CENTERS.length);
    for (let i = 0; i < deltas.length; i++) {
      deltas[i] = (refBands[i] ?? 0) - (tgtBands[i] ?? 0);
    }
    const eq = buildEqProposals(deltas, settings, scales.frequencyBalance);
    const strongest = [...deltas]
      .map((v, i) => ({ v: v * scales.frequencyBalance, center: BAND_CENTERS[i] }))
      .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0];
    if (eq.bands.length) {
      const realBands = eq.bands.map((b) => {
        const i = BAND_CENTERS.indexOf(b.freq);
        return { freq: b.freq, gain: deltas[i] ?? b.gain };
      });
      proposals.push({
        id: uid('prop'),
        category: 'frequencyBalance',
        processorType: 'eq',
        processorName: 'Parametric EQ',
        params: eq.params,
        reason:
          `Tonal balance differs most around ${strongest?.center ?? 0} Hz ` +
          `(${fmtDb(strongest?.v ?? 0)} vs. ${ref.name}). ` +
          `The EQ bands below use the smoothed spectral difference, capped at +${settings.maxEqBoost}/-${settings.maxEqCut} dB.`,
        expected: 'Frequency response moves toward the reference balance while keeping the target arrangement intact.',
        confidence: confidenceFor(0.55 + (ref.assetIds.length - 1) * 0.1, ref, 'frequencyBalance'),
        before: [
          {
            label: 'Tonal difference',
            target: `${(tgtBands[BAND_CENTERS.indexOf(strongest?.center ?? 1000)] ?? 0).toFixed(1)} dB`,
            reference: `${(refBands[BAND_CENTERS.indexOf(strongest?.center ?? 1000)] ?? 0).toFixed(1)} dB`,
            delta: fmtDb(strongest?.v ?? 0),
            severity: severityFor(strongest?.v ?? 0),
          },
        ],
        predicted: {
          bands: Array.from(eq.predicted),
          strongestHz: realBands[0]?.freq ?? 0,
          strongestGain: realBands[0]?.gain ?? 0,
        },
      });
      diagnostics.push({
        label: `Tonal balance @ ${strongest?.center ?? 0} Hz`,
        target: `${(tgtBands[BAND_CENTERS.indexOf(strongest?.center ?? 1000)] ?? 0).toFixed(1)} dB (relative)`,
        reference: `${(refBands[BAND_CENTERS.indexOf(strongest?.center ?? 1000)] ?? 0).toFixed(1)} dB (relative)`,
        delta: fmtDb(strongest?.v ?? 0),
        severity: severityFor(strongest?.v ?? 0),
      });
    }
  }

  // ---------- Dynamics ----------
  let predictedCrest = tgt.crestDb;
  if (scales.dynamics > 0.01) {
    const ref = refFor('dynamics');
    const crestDelta = tgt.crestDb - ref.metrics.crestDb;
    const lraDelta = tgt.lra - ref.metrics.lra;
    diagnostics.push({
      label: 'Dynamics (crest factor)',
      target: `${tgt.crestDb.toFixed(1)} dB`,
      reference: `${ref.metrics.crestDb.toFixed(1)} dB`,
      delta: fmtDb(crestDelta),
      severity: severityFor(crestDelta),
    });
    diagnostics.push({
      label: 'Loudness range (LRA)',
      target: `${tgt.lra.toFixed(1)} LU`,
      reference: `${ref.metrics.lra.toFixed(1)} LU`,
      delta: `${(lraDelta > 0 ? '+' : '') + lraDelta.toFixed(1)} LU`,
      severity: severityFor(lraDelta),
    });

    if (crestDelta > 0.8) {
      const ratio = clamp(1 + crestDelta * 0.28 * scales.dynamics, 1.05, 4);
      const threshold = clamp(tgt.lufs + 2, -40, 0);
      const predictedReduction = Math.min(crestDelta, 5) * scales.dynamics * 0.55;
      predictedCrest = tgt.crestDb - predictedReduction;
      proposals.push({
        id: uid('prop'),
        category: 'dynamics',
        processorType: 'compressor',
        processorName: 'Compressor',
        params: {
          ...createDefaultParams('compressor'),
          threshold: Number(threshold.toFixed(1)),
          ratio: Number(ratio.toFixed(2)),
          attack: 22,
          release: 180,
          knee: 8,
          style: scales.character > 0.5 ? 4 : 0,
          mix: Number((55 + 45 * scales.dynamics).toFixed(0)),
          makeup: 0,
          autoMakeup: 0,
        },
        reason:
          `The target has ${crestDelta.toFixed(1)} dB more crest factor than the reference. ` +
          `A ${ratio.toFixed(1)}:1 compressor with an 8 dB knee reduces the highest peaks and brings average density closer.`,
        expected: `Crest factor moves toward ${predictedCrest.toFixed(1)} dB with transient detail preserved at a ${(55 + 45 * scales.dynamics).toFixed(0)}% wet mix.`,
        confidence: confidenceFor(0.72, ref, 'dynamics'),
        before: [
          {
            label: 'Crest factor',
            target: `${tgt.crestDb.toFixed(1)} dB`,
            reference: `${ref.metrics.crestDb.toFixed(1)} dB`,
            delta: fmtDb(crestDelta),
            severity: severityFor(crestDelta),
          },
        ],
        predicted: { crestDb: predictedCrest, ratio },
      });
    } else if (crestDelta < -0.8) {
      warnings.push({
        kind: 'limitation',
        message:
          'The target already has less dynamic range than the reference. This build does not attempt to expand dynamics upward: that would amplify noise and cannot restore transients that were never captured.',
      });
    }
  }

  // ---------- Loudness ----------
  let predictedLoudness = tgt.lufs;
  if (scales.loudness > 0.01) {
    const ref = refFor('loudness');
    const requested = ref.metrics.lufs - tgt.lufs;
    const allowed = clamp(requested * scales.loudness, -Math.abs(settings.maxLoudnessChange), Math.abs(settings.maxLoudnessChange));
    predictedLoudness = tgt.lufs + allowed;
    diagnostics.push({
      label: 'Integrated loudness',
      target: `${tgt.lufs.toFixed(1)} LUFS`,
      reference: `${ref.metrics.lufs.toFixed(1)} LUFS`,
      delta: `${requested > 0 ? '+' : ''}${requested.toFixed(1)} LU`,
      severity: severityFor(requested),
    });

    if (Math.abs(allowed) >= 0.2) {
      proposals.push({
        id: uid('prop'),
        category: 'loudness',
        processorType: 'gain',
        processorName: 'Gain / Routing',
        params: { ...createDefaultParams('gain'), input: Number(allowed.toFixed(2)), output: 0, pan: 0 },
        reason:
          `Integrated loudness is ${requested.toFixed(1)} LU from the reference. ` +
          `Applying ${allowed >= 0 ? '+' : ''}${allowed.toFixed(1)} dB respects the request and the ±${Math.abs(settings.maxLoudnessChange)} dB matching limit.`,
        expected: `Integrated level approaches ${predictedLoudness.toFixed(1)} LUFS before the limiter.`,
        confidence: confidenceFor(0.88, ref, 'loudness'),
        before: [
          {
            label: 'Integrated loudness',
            target: `${tgt.lufs.toFixed(1)} LUFS`,
            reference: `${ref.metrics.lufs.toFixed(1)} LUFS`,
            delta: `${requested > 0 ? '+' : ''}${requested.toFixed(1)} LU`,
            severity: severityFor(requested),
          },
        ],
        predicted: { lufs: predictedLoudness },
      });
    }
  }

  // ---------- Stereo width ----------
  let predictedWidth = tgt.widthDb;
  if (scales.stereoWidth > 0.01) {
    const ref = refFor('stereoWidth');
    const delta = ref.metrics.widthDb - tgt.widthDb;
    const widthPercent = clamp(100 * Math.pow(10, (delta * scales.stereoWidth) / 20), 15, 190);
    predictedWidth = tgt.widthDb + 20 * Math.log10(widthPercent / 100);
    diagnostics.push({
      label: 'Stereo width (side/mid)',
      target: `${tgt.widthDb.toFixed(1)} dB`,
      reference: `${ref.metrics.widthDb.toFixed(1)} dB`,
      delta: fmtDb(delta),
      severity: severityFor(delta),
    });
    if (Math.abs(widthPercent - 100) > 2) {
      proposals.push({
        id: uid('prop'),
        category: 'stereoWidth',
        processorType: 'stereo',
        processorName: 'Stereo Imaging',
        params: {
          ...createDefaultParams('stereo'),
          width: Number(widthPercent.toFixed(0)),
          lowWidth: 0,
          highWidth: 100,
          split: 180,
          monoMaker: 1,
          haas: 0,
          haasMix: 0,
        },
        reason:
          `The reference has ${delta > 0 ? 'wider' : 'narrower'} side energy by ${Math.abs(delta).toFixed(1)} dB. ` +
          `Width is scaled to ${widthPercent.toFixed(0)}% while keeping everything below 180 Hz mono.`,
        expected: delta > 0 ? 'A wider image with a stable mono low end.' : 'A tighter image more consistent with the reference.',
        confidence: confidenceFor(0.8, ref, 'stereoWidth'),
        before: [
          {
            label: 'Side / mid ratio',
            target: `${tgt.widthDb.toFixed(1)} dB`,
            reference: `${ref.metrics.widthDb.toFixed(1)} dB`,
            delta: fmtDb(delta),
            severity: severityFor(delta),
          },
        ],
        predicted: { widthDb: predictedWidth, widthPercent },
      });
    }
    if (ref.metrics.correlation < 0.2) {
      warnings.push({
        kind: 'warning',
        message: 'The reference has very low phase correlation. Matching its width may reduce mono compatibility on your track.',
      });
    }
  }

  // ---------- Punch ----------
  if (scales.punch > 0.01) {
    const ref = refFor('punch');
    const delta = (ref.metrics.punchScore - tgt.punchScore) * 100;
    const attack = clamp(delta * 0.8 * scales.punch, -35, 55);
    diagnostics.push({
      label: 'Punch / transient density',
      target: `${(tgt.punchScore * 100).toFixed(0)}%`,
      reference: `${(ref.metrics.punchScore * 100).toFixed(0)}%`,
      delta: `${delta > 0 ? '+' : ''}${delta.toFixed(0)} pts`,
      severity: Math.abs(delta) > 15 ? 'high' : Math.abs(delta) > 7 ? 'medium' : 'low',
    });
    if (Math.abs(attack) > 3) {
      proposals.push({
        id: uid('prop'),
        category: 'punch',
        processorType: 'transient',
        processorName: 'Transient Shaper',
        params: {
          ...createDefaultParams('transient'),
          attack: Number(attack.toFixed(0)),
          sustain: Number(clamp(-attack * 0.25, -15, 15).toFixed(0)),
          mix: 65,
          sensitivity: 55,
          output: 0,
        },
        reason:
          `Onset density and attack sharpness indicate ${delta > 0 ? 'less' : 'more'} punch than the reference ` +
          `(${(tgt.punchScore * 100).toFixed(0)}% vs ${(ref.metrics.punchScore * 100).toFixed(0)}%). ` +
          `Transient attack is set to ${attack.toFixed(0)}%.`,
        expected: delta > 0 ? 'Drums and plucks hit harder without a level increase.' : 'Transients are softened to match the reference envelope.',
        confidence: confidenceFor(0.62, ref, 'punch'),
        before: [
          {
            label: 'Punch score',
            target: `${(tgt.punchScore * 100).toFixed(0)}%`,
            reference: `${(ref.metrics.punchScore * 100).toFixed(0)}%`,
            delta: `${delta > 0 ? '+' : ''}${delta.toFixed(0)} pts`,
            severity: Math.abs(delta) > 12 ? 'medium' : 'low',
          },
        ],
        predicted: { attack },
      });
    }
  }

  // ---------- Saturation / harmonics ----------
  if (scales.saturation > 0.01) {
    const ref = refFor('saturation');
    const tonalDelta = ref.metrics.tiltDbPerOct - tgt.tiltDbPerOct;
    const harmonicDelta = (ref.metrics.flatness - tgt.flatness) * 100;
    const drive = clamp(3 + Math.max(0, tonalDelta) * 1.6 + Math.max(0, harmonicDelta), 0, 12) * scales.saturation;
    diagnostics.push({
      label: 'Harmonic density (spectral flatness)',
      target: `${(tgt.flatness * 100).toFixed(1)}%`,
      reference: `${(ref.metrics.flatness * 100).toFixed(1)}%`,
      delta: `${(harmonicDelta > 0 ? '+' : '') + harmonicDelta.toFixed(1)} pts`,
      severity: Math.abs(harmonicDelta) > 3 ? 'high' : Math.abs(harmonicDelta) > 1 ? 'medium' : 'low',
    });
    if (drive > 0.6) {
      proposals.push({
        id: uid('prop'),
        category: 'saturation',
        processorType: 'saturation',
        processorName: 'Saturation',
        params: {
          ...createDefaultParams('saturation'),
          mode: tonalDelta > 0 ? 0 : 2,
          drive: Number(drive.toFixed(1)),
          tone: Number(clamp(tonalDelta, -4, 4).toFixed(1)),
          mix: Number((25 + 45 * scales.saturation).toFixed(0)),
          output: 0,
          oversample: 2,
        },
        reason:
          `The reference has ${harmonicDelta > 0 ? 'more' : 'different'} harmonic density and a ${tonalDelta > 0 ? 'warmer' : 'brighter'} tilt. ` +
          `Saturation drive of ${drive.toFixed(1)} dB is applied at ${(25 + 45 * scales.saturation).toFixed(0)}% wet to add texture without thick distortion.`,
        expected: 'Denser harmonics and a slightly fuller top end. The exact harmonic signature of the reference cannot be cloned from measurement.',
        confidence: confidenceFor(0.55, ref, 'saturation'),
        before: [
          {
            label: 'Spectral flatness',
            target: `${(tgt.flatness * 100).toFixed(1)}%`,
            reference: `${(ref.metrics.flatness * 100).toFixed(1)}%`,
            delta: `${harmonicDelta.toFixed(1)} pts`,
            severity: 'low',
          },
        ],
        predicted: { drive, mix: 25 + 45 * scales.saturation },
      });
    }
  }

  // ---------- Overall character ----------
  if (scales.character > 0.25) {
    const ref = refFor('character');
    const glue = clamp((ref.metrics.lra - tgt.lra) * 0.15, 0, 2);
    if (glue > 0.3) {
      proposals.push({
        id: uid('prop'),
        category: 'character',
        processorType: 'multibandComp',
        processorName: 'Multiband Compressor',
        params: {
          ...createDefaultParams('multibandComp'),
          xLow: 180,
          xHigh: 4500,
          b0_on: 1, b0_threshold: Number((tgt.lufs + 2).toFixed(1)), b0_ratio: 1.8, b0_attack: 30, b0_release: 220, b0_makeup: 0, b0_mix: Number((30 + 30 * scales.character).toFixed(0)), b0_style: 4,
          b1_on: 0, b2_on: 0,
          output: 0,
        },
        reason:
          'The reference has a wider loudness range with a more glued low end. A gentle low-band bus compression stage adds density without flattening the top.',
        expected: 'More consistent low-frequency energy and a cohesive, denser master character.',
        confidence: confidenceFor(0.5, ref, 'character'),
        before: [
          {
            label: 'Loudness range',
            target: `${tgt.lra.toFixed(1)} LU`,
            reference: `${ref.metrics.lra.toFixed(1)} LU`,
            delta: `${(ref.metrics.lra - tgt.lra).toFixed(1)} LU`,
            severity: 'low',
          },
        ],
        predicted: { lowBandRatio: 1.8 },
      });
    }
  }

  // ---------- Peak protection / limiter ----------
  const ceiling = clamp(options.targetTruePeakDb ?? -1, -3, -0.1);
  // A gain-stage estimate is useful for deciding whether peak protection is
  // needed, but it is not a prediction of the limiter's final output. EQ,
  // compression, saturation and inter-sample reconstruction can all change it.
  const estimatedPreLimiterTruePeakDb = estimatePreLimiterTruePeak(tgt.truePeakDb, predictedLoudness - tgt.lufs);
  const needsLimiter = estimatedPreLimiterTruePeakDb > ceiling;
  if (needsLimiter) {
    proposals.push({
      id: uid('prop'),
      category: 'loudness',
      processorType: 'limiter',
      processorName: 'Limiter',
      params: {
        ...createDefaultParams('limiter'),
        input: 0,
        ceiling: Number(ceiling.toFixed(1)),
        release: 90,
        lookahead: 4,
        truePeak: 1,
        output: 0,
      },
      reason: `A ${ceiling.toFixed(1)} dBTP ceiling is required after the loudness change. The limiter uses 4 ms lookahead and true-peak detection.`,
      expected: 'The limiter is configured to protect the selected ceiling. Render and measure the master to verify the delivered true peak.',
      confidence: 0.85,
      before: [
        {
          label: 'Estimated pre-limiter true peak',
          target: `${estimatedPreLimiterTruePeakDb.toFixed(1)} dBTP`,
          reference: `${refFor('loudness').metrics.truePeakDb.toFixed(1)} dBTP`,
          delta: fmtDb(estimatedPreLimiterTruePeakDb - ceiling),
          severity: 'medium',
        },
      ],
      predicted: { truePeakDb: ceiling },
    });
  } else {
    warnings.push({
      kind: 'info',
      message: 'No limiter was added: the predicted level already respects the selected true-peak ceiling.',
    });
  }

  if (estimatedPreLimiterTruePeakDb > ceiling) {
    warnings.push({
      kind: 'warning',
      message:
        'The estimated pre-limiter true peak exceeds the selected ceiling. The limiter is only a protective stage: its actual output and loudness must be confirmed with Render & measure master.',
    });
  } else {
    warnings.push({
      kind: 'info',
      message:
        'The simple gain-based pre-limiter peak estimate is below the selected ceiling. Processing can still change peaks, so verify the rendered master before delivery.',
    });
  }
  if (!references.some((r) => r.report.loudness.integratedLufs > -30)) {
    warnings.push({ kind: 'warning', message: 'A reference appears very quiet or silent; check the uploaded file before trusting the match.' });
  }

  const eqProposal = proposals.find((p) => p.processorType === 'eq');
  const predictedBands = eqProposal
    ? Array.from((eqProposal.predicted.bands as number[]) ?? [])
    : tgt.bands.map((b) => b.relativeDb);

  return {
    id: uid('match'),
    createdAt: Date.now(),
    intensity: settings.intensity,
    referenceAssetIds: references.map((r) => r.assetId),
    proposals,
    diagnostics,
    warnings,
    predicted: {
      integratedLufs: predictedLoudness,
      // This is explicitly the estimated pre-limiter peak, not a guaranteed
      // post-limiter result. The final value comes from the offline render.
      truePeakDb: estimatedPreLimiterTruePeakDb,
      crestDb: predictedCrest,
      widthDb: predictedWidth,
      toneDeltaDb: eqProposal ? (eqProposal.predicted.bands as number[]) : new Array(BAND_CENTERS.length).fill(0),
      bands: predictedBands,
    },
    effectiveScale: scales,
  };
}

/** Convert a plan into editable processor nodes for a project. */
export function planToNodes(plan: MatchPlan): ProcessorNodeState[] {
  return plan.proposals.map((proposal) => ({
    id: uid('proc'),
    type: proposal.processorType,
    version: 1,
    enabled: true,
    params: { ...proposal.params },
    note: proposal.reason,
  }));
}
