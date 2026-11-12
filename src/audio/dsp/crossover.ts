import { Biquad } from './biquad';

interface CrossoverStage {
  lp1: Biquad[];
  hp1: Biquad[];
  lp2: Biquad[];
  hp2: Biquad[];
}

/**
 * Linkwitz-Riley 4th-order three-band crossover.
 *
 * LR4 is two cascaded Butterworth 2nd-order sections, giving a flat summed
 * magnitude at the crossover without a polarity flip. This is the standard
 * topology for multiband dynamics and frequency-dependent stereo width.
 */
export class Lr4Crossover {
  private channels: CrossoverStage[] = [];
  private sr = 48000;
  private lowFreq = 200;
  private highFreq = 4000;
  private maxBlock = 2048;

  constructor(sampleRate = 48000) {
    for (let ch = 0; ch < 2; ch++) {
      this.channels.push({
        lp1: [new Biquad(), new Biquad()],
        hp1: [new Biquad(), new Biquad()],
        lp2: [new Biquad(), new Biquad()],
        hp2: [new Biquad(), new Biquad()],
      });
    }
    this.configure(sampleRate, 200, 4000);
  }

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = sampleRate;
    this.maxBlock = maxBlock;
    this.reset();
    this.configure(sampleRate, this.lowFreq, this.highFreq);
  }

  configure(sampleRate: number, lowFreq: number, highFreq: number): void {
    this.sr = sampleRate;
    const maxLow = sampleRate * 0.4;
    const maxHigh = sampleRate * 0.45;
    const requestedLow = Number.isFinite(lowFreq) ? lowFreq : 200;
    const requestedHigh = Number.isFinite(highFreq) ? highFreq : 4000;
    this.lowFreq = Math.max(30, Math.min(requestedLow, maxLow));
    this.highFreq = Math.max(this.lowFreq + 20, Math.min(requestedHigh, maxHigh));
    for (let channel = 0; channel < this.channels.length; channel++) {
      const stage = this.channels[channel];
      stage.lp1[0].configure('lowpass', this.lowFreq, 0, 0.7071, sampleRate);
      stage.lp1[1].configure('lowpass', this.lowFreq, 0, 0.7071, sampleRate);
      stage.hp1[0].configure('highpass', this.lowFreq, 0, 0.7071, sampleRate);
      stage.hp1[1].configure('highpass', this.lowFreq, 0, 0.7071, sampleRate);
      stage.lp2[0].configure('lowpass', this.highFreq, 0, 0.7071, sampleRate);
      stage.lp2[1].configure('lowpass', this.highFreq, 0, 0.7071, sampleRate);
      stage.hp2[0].configure('highpass', this.highFreq, 0, 0.7071, sampleRate);
      stage.hp2[1].configure('highpass', this.highFreq, 0, 0.7071, sampleRate);
    }
  }

  reset(): void {
    for (const stage of this.channels) {
      for (const b of stage.lp1) b.reset();
      for (const b of stage.hp1) b.reset();
      for (const b of stage.lp2) b.reset();
      for (const b of stage.hp2) b.reset();
    }
  }

  /** Split a stereo block into low, mid and high band buffers. */
  split(
    L: Float32Array,
    R: Float32Array,
    n: number,
    out: {
      lowL: Float32Array;
      lowR: Float32Array;
      midL: Float32Array;
      midR: Float32Array;
      highL: Float32Array;
      highR: Float32Array;
    },
  ): void {
    for (let ch = 0; ch < 2; ch++) {
      const stage = this.channels[ch];
      const src = ch === 0 ? L : R;
      const low = ch === 0 ? out.lowL : out.lowR;
      const mid = ch === 0 ? out.midL : out.midR;
      const high = ch === 0 ? out.highL : out.highR;
      for (let i = 0; i < n; i++) {
        const x = src[i];
        low[i] = stage.lp1[1].process(stage.lp1[0].process(x));
        const hp = stage.hp1[1].process(stage.hp1[0].process(x));
        mid[i] = stage.lp2[1].process(stage.lp2[0].process(hp));
        high[i] = stage.hp2[1].process(stage.hp2[0].process(hp));
      }
    }
  }

  get lowCutoff(): number {
    return this.lowFreq;
  }

  get highCutoff(): number {
    return this.highFreq;
  }

  get maxBlockSize(): number {
    return this.maxBlock;
  }

  get sampleRate(): number {
    return this.sr;
  }
}
