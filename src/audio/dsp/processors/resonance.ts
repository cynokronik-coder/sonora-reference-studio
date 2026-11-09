import { Biquad, designBiquad, type BiquadCoeffs } from '../biquad';
import { DbBallistics } from '../envelope';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain, gainToDb } from '../util';

const RESONANCE_BANDS = 3;
const NOTCH_SMOOTH_MS = 6;
const PASSTHROUGH: BiquadCoeffs = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

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
  private bandReduction = [0, 0, 0];
  private outputGain = 1;
  private outputGainTarget = 1;
  private outputGainStep = 0;
  private outputGainRemaining = 0;
  private mix = 1;
  private mixTarget = 1;
  private mixStep = 0;
  private mixRemaining = 0;

  constructor() {
    for (let i = 0; i < RESONANCE_BANDS; i++) {
      this.bands.push({
        detectorL: new Biquad(),
        detectorR: new Biquad(),
        filterL: new Biquad(),
        filterR: new Biquad(),
        ballisticsL: new DbBallistics(48000, 5, 120),
        ballisticsR: new DbBallistics(48000, 5, 120),
        ballisticsLinked: new DbBallistics(48000, 5, 120),
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
    this.maxBlock = Math.max(1, maxBlock);
    this.dryL = new Float32Array(this.maxBlock);
    this.dryR = new Float32Array(this.maxBlock);
    for (const band of this.bands) {
      band.ballisticsL = new DbBallistics(sampleRate, 5, 120);
      band.ballisticsR = new DbBallistics(sampleRate, 5, 120);
      band.ballisticsLinked = new DbBallistics(sampleRate, 5, 120);
    }
    this.reset();
  }

  setValues(values: ParamValues): void {
    this.values = values;
    const nextGain = dbToGain(clamp(values.output ?? 0, -12, 12));
    if (nextGain !== this.outputGainTarget) {
      this.outputGainTarget = nextGain;
      this.outputGainRemaining = Math.max(1, Math.round(this.sr * 0.02));
      this.outputGainStep = (nextGain - this.outputGain) / this.outputGainRemaining;
    }
    const nextMix = clamp((values.mix ?? 100) / 100, 0, 1);
    if (nextMix !== this.mixTarget) {
      this.mixTarget = nextMix;
      this.mixRemaining = Math.max(1, Math.round(this.sr * 0.02));
      this.mixStep = (nextMix - this.mix) / this.mixRemaining;
    }
  }

  private updateNotch(band: ResBand, channel: 'L' | 'R', frequency: number, q: number, reduction: number): void {
    const filter = channel === 'L' ? band.filterL : band.filterR;
    const previousGain = channel === 'L' ? band.lastGainL : band.lastGainR;
    const gainDb = -reduction;
    if (!Number.isFinite(previousGain) || (Math.abs(gainDb - previousGain) >= 0.05 && !filter.isSmoothing)) {
      filter.setSmoothed(
        reduction > 0.01 ? designBiquad('peak', frequency, gainDb, q, this.sr) : PASSTHROUGH,
        Math.max(1, Math.round(this.sr * NOTCH_SMOOTH_MS / 1000)),
      );
      if (channel === 'L') band.lastGainL = gainDb;
      else band.lastGainR = gainDb;
    }
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    if (n > this.dryL.length) {
      // Defensive support for hosts that increase their render quantum after prepare.
      this.dryL = new Float32Array(n);
      this.dryR = new Float32Array(n);
      this.maxBlock = n;
    }
    this.dryL.set(L.subarray(0, n), 0);
    this.dryR.set(R.subarray(0, n), 0);

    const sensitivity = clamp(this.values.sensitivity ?? 50, 0, 100);
    const maxRange = clamp(this.values.range ?? 9, 0, 24);
    const stereoLink = clamp((this.values.link ?? 100) / 100, 0, 1);
    const attack = clamp(this.values.attack ?? 5, 0.1, 100);
    const release = clamp(this.values.release ?? 120, 10, 1000);
    const thresholdOffset = (sensitivity - 50) * 0.25;

    for (let bandIndex = 0; bandIndex < RESONANCE_BANDS; bandIndex++) {
      const band = this.bands[bandIndex];
      if ((this.values[`b${bandIndex}_on`] ?? (bandIndex === 0 ? 1 : 0)) < 0.5) {
        this.bandReduction[bandIndex] = 0;
        if (band.active) {
          band.filterL.setSmoothed(PASSTHROUGH, Math.max(1, Math.round(this.sr * NOTCH_SMOOTH_MS / 1000)));
          band.filterR.setSmoothed(PASSTHROUGH, Math.max(1, Math.round(this.sr * NOTCH_SMOOTH_MS / 1000)));
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

      const frequency = clamp(this.values[`b${bandIndex}_freq`] ?? [3000, 5500, 8000][bandIndex], 80, this.sr * 0.45);
      const q = clamp(this.values[`b${bandIndex}_q`] ?? 8, 1, 30);
      const threshold = clamp(this.values[`b${bandIndex}_threshold`] ?? -34, -60, 0) - thresholdOffset;
      band.ballisticsL.setTimes(attack, release, this.sr);
      band.ballisticsR.setTimes(attack, release, this.sr);
      band.ballisticsLinked.setTimes(attack, release, this.sr);

      if (Math.abs(frequency - band.lastFreq) >= 0.5 || Math.abs(q - band.lastQ) >= 0.005) {
        const detector = designBiquad('bandpass', frequency, 0, q, this.sr);
        const samples = Math.max(1, Math.round(this.sr * 0.02));
        band.detectorL.setSmoothed(detector, samples);
        band.detectorR.setSmoothed(detector, samples);
        // Retarget current attenuation at the new center frequency without
        // introducing a discontinuous notch jump.
        band.filterL.setSmoothed(designBiquad('peak', frequency, -band.reductionL, q, this.sr), samples);
        band.filterR.setSmoothed(designBiquad('peak', frequency, -band.reductionR, q, this.sr), samples);
        band.lastFreq = frequency;
        band.lastQ = q;
        band.lastGainL = -band.reductionL;
        band.lastGainR = -band.reductionR;
      }
      band.active = true;

      let maximumReduction = 0;
      for (let i = 0; i < n; i++) {
        // Frequency-select signed programme channels first, then measure the
        // envelope. Rectifying before this filter would create false harmonics.
        const detectedL = Math.abs(band.detectorL.process(L[i]));
        const detectedR = Math.abs(band.detectorR.process(R[i]));
        const linked = Math.max(detectedL, detectedR);
        const keyL = detectedL + (linked - detectedL) * stereoLink;
        const keyR = detectedR + (linked - detectedR) * stereoLink;
        const targetL = Math.min(maxRange, Math.max(0, gainToDb(Math.max(keyL, 1e-7)) - threshold) * 0.85);
        const targetR = Math.min(maxRange, Math.max(0, gainToDb(Math.max(keyR, 1e-7)) - threshold) * 0.85);

        if (stereoLink >= 0.999) {
          const shared = band.ballisticsLinked.process(Math.max(targetL, targetR));
          band.reductionL = shared;
          band.reductionR = shared;
        } else {
          band.reductionL = band.ballisticsL.process(targetL);
          band.reductionR = band.ballisticsR.process(targetR);
        }
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
    this.mix = this.mixTarget;
    this.mixRemaining = 0;
    this.outputGain = this.outputGainTarget;
    this.outputGainRemaining = 0;
  }

  meter(): ProcessorMeter {
    return {
      reduction: Math.max(0, ...this.bandReduction),
      bands: this.bandReduction.map((reduction) => -reduction),
    };
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
    { key: 'attack', label: 'Attack', kind: 'float', min: 0.1, max: 100, step: 0.1, default: 5, unit: 'ms', group: 'Detection' },
    { key: 'release', label: 'Release', kind: 'float', min: 10, max: 1000, step: 1, default: 120, unit: 'ms', group: 'Detection' },
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
