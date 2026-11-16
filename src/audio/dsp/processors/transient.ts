import { EnvelopeFollower } from '../envelope';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain } from '../util';

function finiteValue(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

/**
 * Transient shaper. Fast and slow envelopes estimate transient difference and
 * sustained body independently for each channel before applying bounded gain.
 */
export class TransientShaper implements AudioProcessor {
  readonly type = 'transient';
  readonly latency = 0;
  private sr = 48000;
  private values: ParamValues = {};
  private fastL = new EnvelopeFollower(48000, 0.4, 30);
  private fastR = new EnvelopeFollower(48000, 0.4, 30);
  private slowL = new EnvelopeFollower(48000, 25, 180);
  private slowR = new EnvelopeFollower(48000, 25, 180);
  private gainL = 1;
  private gainR = 1;
  private mix = 1;
  private outputGain = 1;
  private stereoLink = 1;
  private peakL = 0;
  private peakR = 0;

  prepare(sampleRate: number): void {
    this.sr = sampleRate;
    this.fastL = new EnvelopeFollower(sampleRate, 0.4, 30);
    this.fastR = new EnvelopeFollower(sampleRate, 0.4, 30);
    this.slowL = new EnvelopeFollower(sampleRate, 25, 180);
    this.slowR = new EnvelopeFollower(sampleRate, 25, 180);
  }

  setValues(values: ParamValues): void {
    this.values = values;
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    const attackDb = clamp(finiteValue(this.values.attack, 0), -100, 100) * 0.12;
    const sustainDb = clamp(finiteValue(this.values.sustain, 0), -100, 100) * 0.06;
    const sensitivity = clamp(finiteValue(this.values.sensitivity, 50), 0, 100) / 100;
    const targetMix = clamp(finiteValue(this.values.mix, 100), 0, 100) / 100;
    const targetOutput = dbToGain(clamp(finiteValue(this.values.output, 0), -18, 18));
    const targetLink = clamp(finiteValue(this.values.link, 100), 0, 100) / 100;
    const controlSmooth = 1 - Math.exp(-1 / (0.02 * this.sr));
    const gainSmooth = 1 - Math.exp(-1 / (0.0008 * this.sr));

    for (let i = 0; i < n; i++) {
      const inputL = L[i];
      const inputR = R[i];
      this.mix += (targetMix - this.mix) * controlSmooth;
      this.outputGain += (targetOutput - this.outputGain) * controlSmooth;
      this.stereoLink += (targetLink - this.stereoLink) * controlSmooth;

      const fastL = this.fastL.process(inputL);
      const fastR = this.fastR.process(inputR);
      const slowL = this.slowL.process(inputL);
      const slowR = this.slowR.process(inputR);
      const linkedFast = Math.max(fastL, fastR);
      const linkedSlow = Math.max(slowL, slowR);
      const channelFastL = fastL + (linkedFast - fastL) * this.stereoLink;
      const channelFastR = fastR + (linkedFast - fastR) * this.stereoLink;
      const channelSlowL = slowL + (linkedSlow - slowL) * this.stereoLink;
      const channelSlowR = slowR + (linkedSlow - slowR) * this.stereoLink;

      const transientL = Math.max(0, channelFastL - channelSlowL * (1 - sensitivity * 0.3)) / (channelFastL + 1e-6);
      const transientR = Math.max(0, channelFastR - channelSlowR * (1 - sensitivity * 0.3)) / (channelFastR + 1e-6);
      const bodyL = channelSlowL / (channelSlowL + 0.02);
      const bodyR = channelSlowR / (channelSlowR + 0.02);
      const targetGainL = dbToGain(clamp(attackDb * transientL + sustainDb * bodyL, -18, 18));
      const targetGainR = dbToGain(clamp(attackDb * transientR + sustainDb * bodyR, -18, 18));
      this.gainL += (targetGainL - this.gainL) * gainSmooth;
      this.gainR += (targetGainR - this.gainR) * gainSmooth;

      const wetL = inputL * this.gainL * this.outputGain;
      const wetR = inputR * this.gainR * this.outputGain;
      L[i] = inputL + (wetL - inputL) * this.mix;
      R[i] = inputR + (wetR - inputR) * this.mix;
      const absL = Math.abs(L[i]);
      const absR = Math.abs(R[i]);
      if (absL > this.peakL) this.peakL = absL;
      if (absR > this.peakR) this.peakR = absR;
    }
    this.peakL *= 0.97;
    this.peakR *= 0.97;
  }

  reset(): void {
    this.fastL.reset();
    this.fastR.reset();
    this.slowL.reset();
    this.slowR.reset();
    this.gainL = 1;
    this.gainR = 1;
    this.mix = clamp(finiteValue(this.values.mix, 100), 0, 100) / 100;
    this.outputGain = dbToGain(clamp(finiteValue(this.values.output, 0), -18, 18));
    this.stereoLink = clamp(finiteValue(this.values.link, 100), 0, 100) / 100;
    this.peakL = 0;
    this.peakR = 0;
  }

  meter(): ProcessorMeter {
    return { peakL: this.peakL, peakR: this.peakR, gain: Math.max(this.gainL, this.gainR) };
  }
}

export const transientDefinition: ProcessorDefinition = {
  type: 'transient',
  name: 'Transient Shaper',
  shortName: 'TRANSIENT',
  category: 'dynamics',
  description: 'Independent envelope-differential attack and sustain shaping with stereo linking.',
  purpose: 'Adds punch to drums or softens pick noise and plucks without changing the overall level.',
  params: [
    { key: 'attack', label: 'Attack', kind: 'float', min: -100, max: 100, step: 1, default: 0, unit: '%' },
    { key: 'sustain', label: 'Sustain', kind: 'float', min: -100, max: 100, step: 1, default: 0, unit: '%' },
    { key: 'sensitivity', label: 'Sensitivity', kind: 'float', min: 0, max: 100, step: 1, default: 50, unit: '%', advanced: true },
    { key: 'link', label: 'Stereo link', kind: 'float', min: 0, max: 100, step: 1, default: 100, unit: '%' },
    { key: 'mix', label: 'Dry/wet', kind: 'float', min: 0, max: 100, step: 1, default: 100, unit: '%' },
    { key: 'output', label: 'Output', kind: 'float', min: -18, max: 18, step: 0.1, default: 0, unit: 'dB' },
  ],
  create: () => new TransientShaper(),
};
