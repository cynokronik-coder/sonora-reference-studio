import { Biquad } from '../biquad';
import { DbBallistics } from '../envelope';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain, gainToDb } from '../util';

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
  private ballistics = new DbBallistics(48000, 10, 100);
  private scFilter = new Biquad();
  private rmsState = 0;
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
  private makeup = 1;
  private mix = 1;

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = sampleRate;
    const maxDelay = Math.ceil(sampleRate * 0.021) + 4;
    this.delayL = new Float32Array(maxDelay);
    this.delayR = new Float32Array(maxDelay);
    this.delayIndex = 0;
    this.ballistics.setTimes(10, 100, sampleRate);
    this.scFilter.configure('highpass', 120, 0, 0.707, sampleRate);
    void maxBlock;
  }

  setValues(values: ParamValues): void {
    this.values = values;
    const style = Math.round(values.style ?? 0);
    this.style = style;
    const behavior = STYLE_BEHAVIOR[style] ?? STYLE_BEHAVIOR[0];
    const attack = (values.attack ?? 10) * behavior.attackScale;
    const release = (values.release ?? 100) * behavior.releaseScale;
    this.ballistics.setTimes(attack, release, this.sr);
    this.scFilter.configure('highpass', clamp(values.scHpf ?? 120, 20, 1000), 0, 0.707, this.sr);
    const threshold = values.threshold ?? -20;
    const ratio = (values.ratio ?? 4) * behavior.ratioScale;
    const auto = (values.autoMakeup ?? 0) > 0.5;
    const manual = values.makeup ?? 0;
    const autoDb = auto && ratio > 1 ? -threshold * (1 - 1 / ratio) * 0.7 : 0;
    this.makeup = dbToGain(manual + autoDb);
    const mixPct = clamp(values.mix ?? 100, 0, 100);
    this.mix = mixPct / 100;
    this.delaySamples = Math.round(clamp(values.lookahead ?? 0, 0, 20) * 0.001 * this.sr);
  }

  setSidechain(L: Float32Array | null, R: Float32Array | null): void {
    this.sidechainL = L;
    this.sidechainR = R;
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    if (this.delayL.length === 0) this.prepare(this.sr, n);
    const threshold = this.values.threshold ?? -20;
    const ratio = Math.max(1, (this.values.ratio ?? 4) * (STYLE_BEHAVIOR[this.style] ? STYLE_BEHAVIOR[this.style].ratioScale : 1));
    const knee = Math.max(0, (this.values.knee ?? 6) * (STYLE_BEHAVIOR[this.style]?.kneeScale ?? 1));
    const behavior = STYLE_BEHAVIOR[this.style] ?? STYLE_BEHAVIOR[0];
    const link = clamp((this.values.link ?? 100) / 100, 0, 1);
    const useExternal = this.sidechainL !== null && this.sidechainR !== null;
    const rmsMix = behavior.detectorRms;
    const rmsCoeff = 1 - Math.exp(-1 / (0.01 * this.sr));
    const delayLen = this.delayL.length;
    const delay = this.delaySamples;
    let maxGr = 0;

    for (let i = 0; i < n; i++) {
      const scL = useExternal ? this.sidechainL![i] : L[i];
      const scR = useExternal ? this.sidechainR![i] : R[i];
      const filteredL = this.scFilter.process(scL);
      const filteredR = this.scFilter.process(scR);

      let detect = Math.max(Math.abs(filteredL), Math.abs(filteredR));
      if (rmsMix > 0) {
        this.rmsState += ((filteredL * filteredL + filteredR * filteredR) * 0.5 - this.rmsState) * rmsCoeff;
        const rms = Math.sqrt(Math.max(0, this.rmsState));
        detect = detect * (1 - rmsMix) + rms * rmsMix;
      }
      if (link < 1) {
        // Partial linking keeps some independent movement between channels.
        const l = Math.abs(filteredL);
        const r = Math.abs(filteredR);
        detect = detect * link + Math.max(l, r) * (1 - link) * 0 + detect * (1 - link);
      }

      const levelDb = gainToDb(Math.max(detect, 1e-7));
      const over = levelDb - threshold;
      let target = 0;
      if (over > 0) {
        if (knee > 0 && over < knee) {
          target = ((1 - 1 / ratio) * over * over) / (2 * knee);
        } else {
          target = (1 - 1 / ratio) * over;
        }
      }
      const gr = this.ballistics.process(target);
      if (gr > maxGr) maxGr = gr;
      this.grDb = gr;
      const gain = dbToGain(-gr) * this.makeup;

      this.delayL[this.delayIndex] = L[i];
      this.delayR[this.delayIndex] = R[i];
      let readIndex = this.delayIndex - delay;
      if (readIndex < 0) readIndex += delayLen;
      const dryL = this.delayL[readIndex];
      const dryR = this.delayR[readIndex];
      let wetL = dryL * gain;
      let wetR = dryR * gain;
      if (this.mix < 1) {
        wetL = wetL * this.mix + dryL * (1 - this.mix);
        wetR = wetR * this.mix + dryR * (1 - this.mix);
      }
      L[i] = wetL;
      R[i] = wetR;
      const al = Math.abs(wetL);
      const ar = Math.abs(wetR);
      if (al > this.peakL) this.peakL = al;
      if (ar > this.peakR) this.peakR = ar;
      this.delayIndex = (this.delayIndex + 1) % delayLen;
    }

    // Decay meter peaks at block rate.
    this.peakL *= 0.98;
    this.peakR *= 0.98;
  }

  reset(): void {
    this.delayL.fill(0);
    this.delayR.fill(0);
    this.delayIndex = 0;
    this.ballistics.reset();
    this.scFilter.reset();
    this.grDb = 0;
    this.rmsState = 0;
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
