import type { AudioProcessor, ParamSpec, ParamValues, ProcessorCategory, ProcessorDefinition } from './types';
import { defaultValueMap } from './types';
import { gainDefinition } from './processors/gain';
import { eqDefinition } from './processors/eq';
import { dynamicEqDefinition } from './processors/dynamicEq';
import { compressorDefinition } from './processors/compressor';
import { multibandCompDefinition } from './processors/multiband';
import { deEsserDefinition } from './processors/deesser';
import { transientDefinition } from './processors/transient';
import { gateDefinition } from './processors/gate';
import { saturationDefinition } from './processors/saturation';
import { exciterDefinition } from './processors/exciter';
import { stereoDefinition } from './processors/stereo';
import { reverbDefinition } from './processors/reverb';
import { delayDefinition } from './processors/delay';
import { limiterDefinition, clipperDefinition } from './processors/limiter';
import { resonanceDefinition } from './processors/resonance';

/**
 * Central registry. Adding a processor means implementing AudioProcessor and
 * registering its definition here — the rack UI, automation, presets, export
 * and the AI assistant all read their capabilities from this list.
 */
export const PROCESSOR_DEFINITIONS: ProcessorDefinition[] = [
  gainDefinition,
  eqDefinition,
  dynamicEqDefinition,
  compressorDefinition,
  multibandCompDefinition,
  deEsserDefinition,
  transientDefinition,
  gateDefinition,
  saturationDefinition,
  exciterDefinition,
  stereoDefinition,
  reverbDefinition,
  delayDefinition,
  resonanceDefinition,
  clipperDefinition,
  limiterDefinition,
];

const REGISTRY = new Map<string, ProcessorDefinition>(PROCESSOR_DEFINITIONS.map((d) => [d.type, d]));

export function getDefinition(type: string): ProcessorDefinition | undefined {
  return REGISTRY.get(type);
}

export function requireDefinition(type: string): ProcessorDefinition {
  const def = REGISTRY.get(type);
  if (!def) throw new Error(`Unknown processor type: ${type}`);
  return def;
}

export function createProcessor(type: string): AudioProcessor {
  return requireDefinition(type).create();
}

export function createDefaultParams(type: string): ParamValues {
  return defaultValueMap(requireDefinition(type));
}

export function categories(): ProcessorCategory[] {
  return [...new Set(PROCESSOR_DEFINITIONS.map((d) => d.category))];
}

export function definitionsByCategory(category: ProcessorCategory): ProcessorDefinition[] {
  return PROCESSOR_DEFINITIONS.filter((d) => d.category === category);
}

export function findParam(type: string, key: string): ParamSpec | undefined {
  return getDefinition(type)?.params.find((p) => p.key === key);
}

/** Clamp a value to its parameter spec (used by the assistant and automation). */
export function clampParam(type: string, key: string, value: number): number {
  const spec = findParam(type, key);
  if (!spec) return value;
  if (spec.kind === 'bool') return value > 0.5 ? 1 : 0;
  if (spec.kind === 'enum') {
    const max = (spec.options?.length ?? 1) - 1;
    return Math.max(0, Math.min(max, Math.round(value)));
  }
  const min = spec.min ?? -Infinity;
  const max = spec.max ?? Infinity;
  return Math.max(min, Math.min(max, value));
}

/** Human-readable parameter formatting shared by rack, AI and analysis. */
export function formatParam(spec: ParamSpec, value: number): string {
  if (spec.kind === 'bool') return value > 0.5 ? 'On' : 'Off';
  if (spec.kind === 'enum') return spec.options?.[Math.round(value)] ?? String(value);
  const unit = spec.unit ?? '';
  const digits = spec.step !== undefined && spec.step < 0.1 ? 2 : spec.step !== undefined && spec.step < 1 ? 1 : 0;
  const rounded = Number.isInteger(value) ? value : Number(value.toFixed(digits));
  return `${rounded}${unit ? ` ${unit}` : ''}`;
}

export const TEMPORAL_PROCESSORS = new Set(['reverb', 'delay']);
export const MASTERING_ORDER = ['gain', 'eq', 'dynamicEq', 'compressor', 'multibandComp', 'saturation', 'stereo', 'clipper', 'limiter'];
