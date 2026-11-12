import { Biquad, type BiquadCoeffs } from '../biquad';
import { DbBallistics } from '../envelope';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain, gainToDb } from '../util';

const RESONANCE_BANDS = 3;
const DEFAULT_FREQUENCIES = [3000, 5500, 8000] as const;
const NOTCH_SMOOTH_MS = 6;
const SHAPE_SMOOTH_MS = 20;
const IDENTITY: BiquadCoeffs = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

interface ResBand {
  detectorL: Biquad;
  detectorR: Biquad;
  filterL: Biquad;
  filterR: Biquad;
  ballisticsL: DbBallistics;
  ballisticsR: DbBallistics;
  ballisticsLinked: DbBallistics;
  reductionL: number;
  reductionR: number;
  lastFreq: number;
  lastQ: number;
  lastGainL: number;
  lastGainR: number;
  active: boolean;
}

export class ResonanceSuppressor implements AudioProcessor {
  readonly type = 'resonance';
  readonly latency = 0;
  private sr = 48000;
  private maxBlock = 512;
  private values: ParamValues = {};
  private bands: ResBand[] = [];
  private dryL = new Float32Array(512);
  private dryR = new Float32Array(512);
  private stereoLinkBuffer = new Float32Array(512);
  private bandReduction = [0, 0, 0];
  private stereoLink = 1;
  private stereoLinkTarget = 1;
  private stereoLinkStep = 0;
  private stereoLinkRemaining = 0;
  private mix = 1;
  private mixTarget = 1;
  private mixStep = 0;
  private mixRemaining = 0;
  private outputGain = 1;
  private outputGainTarget = 1;
  private outputGainStep = 0;
  private outputGainRemaining = 0;

  constructor() {
    for (let i = 0; i < RESONANCE_BANDS; i++) {
      this.bands.push({
        detectorL: new Biquad(),
        detectorR: new Biquad(),
        filterL: new Biquad(),
        filterR: new Biquad(),
        ballisticsL: new DbBallistics(48000, 2, 60),
        ballisticsR: new DbBallistics(48000, 2, 60),
        ballisticsLinked: new DbBallistics(48000, 2, 60),
        reductionL: 0,
        reductionR: 0,
        lastFreq: 0,
        lastQ: 0,
        lastGainL: Number.NaN,
        lastGainR: Number.NaN,
        active: false,
      });
    }
  }

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = sampleRate;
    this.maxBlock = Math.max(1, Math.floor(maxBlock));
    this.dryL = new Float32Array(this.maxBlock);
    this.dryR = new Float32Array(this.maxBlock);
    this.stereoLinkBuffer = new Float32Array(this.maxBlock);
    for (const band of this.bands) {
      band.ballisticsL = new DbBallistics(sampleRate, 2, 60);
      band.ballisticsR = new DbBallistics(sampleRate, 2, 60);
      band.ballisticsLinked = new DbBallistics(sampleRate, 2, 60);
    }
    this.reset();
  }

  setValues(values: ParamValues): void {
    this.values = values;
    const nextLink = clamp((values.link ?? 100) / 100, 0, 1);
    if (nextLink !== this.stereoLinkTarget) {
      this.stereoLinkTarget = nextLink;
      this.stereoLinkRemaining = Math.max(1, Math.round(this.sr * SHAPE_SMOOTH_MS / 1000));
      this.stereoLinkStep = (nextLink - this.stereoLink) / this.stereoLinkRemaining;
    }

    const nextMix = clamp((values.mix ?? 100) / 100, 0, 1);
    if (nextMix !== this.mixTarget) {
      this.mixTarget = nextMix;
      this.mixRemaining = Math.max(1, Math.round(this.sr * 0.02));
      this.mixStep = (nextMix - this.mix) / this.mixRemaining;
    }

    const nextOutput = dbToGain(clamp(values.output ?? 0, -12, 12));
    if (nextOutput !== this.outputGainTarget) {
      this.outputGainTarget = nextOutput;
      this.outputGainRemaining = Math.max(1, Math.round(this.sr * 0.02));
      this.outputGainStep = (nextOutput - this.outputGain) / this.outputGainRemaining;
    }
  }

  private updateNotch(band: ResBand, channel: 'L' | 'R', frequency: number, q: number, reduction: number): void {
    const filter = channel === 'L' ? band.filterL : band.filterR;
    const previousGain = channel === 'L' ? band.lastGainL : band.lastGainR;
    const gainDb = -reduction;
    if (!Number.isFinite(previousGain) || (Math.abs(gainDb - previousGain) >= 0.05 && !filter.isSmoothing)) {
      if (reduction > 0.01) {
        filter.configureSmoothed('peak', frequency, gainDb, q, this.sr, Math.max(1, Math.round(this.sr * NOTCH_SMOOTH_MS / 1000)));
      } else {
        filter.setSmoothed(IDENTITY, Math.max(1, Math.round(this.sr * NOTCH_SMOOTH_MS / 1000)));
      }
      if (channel === 'L') band.lastGainL = gainDb;
      else band.lastGainR = gainDb;
    }
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    if (!Number.isInteger(n) || n < 0 || n > this.dryL.length || n > L.length || n > R.length) {
      throw new RangeError(`Resonance suppressor block length ${n} exceeds its prepared buffers`);
    }

    for (let i = 0; i < n; i++) {
      this.dryL[i] = L[i];
      this.dryR[i] = R[i];
      if (this.stereoLinkRemaining > 0) {
        this.stereoLink += this.stereoLinkStep;
        this.stereoLinkRemaining--;
        if (this.stereoLinkRemaining === 0) this.stereoLink = this.stereoLinkTarget;
      }
      this.stereoLinkBuffer[i] = this.stereoLink;
    }

    const sensitivity = clamp(this.values.sensitivity ?? 50, 0, 100);
    const maxRange = clamp(this.values.range ?? 9, 0, 24);
    const attack = clamp(this.values.attack ?? 2, 0.1, 100);
    const release = clamp(this.values.release ?? 60, 10, 1000);
    const thresholdOffset = (sensitivity - 50) * 0.25;
    const shapeSamples = Math.max(1, Math.round(this.sr * SHAPE_SMOOTH_MS / 1000));
    const notchSamples = Math.max(1, Math.round(this.sr * NOTCH_SMOOTH_MS / 1000));

    for (let bandIndex = 0; bandIndex < RESONANCE_BANDS; bandIndex++) {
      const band = this.bands[bandIndex];
      if ((this.values[`b${bandIndex}_on`] ?? (bandIndex === 0 ? 1 : 0)) < 0.5) {
        this.bandReduction[bandIndex] = 0;
        band.reductionL = 0;
        band.reductionR = 0;
        band.detectorL.reset();
        band.detectorR.reset();
        band.ballisticsL.reset();
        band.ballisticsR.reset();
        band.ballisticsLinked.reset();
        if (band.active) {
          band.filterL.setSmoothed(IDENTITY, notchSamples);
          band.filterR.setSmoothed(IDENTITY, notchSamples);
          band.lastGainL = 0;
          band.lastGainR = 0;
          band.active = false;
        }
        if (band.filterL.isSmoothing || band.filterR.isSmoothing) {
          for (let i = 0; i < n; i++) {
            L[i] = band.filterL.process(L[i]);
            R[i] = band.filterR.process(R[i]);
          }
        }
        continue;
      }

      const frequency = clamp(
        this.values[`b${bandIndex}_freq`] ?? DEFAULT_FREQUENCIES[bandIndex],
        80,
        Math.min(16000, this.sr * 0.45),
      );
      const q = clamp(this.values[`b${bandIndex}_q`] ?? 8, 1, 30);
      const threshold = clamp(this.values[`b${bandIndex}_threshold`] ?? -34, -60, 0) - thresholdOffset;
      band.ballisticsL.setTimes(attack, release, this.sr);
      band.ballisticsR.setTimes(attack, release, this.sr);
      band.ballisticsLinked.setTimes(attack, release, this.sr);

      if (Math.abs(frequency - band.lastFreq) >= 0.5 || Math.abs(q - band.lastQ) >= 0.005) {
        band.detectorL.configureSmoothed('bandpass', frequency, 0, q, this.sr, shapeSamples);
        band.detectorR.configureSmoothed('bandpass', frequency, 0, q, this.sr, shapeSamples);
        band.filterL.configureSmoothed('peak', frequency, -band.reductionL, q, this.sr, shapeSamples);
        band.filterR.configureSmoothed('peak', frequency, -band.reductionR, q, this.sr, shapeSamples);
        band.lastFreq = frequency;
        band.lastQ = q;
        band.lastGainL = -band.reductionL;
        band.lastGainR = -band.reductionR;
      }
      band.active = true;

      let maximumReduction = 0;
      for (let i = 0; i < n; i++) {
        const detectedL = Math.abs(band.detectorL.process(this.dryL[i])) * 2;
        const detectedR = Math.abs(band.detectorR.process(this.dryR[i])) * 2;
        const linked = Math.max(detectedL, detectedR);
        const stereoLink = this.stereoLinkBuffer[i];
        const keyL = detectedL + (linked - detectedL) * stereoLink;
        const keyR = detectedR + (linked - detectedR) * stereoLink;
        const targetL = Math.min(maxRange, Math.max(0, gainToDb(Math.max(keyL, 1e-7)) - threshold) * 0.85);
        const targetR = Math.min(maxRange, Math.max(0, gainToDb(Math.max(keyR, 1e-7)) - threshold) * 0.85);
        const independentL = band.ballisticsL.process(targetL);
        const independentR = band.ballisticsR.process(targetR);
        const shared = band.ballisticsLinked.process(Math.max(targetL, targetR));
        band.reductionL = stereoLink >= 0.999 ? shared : independentL;
        band.reductionR = stereoLink >= 0.999 ? shared : independentR;
        maximumReduction = Math.max(maximumReduction, band.reductionL, band.reductionR);

        this.updateNotch(band, 'L', frequency, q, band.reductionL);
        this.updateNotch(band, 'R', frequency, q, band.reductionR);
        L[i] = band.filterL.process(L[i]);
        R[i] = band.filterR.process(R[i]);
      }
      this.bandReduction[bandIndex] = maximumReduction;
    }

    for (let i = 0; i < n; i++) {
      if (this.mixRemaining > 0) {
        this.mix += this.mixStep;
        this.mixRemaining--;
        if (this.mixRemaining === 0) this.mix = this.mixTarget;
      }
      if (this.outputGainRemaining > 0) {
        this.outputGain += this.outputGainStep;
        this.outputGainRemaining--;
        if (this.outputGainRemaining === 0) this.outputGain = this.outputGainTarget;
      }
      const wetL = L[i] * this.outputGain;
      const wetR = R[i] * this.outputGain;
      L[i] = this.dryL[i] * (1 - this.mix) + wetL * this.mix;
      R[i] = this.dryR[i] * (1 - this.mix) + wetR * this.mix;
    }
  }

  reset(): void {
    for (const band of this.bands) {
      band.detectorL.reset();
      band.detectorR.reset();
      band.filterL.reset();
      band.filterR.reset();
      band.filterL.set(IDENTITY);
      band.filterR.set(IDENTITY);
      band.ballisticsL.reset();
      band.ballisticsR.reset();
      band.ballisticsLinked.reset();
      band.reductionL = 0;
      band.reductionR = 0;
      band.lastFreq = 0;
      band.lastQ = 0;
      band.lastGainL = Number.NaN;
      band.lastGainR = Number.NaN;
      band.active = false;
    }
    this.bandReduction.fill(0);
    this.stereoLink = this.stereoLinkTarget;
    this.stereoLinkRemaining = 0;
    this.mix = this.mixTarget;
    this.mixRemaining = 0;
    this.outputGain = this.outputGainTarget;
    this.outputGainRemaining = 0;
  }

  meter(): ProcessorMeter {
    let reduction = 0;
    for (const band of this.bandReduction) reduction = Math.max(reduction, band);
    return { reduction, bands: this.bandReduction.map((value) => -value) };
  }
}

export const resonanceDefinition: ProcessorDefinition = {
  type: 'resonance',
  name: 'Resonance Suppressor',
  shortName: 'RESO',
  category: 'dynamics',
  description: 'Three high-Q dynamic notches with independent stereo detection, stereo linking and true dry/wet blending.',
  purpose: 'Reduces narrow resonant peaks only when they become dominant, without permanently cutting the selected frequencies.',
  params: [
    { key: 'sensitivity', label: 'Sensitivity', kind: 'float', min: 0, max: 100, step: 1, default: 50, unit: '%' },
    { key: 'range', label: 'Max cut', kind: 'float', min: 0, max: 24, step: 0.1, default: 9, unit: 'dB' },
    { key: 'attack', label: 'Attack', kind: 'float', min: 0.1, max: 100, step: 0.1, default: 2, unit: 'ms', group: 'Detection' },
    { key: 'release', label: 'Release', kind: 'float', min: 10, max: 1000, step: 1, default: 60, unit: 'ms', group: 'Detection' },
    { key: 'link', label: 'Stereo link', kind: 'float', min: 0, max: 100, step: 1, default: 100, unit: '%', advanced: true, group: 'Detection' },
    { key: 'b0_on', label: 'Band 1', kind: 'bool', default: 1, group: 'Band 1' },
    { key: 'b0_freq', label: 'Frequency', kind: 'float', min: 80, max: 16000, step: 1, default: 3000, unit: 'Hz', scale: 'log', group: 'Band 1' },
    { key: 'b0_q', label: 'Q', kind: 'float', min: 1, max: 30, step: 0.1, default: 8, group: 'Band 1' },
    { key: 'b0_threshold', label: 'Threshold', kind: 'float', min: -60, max: 0, step: 1, default: -34, unit: 'dB', group: 'Band 1' },
    { key: 'b1_on', label: 'Band 2', kind: 'bool', default: 0, group: 'Band 2' },
    { key: 'b1_freq', label: 'Frequency', kind: 'float', min: 80, max: 16000, step: 1, default: 5500, unit: 'Hz', scale: 'log', group: 'Band 2' },
    { key: 'b1_q', label: 'Q', kind: 'float', min: 1, max: 30, step: 0.1, default: 8, group: 'Band 2' },
    { key: 'b1_threshold', label: 'Threshold', kind: 'float', min: -60, max: 0, step: 1, default: -34, unit: 'dB', group: 'Band 2' },
    { key: 'b2_on', label: 'Band 3', kind: 'bool', default: 0, group: 'Band 3' },
    { key: 'b2_freq', label: 'Frequency', kind: 'float', min: 80, max: 16000, step: 1, default: 8000, unit: 'Hz', scale: 'log', group: 'Band 3' },
    { key: 'b2_q', label: 'Q', kind: 'float', min: 1, max: 30, step: 0.1, default: 8, group: 'Band 3' },
    { key: 'b2_threshold', label: 'Threshold', kind: 'float', min: -60, max: 0, step: 1, default: -34, unit: 'dB', group: 'Band 3' },
    { key: 'mix', label: 'Dry/wet', kind: 'float', min: 0, max: 100, step: 1, default: 100, unit: '%', group: 'Output' },
    { key: 'output', label: 'Output', kind: 'float', min: -12, max: 12, step: 0.1, default: 0, unit: 'dB', group: 'Output' },
  ],
  create: () => new ResonanceSuppressor(),
};

export interface ResonancePreset {
  id: string;
  name: string;
  description: string;
  values: ParamValues;
}

function resonancePreset(id: string, name: string, description: string, overrides: ParamValues): ResonancePreset {
  const values: ParamValues = {};
  for (const param of resonanceDefinition.params) values[param.key] = param.default;
  return { id, name, description, values: { ...values, ...overrides } };
}

export const RESONANCE_PRESETS: ResonancePreset[] = [
  resonancePreset('gentle-resonance-control', 'Gentle resonance control', 'A light first band for a single narrow ring; adjust its frequency to the peak you hear.', {
    sensitivity: 50, range: 4, attack: 6, release: 140, link: 100,
    b0_on: 1, b0_freq: 3200, b0_q: 10, b0_threshold: -30,
    b1_on: 0, b2_on: 0,
  }),
  resonancePreset('vocal-harshness', 'Vocal harshness', 'Targets a harsh upper-mid resonance with a second optional band for a separate whistle.', {
    sensitivity: 52, range: 5, attack: 2, release: 100, link: 100,
    b0_on: 1, b0_freq: 4200, b0_q: 8, b0_threshold: -32,
    b1_on: 1, b1_freq: 6200, b1_q: 12, b1_threshold: -36,
    b2_on: 0,
  }),
  resonancePreset('snare-ring', 'Snare ring', 'A narrow midrange resonance starting point for ringing drum tones.', {
    sensitivity: 48, range: 7, attack: 1, release: 180, link: 100,
    b0_on: 1, b0_freq: 850, b0_q: 14, b0_threshold: -34,
    b1_on: 1, b1_freq: 1700, b1_q: 16, b1_threshold: -38,
    b2_on: 0,
  }),
  resonancePreset('mix-harshness', 'Mix harshness', 'Two restrained upper-frequency bands for intermittent harshness in a full mix.', {
    sensitivity: 52, range: 3.5, attack: 4, release: 120, link: 100,
    b0_on: 1, b0_freq: 3500, b0_q: 7, b0_threshold: -31,
    b1_on: 1, b1_freq: 7200, b1_q: 10, b1_threshold: -35,
    b2_on: 0,
  }),
];
