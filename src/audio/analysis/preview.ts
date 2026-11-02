import type { AnalysisReport } from './analyze';
import { BAND_CENTERS } from './spectrum';
import type { ProjectState } from '../model/types';

/**
 * Lightweight tonal preview: target vs the dominant reference, as relative band
 * levels. The full plan generation produces the actual EQ proposals; this is
 * only used for the compact comparison chart beside the category controls.
 */
export function computeMatchPreview(
  project: ProjectState,
  analyses: Record<string, AnalysisReport>,
): { before: number[]; after: number[] } | null {
  const targetId = project.targetAssetIds[0];
  const target = targetId ? analyses[targetId] : undefined;
  if (!target) return null;
  const reference = project.referenceAssetIds.map((id) => analyses[id]).find(Boolean);
  const source = target.spectrum.bands;
  const before = source.map((b) => b.relativeDb);
  if (!reference) {
    return { before, after: before };
  }
  const referenceBands = reference.spectrum.bands;
  const scale = (project.match.intensity / 100) * (project.match.frequencyBalance / 100);
  const after = before.map((value, i) => {
    const diff = (referenceBands[i]?.relativeDb ?? value) - value;
    return value + diff * Math.pow(scale, 1.25);
  });
  void BAND_CENTERS;
  return { before, after };
}
