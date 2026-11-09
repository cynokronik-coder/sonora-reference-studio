import { Lr4Crossover } from '../crossover';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain } from '../util';

interface StereoSplitBuffers {
  lowL: Float32Array;
  lowR: Float32Array;
  midL: Float32Array;
  midR: Float32Array;
  highL: Float32Array;
  highR: Float32Array;
}

export interface StereoPreset {
  id: string;
  name: string;
  description: string;
  values: ParamValues;
}

/**
 * Frequency-dependent stereo image processor.
 *
 * Width is controlled in the M/S domain after an LR4 split. Mono-maker
 * collapses only the low band. Balance, mid/side trims and global output use
 * smoothed gains. Optional Haas widening is an explicit right-channel delay;
 * this is a creative effect with a deliberate mono-compatibility trade-off.
 */
export class StereoProcessor implements AudioProcessor {
  readonly type = 'stereo';
  readonly latency = 0;
  private sr = 48000;
  private maxBlock = 512;
  private values: ParamValues = {};
  private xover = new Lr4Crossover(48000);
  private lowL = new Float32Array(512);
  private lowR = new Float32Array(512);
  private midL = new Float32Array(512);
  private midR = new Float32Array(512);
  private highL = new Float32Array(512);
  private highR = new Float32Array(512);
  private splitBuffers: StereoSplitBuffers = {
    lowL: this.lowL, lowR: this.lowR,
    midL: this.midL, midR: this.midR,
    highL: this.highL, highR: this.highR,
  };
  private haasBuffer = new Float32Array(0);
  private haasIndex = 0;
  private lastSplit = 0;
  private width = 1;
  private widthTarget = 1;
  private widthStep = 0;
  private widthRemaining = 0;
  private lowWidth = 0;
  private lowWidthTarget = 0;
  private lowWidthStep = 0;
  private lowWidthRemaining = 0;
  private highWidth = 1;
  private highWidthTarget = 1;
  private highWidthStep = 0;
  private highWidthRemaining = 0;
  private midGain = 1;
  private midGainTarget = 1;
  private midGainStep = 0;
  private midGainRemaining = 0;
  private sideGain = 1;
  private sideGainTarget = 1;
  private sideGainStep = 0;
  private sideGainRemaining = 0;
  private balance = 0;
  private balanceTarget = 0;
  private balanceStep = 0;
  private balanceRemaining = 0;
  private output = 1;
  private outputTarget = 1;
  private outputStep = 0;
  private outputRemaining = 0;
  private haasMix = 0;
  private haasMixTarget = 0;
  private haasMixStep = 0;
  private haasMixRemaining = 0;
  private monoMaker = true;
  private peakL = 0;
  private peakR = 0;

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = sampleRate;
    this.maxBlock = Math.max(1, maxBlock);
    this.xover.prepare(sampleRate, this.maxBlock);
    this.lowL = new Float32Array(this.maxBlock);
    this.lowR = new Float32Array(this.maxBlock);
    this.midL = new Float32Array(this.maxBlock);
    this.midR = new Float32Array(this.maxBlock);
    this.highL = new Float32Array(this.maxBlock);
    this.highR = new Float32Array(this.maxBlock);
    this.splitBuffers = {
      lowL: this.lowL, lowR: this.lowR,
      midL: this.midL, midR: this.midR,
      highL: this.highL, highR: this.highR,
    };
    this.haasBuffer = new Float32Array(Math.ceil(sampleRate * 0.05) + 1);
    this.haasIndex = 0;
    this.applyTargetsImmediately();
    this.configureSplit(this.values.split ?? 180, true);
    this.reset();
  }

  private ramp(current: number, target: number): { step: number; remaining: number } {
    const remaining = Math.max(1, Math.round(this.sr * 0.02));
    return { step: (target - current) / remaining, remaining };
  }

  private setGainRamp(
    current: number,
    target: number,
    kind: 'width' | 'lowWidth' | 'highWidth' | 'midGain' | 'sideGain' | 'output' | 'haasMix' | 'balance',
  ): void {
    const ramp = this.ramp(current, target);
    switch (kind) {
      case 'width': this.widthTarget = target; this.widthStep = ramp.step; this.widthRemaining = ramp.remaining; break;
      case 'lowWidth': this.lowWidthTarget = target; this.lowWidthStep = ramp.step; this.lowWidthRemaining = ramp.remaining; break;
      case 'highWidth': this.highWidthTarget = target; this.highWidthStep = ramp.step; this.highWidthRemaining = ramp.remaining; break;
      case 'midGain': this.midGainTarget = target; this.midGainStep = ramp.step; this.midGainRemaining = ramp.remaining; break;
      case 'sideGain': this.sideGainTarget = target; this.sideGainStep = ramp.step; this.sideGainRemaining = ramp.remaining; break;
      case 'output': this.outputTarget = target; this.outputStep = ramp.step; this.outputRemaining = ramp.remaining; break;
      case 'haasMix': this.haasMixTarget = target; this.haasMixStep = ramp.step; this.haasMixRemaining = ramp.remaining; break;
      case 'balance': this.balanceTarget = target; this.balanceStep = ramp.step; this.balanceRemaining = ramp.remaining; break;
    }
  }

  private applyTargetsImmediately(): void {
    this.width = this.widthTarget = clamp((this.values.width ?? 100) / 100, 0, 2);
    this.lowWidth = this.lowWidthTarget = clamp((this.values.lowWidth ?? 0) / 100, 0, 2);
    this.highWidth = this.highWidthTarget = clamp((this.values.highWidth ?? 100) / 100, 0, 2);
    this.midGain = this.midGainTarget = dbToGain(clamp(this.values.midGain ?? 0, -12, 12));
    this.sideGain = this.sideGainTarget = dbToGain(clamp(this.values.sideGain ?? 0, -12, 12));
    this.balance = this.balanceTarget = clamp((this.values.balance ?? 0) / 100, -1, 1);
    this.output = this.outputTarget = dbToGain(clamp(this.values.output ?? 0, -18, 18));
    this.haasMix = this.haasMixTarget = clamp((this.values.haasMix ?? 0) / 100, 0, 1);
    this.monoMaker = (this.values.monoMaker ?? 1) > 0.5;
    this.clearRamps();
  }

  private clearRamps(): void {
    this.widthRemaining = 0;
    this.lowWidthRemaining = 0;
    this.highWidthRemaining = 0;
    this.midGainRemaining = 0;
    this.sideGainRemaining = 0;
    this.balanceRemaining = 0;
    this.outputRemaining = 0;
    this.haasMixRemaining = 0;
  }

  private configureSplit(split: number, immediate = false): void {
    const frequency = clamp(split, 60, Math.min(800, this.sr * 0.3));
    if (!immediate && Math.abs(frequency - this.lastSplit) < 0.5) return;
    this.lastSplit = frequency;
    const highSplit = Math.max(frequency * 2.2, 4_000);
    this.xover.configure(
      this.sr,
      frequency,
      Math.min(highSplit, this.sr * 0.45),
      immediate ? 0 : Math.max(1, Math.round(this.sr * 0.02)),
    );
  }

  setValues(values: ParamValues): void {
    const previous = this.values;
    this.values = values;
    this.configureSplit(values.split ?? 180);

    const targets = {
      width: clamp((values.width ?? 100) / 100, 0, 2),
      lowWidth: clamp((values.lowWidth ?? 0) / 100, 0, 2),
      highWidth: clamp((values.highWidth ?? 100) / 100, 0, 2),
      midGain: dbToGain(clamp(values.midGain ?? 0, -12, 12)),
      sideGain: dbToGain(clamp(values.sideGain ?? 0, -12, 12)),
      balance: clamp((values.balance ?? 0) / 100, -1, 1),
      output: dbToGain(clamp(values.output ?? 0, -18, 18)),
      haasMix: clamp((values.haasMix ?? 0) / 100, 0, 1),
    };
    const current = {
      width: this.widthTarget,
      lowWidth: this.lowWidthTarget,
      highWidth: this.highWidthTarget,
      midGain: this.midGainTarget,
      sideGain: this.sideGainTarget,
      balance: this.balanceTarget,
      output: this.outputTarget,
      haasMix: this.haasMixTarget,
    };
    for (const key of Object.keys(targets) as Array<keyof typeof targets>) {
      if (targets[key] !== current[key]) {
        this.setGainRamp(this[key], targets[key], key);
      }
    }
    this.monoMaker = (values.monoMaker ?? 1) > 0.5;
    void previous;
  }

  private advanceRamps(): void {
    if (this.widthRemaining > 0) { this.width += this.widthStep; if (--this.widthRemaining === 0) this.width = this.widthTarget; }
    if (this.lowWidthRemaining > 0) { this.lowWidth += this.lowWidthStep; if (--this.lowWidthRemaining === 0) this.lowWidth = this.lowWidthTarget; }
    if (this.highWidthRemaining > 0) { this.highWidth += this.highWidthStep; if (--this.highWidthRemaining === 0) this.highWidth = this.highWidthTarget; }
    if (this.midGainRemaining > 0) { this.midGain += this.midGainStep; if (--this.midGainRemaining === 0) this.midGain = this.midGainTarget; }
    if (this.sideGainRemaining > 0) { this.sideGain += this.sideGainStep; if (--this.sideGainRemaining === 0) this.sideGain = this.sideGainTarget; }
    if (this.balanceRemaining > 0) { this.balance += this.balanceStep; if (--this.balanceRemaining === 0) this.balance = this.balanceTarget; }
    if (this.outputRemaining > 0) { this.output += this.outputStep; if (--this.outputRemaining === 0) this.output = this.outputTarget; }
    if (this.haasMixRemaining > 0) { this.haasMix += this.haasMixStep; if (--this.haasMixRemaining === 0) this.haasMix = this.haasMixTarget; }
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    if (n > this.maxBlock) throw new RangeError(`Stereo imaging block size ${n} exceeds prepared capacity ${this.maxBlock}`);

    const haasSamples = Math.round(clamp(this.values.haas ?? 0, 0, 40) * 0.001 * this.sr);
    const haasLength = this.haasBuffer.length;

    this.xover.split(L, R, n, this.splitBuffers);

    let peakL = 0;
    let peakR = 0;
    for (let i = 0; i < n; i++) {
      this.advanceRamps();
      const lowM = (this.lowL[i] + this.lowR[i]) * 0.5;
      const lowS = ((this.lowL[i] - this.lowR[i]) * 0.5) * (this.monoMaker ? 0 : this.lowWidth) * this.width;
      const midM = (this.midL[i] + this.midR[i]) * 0.5;
      const midS = ((this.midL[i] - this.midR[i]) * 0.5) * this.highWidth * this.width;
      const highM = (this.highL[i] + this.highR[i]) * 0.5;
      const highS = ((this.highL[i] - this.highR[i]) * 0.5) * this.highWidth * this.width;

      const mid = (lowM + midM + highM) * this.midGain;
      const side = (lowS + midS + highS) * this.sideGain;
      const gainL = this.balance <= 0 ? 1 : 1 - this.balance;
      const gainR = this.balance >= 0 ? 1 : 1 + this.balance;
      let left = (mid + side) * gainL;
      let right = (mid - side) * gainR;

      // Keep the Haas history rolling even when the effect is disabled. Turning
      // it back on then reads recent programme audio rather than stale samples.
      let delayedRight = 0;
      if (haasSamples > 0) {
        let readIndex = this.haasIndex - haasSamples;
        if (readIndex < 0) readIndex += haasLength;
        delayedRight = this.haasBuffer[readIndex];
      }
      this.haasBuffer[this.haasIndex] = right;
      this.haasIndex = (this.haasIndex + 1) % haasLength;
      if (haasSamples > 0 && this.haasMix > 0) {
        right = right * (1 - this.haasMix) + delayedRight * this.haasMix;
      }

      L[i] = left * this.output;
      R[i] = right * this.output;
      peakL = Math.max(peakL, Math.abs(L[i]));
      peakR = Math.max(peakR, Math.abs(R[i]));
    }

    this.peakL = Math.max(peakL, this.peakL * 0.97);
    this.peakR = Math.max(peakR, this.peakR * 0.97);
  }

  reset(): void {
    this.xover.reset();
    this.haasBuffer.fill(0);
    this.haasIndex = 0;
    this.clearRamps();
    this.applyTargetsImmediately();
    this.peakL = 0;
    this.peakR = 0;
  }

  meter(): ProcessorMeter {
    return { peakL: this.peakL, peakR: this.peakR };
  }
}

function stereoPreset(id: string, name: string, description: string, overrides: ParamValues): StereoPreset {
  const values: ParamValues = {};
  for (const param of stereoDefinition.params) values[param.key] = param.default;
  return { id, name, description, values: { ...values, ...overrides } };
}

export const stereoDefinition: ProcessorDefinition = {
  type: 'stereo',
  name: 'Stereo Imaging',
  shortName: 'STEREO',
  category: 'stereo',
  description: 'Frequency-dependent M/S width, low-frequency mono control, stereo balance and optional Haas widening.',
  purpose: 'Shapes the stereo field while keeping low-frequency mono compatibility explicit and allowing output comparison.',
  params: [
    { key: 'width', label: 'Global width', kind: 'float', min: 0, max: 200, step: 1, default: 100, unit: '%' },
    { key: 'lowWidth', label: 'Low-band width', kind: 'float', min: 0, max: 200, step: 1, default: 0, unit: '%', group: 'Frequency' },
    { key: 'highWidth', label: 'Above-split width', kind: 'float', min: 0, max: 200, step: 1, default: 100, unit: '%', group: 'Frequency' },
    { key: 'split', label: 'Low-band split', kind: 'float', min: 60, max: 800, step: 1, default: 180, unit: 'Hz', scale: 'log', group: 'Frequency' },
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

export const STEREO_PRESETS: StereoPreset[] = [
  stereoPreset('mono-safe-low-end', 'Mono-safe low end', 'Collapses only the low band to mono while keeping the upper stereo field intact.', {
    width: 100, lowWidth: 0, highWidth: 100, split: 180, monoMaker: 1, sideGain: 0,
  }),
  stereoPreset('wide-highs', 'Wide highs', 'Expands the upper stereo band while leaving low frequencies centered.', {
    width: 100, lowWidth: 0, highWidth: 150, split: 200, monoMaker: 1, sideGain: 0,
  }),
  stereoPreset('narrower-mix', 'Narrower mix', 'Reduces side energy for a tighter image and improved mono compatibility.', {
    width: 80, lowWidth: 0, highWidth: 80, split: 180, monoMaker: 1, sideGain: -1,
  }),
  stereoPreset('gentle-width', 'Gentle width', 'A subtle, broad stereo-width adjustment without Haas delay.', {
    width: 110, lowWidth: 0, highWidth: 105, split: 160, monoMaker: 1,
  }),
  stereoPreset('haas-creative', 'Haas creative', 'A clearly audible delay-based widening effect; check mono compatibility and localization.', {
    width: 100, lowWidth: 0, highWidth: 100, split: 180, monoMaker: 1, haas: 12, haasMix: 35,
  }),
  stereoPreset('mono-check', 'Mono check', 'Collapses all frequency bands to mono for a compatibility audition.', {
    width: 0, lowWidth: 0, highWidth: 0, monoMaker: 1, haas: 0, haasMix: 0,
  }),
];
