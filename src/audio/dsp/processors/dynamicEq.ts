import { Biquad, designBiquad, type BiquadCoeffs } from '../biquad';
import { DbBallistics } from '../envelope';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain, gainToDb } from '../util';

export const DYN_EQ_BANDS = 4;
const DETECTOR_SMOOTH_MS = 20;
const GAIN_SMOOTH_MS = 5;
const PASSTHROUGH: BiquadCoeffs = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

interface DynBand {
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

/**
 * Four-band dynamic bell EQ with independent raw-signal stereo detectors.
 *
 * Detector filters analyse signed left and right programme samples separately;
 * they do not rectify or combine the audio before filtering. Stereo Link blends
 * each detector towards the stronger side, with 100% sharing one gain envelope
 * so both channels receive identical gain reduction. Filter coefficients
 * transition smoothly rather than jumping at each detector update.
 */
export class DynamicEq implements AudioProcessor {
  readonly type = 'dynamicEq';
  readonly latency = 0;
  private sr = 48000;
  private values: ParamValues = {};
  private bands: DynBand[] = [];
  private meterBands: number[] = [];
  private outputGain = 1;
  private outputGainTarget = 1;
  private outputGainStep = 0;
  private outputGainRemaining = 0;

  constructor() {
    for (let i = 0; i < DYN_EQ_BANDS; i++) {
      this.bands.push({
        detectorL: new Biquad(),
        detectorR: new Biquad(),
        filterL: new Biquad(),
        filterR: new Biquad(),
        ballisticsL: new DbBallistics(48000, 8, 120),
        ballisticsR: new DbBallistics(48000, 8, 120),
        ballisticsLinked: new DbBallistics(48000, 8, 120),
        reductionL: 0,
        reductionR: 0,
        lastFreq: 0,
        lastQ: 0,
        lastGainL: Number.NaN,
        lastGainR: Number.NaN,
        active: false,
      });
      this.meterBands.push(0);
    }
  }

  prepare(sampleRate: number): void {
    this.sr = sampleRate;
    for (const band of this.bands) {
      band.ballisticsL = new DbBallistics(sampleRate, 8, 120);
      band.ballisticsR = new DbBallistics(sampleRate, 8, 120);
      band.ballisticsLinked = new DbBallistics(sampleRate, 8, 120);
    }
    this.outputGain = this.outputGainTarget;
    this.outputGainRemaining = 0;
    this.reset();
  }

  setValues(values: ParamValues): void {
    this.values = values;
    const nextGain = dbToGain(clamp(values.output ?? 0, -18, 18));
    if (nextGain !== this.outputGainTarget) {
      this.outputGainTarget = nextGain;
      this.outputGainRemaining = Math.max(1, Math.round(this.sr * 0.02));
      this.outputGainStep = (this.outputGainTarget - this.outputGain) / this.outputGainRemaining;
    }
  }

  private num(key: string, fallback: number): number {
    const value = this.values[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  private targetReduction(detectorLevel: number, threshold: number, ratio: number, range: number): number {
    const over = gainToDb(Math.max(detectorLevel, 1e-7)) - threshold;
    return over > 0 ? Math.min(range, over * (1 - 1 / ratio)) : 0;
  }

  private setBandFrequency(band: DynBand, freq: number, q: number): void {
    if (Math.abs(freq - band.lastFreq) < 0.5 && Math.abs(q - band.lastQ) < 0.005) return;
    const detector = designBiquad('bandpass', freq, 0, q, this.sr);
    band.detectorL.setSmoothed(detector, Math.max(1, Math.round(this.sr * DETECTOR_SMOOTH_MS / 1000)));
    band.detectorR.setSmoothed(detector, Math.max(1, Math.round(this.sr * DETECTOR_SMOOTH_MS / 1000)));
    const initialGainL = Number.isFinite(band.lastGainL) ? -band.lastGainL : 0;
    const initialGainR = Number.isFinite(band.lastGainR) ? -band.lastGainR : 0;
    band.filterL.setSmoothed(designBiquad('peak', freq, initialGainL, q, this.sr), Math.max(1, Math.round(this.sr * DETECTOR_SMOOTH_MS / 1000)));
    band.filterR.setSmoothed(designBiquad('peak', freq, initialGainR, q, this.sr), Math.max(1, Math.round(this.sr * DETECTOR_SMOOTH_MS / 1000)));
    band.lastFreq = freq;
    band.lastQ = q;
  }

  private updateDynamicFilter(band: DynBand, channel: 'L' | 'R', frequency: number, q: number, reduction: number): void {
    const filter = channel === 'L' ? band.filterL : band.filterR;
    const lastGain = channel === 'L' ? band.lastGainL : band.lastGainR;
    const gainDb = -reduction;
    // The detector envelope is already attack/release smoothed. Update the
    // filter only when the target moves meaningfully and the previous short
    // coefficient ramp has completed.
    if (!Number.isFinite(lastGain) || (Math.abs(gainDb - lastGain) >= 0.05 && !filter.isSmoothing)) {
      filter.setSmoothed(
        designBiquad('peak', frequency, gainDb, q, this.sr),
        Math.max(1, Math.round(this.sr * GAIN_SMOOTH_MS / 1000)),
      );
      if (channel === 'L') band.lastGainL = gainDb;
      else band.lastGainR = gainDb;
    }
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    for (let bandIndex = 0; bandIndex < DYN_EQ_BANDS; bandIndex++) {
      const band = this.bands[bandIndex];
      const on = this.num(`b${bandIndex}_on`, 0) > 0.5;

      if (!on) {
        this.meterBands[bandIndex] = 0;
        if (band.active) {
          band.filterL.setSmoothed(PASSTHROUGH, Math.max(1, Math.round(this.sr * GAIN_SMOOTH_MS / 1000)));
          band.filterR.setSmoothed(PASSTHROUGH, Math.max(1, Math.round(this.sr * GAIN_SMOOTH_MS / 1000)));
          band.active = false;
        }
        if (band.filterL.isSmoothing || band.filterR.isSmoothing) {
          for (let s = 0; s < n; s++) {
            L[s] = band.filterL.process(L[s]);
            R[s] = band.filterR.process(R[s]);
          }
        }
        continue;
      }

      const freq = clamp(this.num(`b${bandIndex}_freq`, [120, 400, 2500, 7000][bandIndex]), 20, Math.min(20_000, this.sr * 0.45));
      const q = clamp(this.num(`b${bandIndex}_q`, 1.4), 0.3, 12);
      const threshold = clamp(this.num(`b${bandIndex}_threshold`, -30), -60, 0);
      const range = clamp(this.num(`b${bandIndex}_range`, 6), 0, 18);
      const ratio = clamp(this.num(`b${bandIndex}_ratio`, 4), 1, 12);
      const attack = clamp(this.num(`b${bandIndex}_attack`, 8), 0.1, 100);
      const release = clamp(this.num(`b${bandIndex}_release`, 120), 10, 1000);
      const stereoLink = clamp(this.num(`b${bandIndex}_link`, 100) / 100, 0, 1);

      band.ballisticsL.setTimes(attack, release, this.sr);
      band.ballisticsR.setTimes(attack, release, this.sr);
      band.ballisticsLinked.setTimes(attack, release, this.sr);
      this.setBandFrequency(band, freq, q);
      band.active = true;

      let maxReduction = 0;
      for (let s = 0; s < n; s++) {
        // Analyse the original signed channel signals independently. Rectifying
        // before band-pass filtering would create harmonics and false triggers.
        const detectedL = Math.abs(band.detectorL.process(L[s]));
        const detectedR = Math.abs(band.detectorR.process(R[s]));
        const linkedLevel = Math.max(detectedL, detectedR);
        const keyL = detectedL + (linkedLevel - detectedL) * stereoLink;
        const keyR = detectedR + (linkedLevel - detectedR) * stereoLink;

        let reductionL: number;
        let reductionR: number;
        if (stereoLink >= 0.999) {
          const target = this.targetReduction(linkedLevel, threshold, ratio, range);
          const sharedReduction = band.ballisticsLinked.process(target);
          reductionL = sharedReduction;
          reductionR = sharedReduction;
        } else {
          reductionL = band.ballisticsL.process(this.targetReduction(keyL, threshold, ratio, range));
          reductionR = band.ballisticsR.process(this.targetReduction(keyR, threshold, ratio, range));
        }
        band.reductionL = reductionL;
        band.reductionR = reductionR;
        maxReduction = Math.max(maxReduction, reductionL, reductionR);

        this.updateDynamicFilter(band, 'L', freq, q, reductionL);
        this.updateDynamicFilter(band, 'R', freq, q, reductionR);
        L[s] = band.filterL.process(L[s]);
        R[s] = band.filterR.process(R[s]);
      }
      this.meterBands[bandIndex] = maxReduction;
    }

    for (let i = 0; i < n; i++) {
      if (this.outputGainRemaining > 0) {
        this.outputGain += this.outputGainStep;
        this.outputGainRemaining -= 1;
        if (this.outputGainRemaining === 0) this.outputGain = this.outputGainTarget;
      }
      L[i] *= this.outputGain;
      R[i] *= this.outputGain;
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
    this.meterBands.fill(0);
  }

  meter(): ProcessorMeter {
    const reduction = Math.max(0, ...this.meterBands);
    return { reduction, bands: this.meterBands.map((value) => -value) };
  }
}

function bandObject(i: number) {
  const group = `Band ${i + 1}`;
  return [
    { key: `b${i}_on`, label: 'Enabled', kind: 'bool' as const, default: 0, group },
    {
      key: `b${i}_freq`, label: 'Frequency', kind: 'float' as const, min: 20, max: 20000, step: 1,
      default: [120, 400, 2500, 7000][i], unit: 'Hz', scale: 'log' as const, group,
    },
    { key: `b${i}_q`, label: 'Q', kind: 'float' as const, min: 0.3, max: 12, step: 0.01, default: 1.4, group },
    { key: `b${i}_threshold`, label: 'Threshold', kind: 'float' as const, min: -60, max: 0, step: 0.5, default: -30, unit: 'dB', group },
    { key: `b${i}_ratio`, label: 'Ratio', kind: 'float' as const, min: 1, max: 12, step: 0.1, default: 4, unit: ':1', advanced: true, group },
    { key: `b${i}_range`, label: 'Max cut', kind: 'float' as const, min: 0, max: 18, step: 0.1, default: 6, unit: 'dB', group },
    { key: `b${i}_attack`, label: 'Attack', kind: 'float' as const, min: 0.1, max: 100, step: 0.1, default: 8, unit: 'ms', group },
    { key: `b${i}_release`, label: 'Release', kind: 'float' as const, min: 10, max: 1000, step: 1, default: 120, unit: 'ms', group },
    { key: `b${i}_link`, label: 'Stereo link', kind: 'float' as const, min: 0, max: 100, step: 1, default: 100, unit: '%', advanced: true, group },
  ];
}

export const dynamicEqDefinition: ProcessorDefinition = {
  type: 'dynamicEq',
  name: 'Dynamic EQ',
  shortName: 'DYN EQ',
  category: 'eq',
  description: 'Four-band dynamic bell EQ with independent stereo detection, adjustable linking and smooth filter transitions.',
  purpose: 'Controls resonances and boomy or harsh notes only when they occur, leaving the rest of the mix untouched.',
  params: [
    ...bandObject(0), ...bandObject(1), ...bandObject(2), ...bandObject(3),
    { key: 'output', label: 'Output', kind: 'float', min: -18, max: 18, step: 0.1, default: 0, unit: 'dB', group: 'Output' },
  ],
  create: () => new DynamicEq(),
};

void clamp;
