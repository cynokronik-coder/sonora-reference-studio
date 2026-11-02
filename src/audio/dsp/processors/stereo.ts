import { Lr4Crossover } from '../crossover';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain } from '../util';

/**
 * Stereo image processor: frequency-dependent width, mono-maker, mid/side
 * trims, balance and a Haas widener.
 *
 * Width is applied to the side component per frequency band, so the low end can
 * stay mono while the top widens. Haas widening is deliberately explicit (with
 * its own mix) because it trades mono compatibility for width.
 */
export class StereoProcessor implements AudioProcessor {
  readonly type = 'stereo';
  readonly latency = 0;
  private sr = 48000;
  private values: ParamValues = {};
  private xover = new Lr4Crossover(48000);
  private lowL = new Float32Array(512);
  private lowR = new Float32Array(512);
  private midL = new Float32Array(512);
  private midR = new Float32Array(512);
  private highL = new Float32Array(512);
  private highR = new Float32Array(512);
  private haasBuffer = new Float32Array(0);
  private haasIndex = 0;
  private lastSplit = 0;
  private peakL = 0;
  private peakR = 0;

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = sampleRate;
    this.xover.prepare(sampleRate, maxBlock);
    this.lowL = new Float32Array(maxBlock);
    this.lowR = new Float32Array(maxBlock);
    this.midL = new Float32Array(maxBlock);
    this.midR = new Float32Array(maxBlock);
    this.highL = new Float32Array(maxBlock);
    this.highR = new Float32Array(maxBlock);
    this.haasBuffer = new Float32Array(Math.ceil(sampleRate * 0.05));
    this.haasIndex = 0;
  }

  setValues(values: ParamValues): void {
    this.values = values;
    const split = values.split ?? 180;
    if (Math.abs(split - this.lastSplit) > 1) {
      this.xover.configure(this.sr, split, Math.max(split * 2.2, 4000));
      this.lastSplit = split;
    }
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    const width = clamp((this.values.width ?? 100) / 100, 0, 2);
    const lowWidth = clamp((this.values.lowWidth ?? 0) / 100, 0, 2);
    const highWidth = clamp((this.values.highWidth ?? 100) / 100, 0, 2);
    const monoMaker = (this.values.monoMaker ?? 0) > 0.5;
    const balance = clamp((this.values.balance ?? 0) / 100, -1, 1);
    const midGain = dbToGain(this.values.midGain ?? 0);
    const sideGain = dbToGain(this.values.sideGain ?? 0);
    const haasMs = clamp(this.values.haas ?? 0, 0, 40);
    const haasMix = clamp((this.values.haasMix ?? 0) / 100, 0, 1);
    const out = dbToGain(this.values.output ?? 0);

    this.xover.split(L, R, n, {
      lowL: this.lowL, lowR: this.lowR,
      midL: this.midL, midR: this.midR,
      highL: this.highL, highR: this.highR,
    });

    const gainL = balance <= 0 ? 1 : 1 - balance;
    const gainR = balance >= 0 ? 1 : 1 + balance;
    const haasSamples = Math.round((haasMs / 1000) * this.sr);
    const haasLen = this.haasBuffer.length;

    for (let i = 0; i < n; i++) {
      const lowM = (this.lowL[i] + this.lowR[i]) * 0.5;
      const lowS = ((this.lowL[i] - this.lowR[i]) * 0.5) * (monoMaker ? 0 : lowWidth) * width;
      const midM = (this.midL[i] + this.midR[i]) * 0.5;
      const midS = ((this.midL[i] - this.midR[i]) * 0.5) * highWidth * width;
      const highM = (this.highL[i] + this.highR[i]) * 0.5;
      const highS = ((this.highL[i] - this.highR[i]) * 0.5) * highWidth * width;

      let m = (lowM + midM + highM) * midGain;
      let s = (lowS + midS + highS) * sideGain;

      let l = (m + s) * gainL;
      let r = (m - s) * gainR;

      if (haasSamples > 0 && haasMix > 0) {
        this.haasBuffer[this.haasIndex] = r;
        let readIdx = this.haasIndex - haasSamples;
        if (readIdx < 0) readIdx += haasLen;
        const delayed = this.haasBuffer[readIdx];
        this.haasIndex = (this.haasIndex + 1) % haasLen;
        r = r * (1 - haasMix) + delayed * haasMix;
      }

      L[i] = l * out;
      R[i] = r * out;
      const al = Math.abs(L[i]);
      const ar = Math.abs(R[i]);
      if (al > this.peakL) this.peakL = al;
      if (ar > this.peakR) this.peakR = ar;
    }
    this.peakL *= 0.97;
    this.peakR *= 0.97;
  }

  reset(): void {
    this.xover.reset();
    this.haasBuffer.fill(0);
    this.haasIndex = 0;
  }

  meter(): ProcessorMeter {
    return { peakL: this.peakL, peakR: this.peakR };
  }
}

export const stereoDefinition: ProcessorDefinition = {
  type: 'stereo',
  name: 'Stereo Imaging',
  shortName: 'STEREO',
  category: 'stereo',
  description: 'Frequency-dependent width, mono-maker, mid/side trims, balance and a Haas widener.',
  purpose: 'Matches the stereo image of a reference while keeping bass mono and mono compatibility intact.',
  params: [
    { key: 'width', label: 'Width', kind: 'float', min: 0, max: 200, step: 1, default: 100, unit: '%' },
    { key: 'lowWidth', label: 'Low width', kind: 'float', min: 0, max: 200, step: 1, default: 0, unit: '%', group: 'Frequency' },
    { key: 'highWidth', label: 'High width', kind: 'float', min: 0, max: 200, step: 1, default: 100, unit: '%', group: 'Frequency' },
    { key: 'split', label: 'Split', kind: 'float', min: 60, max: 800, step: 1, default: 180, unit: 'Hz', scale: 'log', group: 'Frequency' },
    { key: 'monoMaker', label: 'Force mono below split', kind: 'bool', default: 1, group: 'Frequency' },
    { key: 'midGain', label: 'Mid gain', kind: 'float', min: -12, max: 12, step: 0.1, default: 0, unit: 'dB', advanced: true, group: 'Mid/Side' },
    { key: 'sideGain', label: 'Side gain', kind: 'float', min: -12, max: 12, step: 0.1, default: 0, unit: 'dB', advanced: true, group: 'Mid/Side' },
    { key: 'balance', label: 'Balance', kind: 'float', min: -100, max: 100, step: 1, default: 0, unit: '%', advanced: true, group: 'Mid/Side' },
    { key: 'haas', label: 'Haas delay', kind: 'float', min: 0, max: 40, step: 0.1, default: 0, unit: 'ms', advanced: true, group: 'Haas' },
    { key: 'haasMix', label: 'Haas mix', kind: 'float', min: 0, max: 100, step: 1, default: 0, unit: '%', advanced: true, group: 'Haas' },
    { key: 'output', label: 'Output', kind: 'float', min: -18, max: 18, step: 0.1, default: 0, unit: 'dB', group: 'Output' },
  ],
  create: () => new StereoProcessor(),
};
