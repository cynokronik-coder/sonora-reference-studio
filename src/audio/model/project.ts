import type { BusState, ProcessorNodeState, ProjectState, TrackState } from './types';

export type ChainScope = 'master' | 'track' | 'bus';

export function cloneProject(project: ProjectState): ProjectState {
  return structuredClone(project);
}

export function findTrack(project: ProjectState, trackId: string | null | undefined): TrackState | undefined {
  if (!trackId) return undefined;
  return project.tracks.find((t) => t.id === trackId);
}

export function findBus(project: ProjectState, busId: string | null | undefined): BusState | undefined {
  if (!busId) return undefined;
  return project.buses.find((b) => b.id === busId);
}

export function chainFor(
  project: ProjectState,
  scope: ChainScope,
  trackId?: string | null,
): ProcessorNodeState[] | undefined {
  if (scope === 'master') return project.master.processors;
  if (scope === 'track') return findTrack(project, trackId)?.processors;
  return findBus(project, trackId)?.processors;
}

export function trackHasSolo(project: ProjectState): boolean {
  return project.tracks.some((t) => t.soloed);
}

export function allAssetIds(project: ProjectState): string[] {
  return [...project.targetAssetIds, ...project.referenceAssetIds];
}

export function trackAssetIds(track: TrackState): string[] {
  return [...new Set(track.clips.map((c) => c.assetId))];
}
