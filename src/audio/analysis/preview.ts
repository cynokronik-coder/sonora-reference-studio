import type { AnalysisReport } from './analyze';
import { BAND_CENTERS, type BandLevel } from './spectrum';
import type { ProjectState } from '../model/types';

/**
 * Tonal preview uses the exact reference selection policy as the match engine:
 * an explicit source index selects one analysed reference; -1 blends all
 * analysed references with the project's relative influence weights.
 */
export function computeMatchPreview(
  project: ProjectState,
  analyses: Record<string, AnalysisReport>,
): { before: number[]; after: number[]; reference: number[]; referenceBands: BandLevel[] } | null {
  const targetId = project.targetAssetIds[0];
  const target = targetId ? analyses[targetId] : undefined;
  if (!target) return null;
  const available = project.referenceAssetIds
    .map((id) => ({ id, report: analyses[id], weight: project.match.referenceWeights?.[id] ?? 100 }))
    .filter((entry) => entry.report);
  if (!available.length) return null;

  const sourceIndex = Math.round(project.match.categorySource?.frequencyBalance ?? -1);
  const selected = sourceIndex < 0
    ? available
    : [available[Math.max(0, Math.min(available.length - 1, sourceIndex))]];
  let weights = selected.map((entry) => sourceIndex < 0 ? Math.max(0, entry.weight) : 1);
  if (weights.every((weight) => weight <= 0)) weights = selected.map(() => 1);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  weights = weights.map((weight) => weight / totalWeight);

  const count = Math.max(...selected.map((entry) => entry.report!.spectrum.bands.length));
  const raw = Array.from({ length: count }, (_, index) => {
    let power = 0;
    let usedWeight = 0;
    selected.forEach((entry, refIndex) => {
      const db = entry.report!.spectrum.bands[index]?.db;
      if (!Number.isFinite(db)) return;
      power += Math.pow(10, db / 10) * weights[refIndex];
      usedWeight += weights[refIndex];
    });
    const db = power > 0 && usedWeight > 0 ? 10 * Math.log10(power / usedWeight) : -120;
    const center = selected.find((entry) => entry.report!.spectrum.bands[index])?.report!.spectrum.bands[index].center ?? BAND_CENTERS[index] ?? 0;
    return { center, db, relativeDb: 0 };
  });
  const averageDb = raw.reduce((sum, band) => sum + band.db, 0) / Math.max(1, raw.length);
  raw.forEach((band) => { band.relativeDb = band.db - averageDb; });

  const source = target.spectrum.bands;
  const before = source.map((band) => band.relativeDb);
  const scale = Math.pow((project.match.intensity / 100), 1.25) * (project.match.frequencyBalance / 100);
  const reference = raw.map((band) => band.relativeDb);
  const after = before.map((value, index) => value + ((reference[index] ?? value) - value) * scale);
  return { before, after, reference, referenceBands: raw };
}
