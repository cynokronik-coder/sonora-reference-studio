import type { ProcessorNodeState, ProjectState } from './types';
import type { ParamValues } from '../dsp/types';
import { clamp } from '../dsp/util';

export const CURRENT_GATE_STATE_VERSION = 2;

export function currentProcessorStateVersion(type: string): number {
  return type === 'gate' ? CURRENT_GATE_STATE_VERSION : 1;
}

export function migrateLegacyGateParams(params: ParamValues): ParamValues {
  const migrated = { ...params };
  if (!Number.isFinite(params.ratio)) migrated.ratio = 4;
  if (!Number.isFinite(params.knee)) migrated.knee = 0;
  if (!Number.isFinite(params.curve)) migrated.curve = 1;
  if (!Number.isFinite(params.link)) migrated.link = 100;
  if (!Number.isFinite(params.output)) migrated.output = 0;
  return migrated;
}

function migrateProcessorNode(node: ProcessorNodeState): boolean {
  if (node.type !== 'gate' || (Number.isFinite(node.version) && node.version >= CURRENT_GATE_STATE_VERSION)) {
    return false;
  }
  node.params = migrateLegacyGateParams(node.params);
  node.version = CURRENT_GATE_STATE_VERSION;
  return true;
}

/** Migrates persisted processor nodes in the project and its saved master versions. */
export function migrateProjectProcessorNodes(project: ProjectState): boolean {
  let changed = false;
  const chains = [
    project.master.processors,
    ...project.tracks.map((track) => track.processors),
    ...project.buses.map((bus) => bus.processors),
    ...project.masters.map((master) => master.processors),
  ];
  for (const chain of chains) {
    for (const node of chain) changed = migrateProcessorNode(node) || changed;
  }
  return changed;
}
