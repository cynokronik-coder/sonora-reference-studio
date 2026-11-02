import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { dbToGain, SmoothedValue } from '../util';

/**
 * Trim / routing utility. Every track and the master bus use this node for
 * gain staging, polarity, mono fold-down and balance. It is deliberately
 * simple, but it is real: the fader you see is this gain, applied in the DSP
 * graph, not a CSS volume slider.
 */
export class GainProcessor implements AudioProcessor {
  readonly type = 'gain';
  readonly latency = 0;
  private sr = 48000;
  private values: ParamValues = {};
  private gain = new SmoothedValue(1, 8, 48000);
  private panL = new SmoothedValue(1, 8, 48000);
  private panR = new SmoothedValue(1, 8, 48000);
  private meterL = 0;
  private meterR = 0;

  prepare(sampleRate: number): void {
    this.sr = sampleRate;
    this.gain.setTimeConstant(8, sampleRate);
    this.panL.setTimeConstant(8, sampleRate);
    this.panR.setTimeConstant(8, sampleRate);
  }

  setValues(values: ParamValues): void {
    this.values = values;
    const inputDb = values.input ?? 0;
    const outputDb = values.output ?? 0;
    const pan = (values.pan ?? 0) / 100;
    const polarity = (values.polarity ?? 0) > 0.5 ? -1 : 1;
    const total = dbToGain(inputDb + outputDb) * polarity;
    this.gain.set(total);
    // Constant-power pan law.
    const angle = ((pan + 1) * Math.PI) / 4;
    this.panL.set(Math.cos(angle) * Math.SQRT2);
    this.panR.set(Math.sin(angle) * Math.SQRT2);
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    const mono = (this.values.mono ?? 0) > 0.5;
    let peakL = 0;
    let peakR = 0;
    for (let i = 0; i < n; i++) {
      const g = this.gain.next();
      const pl = this.panL.next();
      const pr = this.panR.next();
      let l = L[i] * g * pl;
      let r = R[i] * g * pr;
      if (mono) {
        const m = (l + r) * 0.5;
        l = m;
        r = m;
      }
      L[i] = l;
      R[i] = r;
      const al = Math.abs(l);
      const ar = Math.abs(r);
      if (al > peakL) peakL = al;
      if (ar > peakR) peakR = ar;
    }
    this.meterL = peakL;
    this.meterR = peakR;
  }

  reset(): void {
    this.gain.snap(dbToGain((this.values.input ?? 0) + (this.values.output ?? 0)));
    this.meterL = 0;
    this.meterR = 0;
  }

  meter(): ProcessorMeter {
    return { peakL: this.meterL, peakR: this.meterR };
  }
}

export const gainDefinition: ProcessorDefinition = {
  type: 'gain',
  name: 'Gain / Routing',
  shortName: 'GAIN',
  category: 'utility',
  description: 'Input trim, output trim, polarity, pan and mono fold-down.',
  purpose: 'Sets the level entering the next processor without changing timbre.',
  params: [
    { key: 'input', label: 'Input', kind: 'float', min: -24, max: 24, step: 0.1, default: 0, unit: 'dB' },
    { key: 'output', label: 'Output', kind: 'float', min: -24, max: 24, step: 0.1, default: 0, unit: 'dB' },
    { key: 'pan', label: 'Pan', kind: 'float', min: -100, max: 100, step: 1, default: 0, unit: '%' },
    { key: 'polarity', label: 'Invert phase', kind: 'bool', default: 0, advanced: true },
    { key: 'mono', label: 'Mono', kind: 'bool', default: 0, advanced: true },
  ],
  create: () => new GainProcessor(),
};
