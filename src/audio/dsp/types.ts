/** Parameter and processor contracts shared by the whole DSP layer. */

export type ProcessorCategory =
  | 'utility'
  | 'eq'
  | 'dynamics'
  | 'saturation'
  | 'stereo'
  | 'time'
  | 'vocal'
  | 'mastering';

export interface ParamSpec {
  key: string;
  label: string;
  kind: 'float' | 'enum' | 'bool';
  min?: number;
  max?: number;
  step?: number;
  default: number;
  unit?: string;
  options?: string[];
  group?: string;
  advanced?: boolean;
  /** Mark parameters that map to frequency for log-scaled sliders. */
  scale?: 'linear' | 'log';
  precision?: number;
}

export type ParamValues = Record<string, number>;

export interface ProcessorMeter {
  /** Gain reduction in dB (positive number). */
  reduction?: number;
  /** Instantaneous output peak per channel. */
  peakL?: number;
  peakR?: number;
  /** Detected dynamic band gains, used by dynamic EQ displays. */
  bands?: number[];
  /** Gain added by the processor, for level meters. */
  gain?: number;
}

export interface AudioProcessor {
  readonly type: string;
  prepare(sampleRate: number, maxBlock: number): void;
  setValues(values: ParamValues): void;
  process(L: Float32Array, R: Float32Array, n: number): void;
  reset(): void;
  meter(): ProcessorMeter;
  /** Optional external key signal, same block length as the audio. */
  setSidechain?(L: Float32Array | null, R: Float32Array | null): void;
  /** Reported latency in samples (linear-phase EQ). */
  readonly latency: number;
}

export interface ProcessorDefinition {
  type: string;
  name: string;
  shortName: string;
  category: ProcessorCategory;
  description: string;
  /** One-line explanation shown in the rack and used by the assistant. */
  purpose: string;
  params: ParamSpec[];
  create(): AudioProcessor;
}

export function paramValue(values: ParamValues, key: string, spec: ParamSpec): number {
  const v = values[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : spec.default;
}

export function defaultValueMap(def: ProcessorDefinition): ParamValues {
  const out: ParamValues = {};
  for (const p of def.params) out[p.key] = p.default;
  return out;
}

export function enumOption(def: ProcessorDefinition, key: string, values: ParamValues): string {
  const spec = def.params.find((p) => p.key === key);
  if (!spec || !spec.options) return '';
  const idx = Math.round(paramValue(values, key, spec));
  return spec.options[Math.max(0, Math.min(spec.options.length - 1, idx))];
}
