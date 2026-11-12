import { Biquad } from '../biquad';
import { DbBallistics } from '../envelope';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain, gainToDb, SmoothedValue } from '../util';

export const COMPRESSOR_STYLES = ['VCA (clean)', 'FET (aggressive)', 'Optical (smooth)', 'Vari-mu (glue)', 'Bus (slow)'] as const;

interface StyleBehavior {
  attackScale: number;
  releaseScale: number;
  kneeScale: number;
  ratioScale: number;
  detectorRms: number;
}

const STYLE_BEHAVIOR: StyleBehavior[] = [
  { attackScale: 1, releaseScale: 1, kneeScale: 1, ratioScale: 1, detectorRms: 0 },
  { attackScale: 0.55, releaseScale: 1.15, kneeScale: 0.45, ratioScale: 1.2, detectorRms: 0 },
  { attackScale: 1.8, releaseScale: 1.45, kneeScale: 1.35, ratioScale: 0.95, detectorRms: 0.35 },
  { attackScale: 2.4, releaseScale: 1.25, kneeScale: 1.7, ratioScale: 0.85, detectorRms: 0.6 },
  { attackScale: 2.0, releaseScale: 1.1, kneeScale: 1.5, ratioScale: 0.9, detectorRms: 0.2 },
];

const finiteOr = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) ? value : fallback;

/**
 * Feed-forward compressor with a soft knee, program-style behaviours, an
 * optional sidechain key and a true dry/wet mix.
 *
 * Detection runs on the (optionally filtered or external) key signal, while the
 * audio is delayed by the lookahead amount so transients are caught before they
 * pass. Gain reduction is applied in dB, which is what makes the ratio behave
 * like a real compressor rather than a soft clipper.
 */
export class Compressor implements AudioProcessor {
  readonly type = 'compressor';
  readonly latency = 0;
  private sr = 48000;
  private values: ParamValues = {};
  private ballisticsL = new DbBallistics(48000, 10, 100);
  private ballisticsR = new DbBallistics(48000, 10, 100);
  private scFilterL = new Biquad();
  private scFilterR = new Biquad();
  private rmsStateL = 0;
  private rmsStateR = 0;
  private grDb = 0;
  private delayL: Float32Array = new Float32Array(0);
  private delayR: Float32Array = new Float32Array(0);
  private delayIndex = 0;
  private delaySamples = 0;
  private sidechainL: Float32Array | null = null;
  private sidechainR: Float32Array | null = null;
  private peakL = 0;
  private peakR = 0;
  private style = 0;
  private readonly linkSmooth = new SmoothedValue(1, 10, 48000);
  private readonly makeupSmooth = new SmoothedValue(1, 10, 48000);
  private readonly mixSmooth = new SmoothedValue(1, 10, 48000);

  get gainReductionDb(): number {
    return this.grDb;
  }

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = sampleRate;
    const maxDelay = Math.ceil(sampleRate * 0.021) + 4;
    this.delayL = new Float32Array(maxDelay);
    this.delayR = new Float32Array(maxDelay);
    this.delayIndex = 0;
    this.ballisticsL.setTimes(10, 100, sampleRate);
    this.ballisticsR.setTimes(10, 100, sampleRate);
    this.scFilterL.configure('highpass', 120, 0, 0.707, sampleRate);
    this.scFilterR.configure('highpass', 120, 0, 0.707, sampleRate);
    this.linkSmooth.setTimeConstant(10, sampleRate);
    this.makeupSmooth.setTimeConstant(10, sampleRate);
    this.mixSmooth.setTimeConstant(10, sampleRate);
    void maxBlock;
  }

  setValues(values: ParamValues): void {
    this.values = values;
    this.style = Math.round(clamp(finiteOr(values.style, 0), 0, STYLE_BEHAVIOR.length - 1));
    const behavior = STYLE_BEHAVIOR[this.style];
    const attack = clamp(finiteOr(values.attack, 10), 0.1, 200) * behavior.attackScale;
    const release = clamp(finiteOr(values.release, 100), 10, 2000) * behavior.releaseScale;
    this.ballisticsL.setTimes(attack, release, this.sr);
    this.ballisticsR.setTimes(attack, release, this.sr);
    const sidechainHighPass = clamp(finiteOr(values.scHpf, 120), 20, 1000);
    this.scFilterL.configure('highpass', sidechainHighPass, 0, 0.707, this.sr);
    this.scFilterR.configure('highpass', sidechainHighPass, 0, 0.707, this.sr);
    const threshold = clamp(finiteOr(values.threshold, -20), -60, 0);
    const ratio = clamp(finiteOr(values.ratio, 4), 1, 20) * behavior.ratioScale;
    const auto = finiteOr(values.autoMakeup, 0) > 0.5;
    const manual = clamp(finiteOr(values.makeup, 0), -12, 24);
    const autoDb = auto && ratio > 1 ? -threshold * (1 - 1 / ratio) * 0.7 : 0;
    this.makeupSmooth.set(dbToGain(manual + autoDb));
    this.mixSmooth.set(clamp(finiteOr(values.mix, 100), 0, 100) / 100);
    this.linkSmooth.set(clamp(finiteOr(values.link, 100), 0, 100) / 100);
    this.delaySamples = Math.round(clamp(finiteOr(values.lookahead, 0), 0, 20) * 0.001 * this.sr);
  }

  setSidechain(L: Float32Array | null, R: Float32Array | null): void {
    if (L !== this.sidechainL || R !== this.sidechainR) {
      this.scFilterL.reset();
      this.scFilterR.reset();
    }
    this.sidechainL = L;
    this.sidechainR = R;
  }

  private targetReduction(detector: number, threshold: number, ratio: number, knee: number): number {
    const over = gainToDb(Math.max(detector, 1e-7)) - threshold;
    if (over <= 0) return 0;
    if (knee > 0 && over < knee) {
      return ((1 - 1 / ratio) * over * over) / (2 * knee);
    }
    return (1 - 1 / ratio) * over;
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    if (this.delayL.length === 0) this.prepare(this.sr, n);
    const behavior = STYLE_BEHAVIOR[this.style] ?? STYLE_BEHAVIOR[0];
    const threshold = clamp(finiteOr(this.values.threshold, -20), -60, 0);
    const ratio = Math.max(1, clamp(finiteOr(this.values.ratio, 4), 1, 20) * behavior.ratioScale);
    const knee = Math.max(0, clamp(finiteOr(this.values.knee, 6), 0, 24) * behavior.kneeScale);
    const useExternal = this.sidechainL !== null && this.sidechainR !== null;
    const rmsMix = behavior.detectorRms;
    const rmsCoeff = 1 - Math.exp(-1 / (0.01 * this.sr));
    const delayLen = this.delayL.length;
    const delay = this.delaySamples;

    for (let i = 0; i < n; i++) {
      const scL = useExternal ? this.sidechainL![i] ?? 0 : L[i];
      const scR = useExternal ? this.sidechainR![i] ?? 0 : R[i];
      const filteredL = this.scFilterL.process(scL);
      const filteredR = this.scFilterR.process(scR);

      const peakL = Math.abs(filteredL);
      const peakR = Math.abs(filteredR);
      let detectL = peakL;
      let detectR = peakR;
      let linkedDetector = Math.max(peakL, peakR);
      if (rmsMix > 0) {
        this.rmsStateL += (filteredL * filteredL - this.rmsStateL) * rmsCoeff;
        this.rmsStateR += (filteredR * filteredR - this.rmsStateR) * rmsCoeff;
        const rmsL = Math.sqrt(Math.max(0, this.rmsStateL));
        const rmsR = Math.sqrt(Math.max(0, this.rmsStateR));
        detectL = detectL * (1 - rmsMix) + rmsL * rmsMix;
        detectR = detectR * (1 - rmsMix) + rmsR * rmsMix;
        const linkedRms = Math.sqrt(Math.max(0, (this.rmsStateL + this.rmsStateR) * 0.5));
        linkedDetector = linkedDetector * (1 - rmsMix) + linkedRms * rmsMix;
      }

      const link = this.linkSmooth.next();
      detectL += (linkedDetector - detectL) * link;
      detectR += (linkedDetector - detectR) * link;
      const grL = this.ballisticsL.process(this.targetReduction(detectL, threshold, ratio, knee));
      const grR = this.ballisticsR.process(this.targetReduction(detectR, threshold, ratio, knee));
      this.grDb = Math.max(grL, grR);
      const makeup = this.makeupSmooth.next();
      const mix = this.mixSmooth.next();
      const gainL = dbToGain(-grL) * makeup;
      const gainR = dbToGain(-grR) * makeup;

      this.delayL[this.delayIndex] = L[i];
      this.delayR[this.delayIndex] = R[i];
      let readIndex = this.delayIndex - delay;
      if (readIndex < 0) readIndex += delayLen;
      const dryL = this.delayL[readIndex];
      const dryR = this.delayR[readIndex];
      const wetL = dryL * gainL;
      const wetR = dryR * gainR;
      L[i] = wetL * mix + dryL * (1 - mix);
      R[i] = wetR * mix + dryR * (1 - mix);
      const al = Math.abs(L[i]);
      const ar = Math.abs(R[i]);
      if (al > this.peakL) this.peakL = al;
      if (ar > this.peakR) this.peakR = ar;
      this.delayIndex = (this.delayIndex + 1) % delayLen;
    }

    this.peakL *= 0.98;
    this.peakR *= 0.98;
  }

  reset(): void {
    this.delayL.fill(0);
    this.delayR.fill(0);
    this.delayIndex = 0;
    this.ballisticsL.reset();
    this.ballisticsR.reset();
    this.scFilterL.reset();
    this.scFilterR.reset();
    this.grDb = 0;
    this.rmsStateL = 0;
    this.rmsStateR = 0;
  }

  meter(): ProcessorMeter {
    return { reduction: this.grDb, peakL: this.peakL, peakR: this.peakR };
  }
}

export const compressorDefinition: ProcessorDefinition = {
  type: 'compressor',
  name: 'Compressor',
  shortName: 'COMP',
  category: 'dynamics',
  description: 'Feed-forward compressor with soft knee, five behaviour styles, sidechain filter, lookahead and dry/wet mix.',
  purpose: 'Controls dynamic range, tightens levels and adds density. Reference Match uses it when crest factor or LRA differs from the reference.',
  params: [
    { key: 'threshold', label: 'Threshold', kind: 'float', min: -60, max: 0, step: 0.1, default: -18, unit: 'dB', group: 'Dynamics' },
    { key: 'ratio', label: 'Ratio', kind: 'float', min: 1, max: 20, step: 0.1, default: 3, unit: ':1', group: 'Dynamics' },
    { key: 'attack', label: 'Attack', kind: 'float', min: 0.1, max: 200, step: 0.1, default: 15, unit: 'ms', group: 'Dynamics' },
    { key: 'release', label: 'Release', kind: 'float', min: 10, max: 2000, step: 1, default: 140, unit: 'ms', group: 'Dynamics' },
    { key: 'knee', label: 'Knee', kind: 'float', min: 0, max: 24, step: 0.1, default: 6, unit: 'dB', group: 'Dynamics' },
    { key: 'lookahead', label: 'Lookahead', kind: 'float', min: 0, max: 20, step: 0.1, default: 0, unit: 'ms', advanced: true, group: 'Detection' },
    { key: 'style', label: 'Character', kind: 'enum', options: [...COMPRESSOR_STYLES], default: 0, group: 'Character' },
    { key: 'scHpf', label: 'Sidechain filter', kind: 'float', min: 20, max: 1000, step: 1, default: 120, unit: 'Hz', advanced: true, group: 'Detection', scale: 'log' },
    { key: 'link', label: 'Stereo link', kind: 'float', min: 0, max: 100, step: 1, default: 100, unit: '%', advanced: true, group: 'Detection' },
    { key: 'makeup', label: 'Makeup', kind: 'float', min: -12, max: 24, step: 0.1, default: 0, unit: 'dB', group: 'Output' },
    { key: 'autoMakeup', label: 'Auto makeup', kind: 'bool', default: 0, advanced: true, group: 'Output' },
    { key: 'mix', label: 'Dry/wet', kind: 'float', min: 0, max: 100, step: 1, default: 100, unit: '%', group: 'Output' },
  ],
  create: () => new Compressor(),
};
