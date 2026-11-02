import type { AudioProcessor, ParamValues, ProcessorMeter } from './types';
import { createProcessor } from './registry';

export interface ChainNodeConfig {
  id: string;
  type: string;
  enabled: boolean;
  params: ParamValues;
}

/**
 * A serial processor chain that reconciles against a declarative config.
 *
 * Instances are reused by id, so dragging a processor or changing a knob does
 * not reset filter state or produce clicks. Removing a node disposes it; nothing
 * else in the chain is rebuilt.
 */
export class ProcessorChain {
  private nodes: { config: ChainNodeConfig; processor: AudioProcessor }[] = [];
  private byId = new Map<string, AudioProcessor>();
  private keyConfig = new Map<string, string>();
  private sr = 48000;
  private maxBlock = 512;
  private sidechains = new Map<string, { L: Float32Array | null; R: Float32Array | null }>();
  private order: string[] = [];

  constructor(sampleRate = 48000, maxBlock = 512) {
    this.sr = sampleRate;
    this.maxBlock = maxBlock;
  }

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = sampleRate;
    this.maxBlock = maxBlock;
    for (const node of this.nodes) node.processor.prepare(sampleRate, maxBlock);
  }

  /** Sync the chain to a new configuration. */
  update(configs: ChainNodeConfig[]): void {
    const seen = new Set<string>();
    const next: { config: ChainNodeConfig; processor: AudioProcessor }[] = [];
    for (const config of configs) {
      seen.add(config.id);
      let processor = this.byId.get(config.id);
      if (!processor) {
        processor = createProcessor(config.type);
        processor.prepare(this.sr, this.maxBlock);
        this.byId.set(config.id, processor);
        this.keyConfig.delete(config.id);
      } else if (this.byId.get(config.id)?.type !== config.type) {
        processor = createProcessor(config.type);
        processor.prepare(this.sr, this.maxBlock);
        this.byId.set(config.id, processor);
        this.keyConfig.delete(config.id);
      }
      const key = `${config.type}|${JSON.stringify(config.params)}`;
      if (this.keyConfig.get(config.id) !== key) {
        processor.setValues(config.params);
        this.keyConfig.set(config.id, key);
      }
      next.push({ config, processor });
    }
    // Dispose removed processors.
    for (const id of this.byId.keys()) {
      if (!seen.has(id)) this.byId.delete(id);
    }
    this.nodes = next;
    this.order = next.map((n) => n.config.id);
  }

  setParams(id: string, params: ParamValues): void {
    const node = this.nodes.find((n) => n.config.id === id);
    if (!node) return;
    node.config.params = params;
    node.processor.setValues(params);
    this.keyConfig.set(id, `${node.config.type}|${JSON.stringify(params)}`);
  }

  setSidechain(id: string, L: Float32Array | null, R: Float32Array | null): void {
    this.sidechains.set(id, { L, R });
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    for (const node of this.nodes) {
      if (!node.config.enabled) continue;
      const key = this.sidechains.get(node.config.id);
      if (key && node.processor.setSidechain) {
        node.processor.setSidechain(key.L, key.R);
      }
      node.processor.process(L, R, n);
    }
  }

  reset(): void {
    for (const node of this.nodes) node.processor.reset();
  }

  get latency(): number {
    let sum = 0;
    for (const node of this.nodes) if (node.config.enabled) sum += node.processor.latency;
    return sum;
  }

  meters(): Record<string, ProcessorMeter> {
    const out: Record<string, ProcessorMeter> = {};
    for (const node of this.nodes) out[node.config.id] = node.processor.meter();
    return out;
  }

  get nodeIds(): string[] {
    return [...this.order];
  }

  has(type: string): boolean {
    return this.nodes.some((n) => n.config.type === type);
  }

  node(type: string): AudioProcessor | undefined {
    return this.nodes.find((n) => n.config.type === type)?.processor;
  }
}
