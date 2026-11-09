import { Biquad } from '../biquad';
import { DbBallistics } from '../envelope';
import type { AudioProcessor, ParamValues, ProcessorDefinition, ProcessorMeter } from '../types';
import { clamp, dbToGain, gainToDb } from '../util';

export const DEESSER_MODES = ['Split band', 'Wideband', 'Listen'] as const;
export const DEESSER_DETECTORS = ['Peak', 'RMS'] as const;

interface DeEsserState {
  hpL: Biquad;
  hpR: Biquad;
  hpL2: Biquad;
  hpR2: Biquad;
  lpL: Biquad;
  lpR: Biquad;
  lpL2: Biquad;
  lpR2: Biquad;
  keyHpL: Biquad;
  keyHpR: Biquad;
  keyHpL2: Biquad;
  keyHpR2: Biquad;
  ballisticsL: DbBallistics;
  ballisticsR: DbBallistics;
  rmsL: number;
  rmsR: number;
  reductionL: number;
  reductionR: number;
  lastFrequency: number;
}

function finiteValue(values: ParamValues, key: string, fallback: number): number {
  const value = values[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function targetReduction(levelDb: number, threshold: number, ratio: number, knee: number, range: number): number {
  const over = levelDb - threshold;
  if (range <= 0) return 0;
  const slope = 1 - 1 / ratio;
  if (knee > 0 && over < knee * 0.5) {
    if (over <= -knee * 0.5) return 0;
    const normalized = over + knee * 0.5;
    return clamp((slope * normalized * normalized) / (2 * knee), 0, range);
  }
  return clamp(slope * over, 0, range);
}

function makeState(sampleRate: number): DeEsserState {
  return {
    hpL: new Biquad(), hpR: new Biquad(), hpL2: new Biquad(), hpR2: new Biquad(),
    lpL: new Biquad(), lpR: new Biquad(), lpL2: new Biquad(), lpR2: new Biquad(),
    keyHpL: new Biquad(), keyHpR: new Biquad(), keyHpL2: new Biquad(), keyHpR2: new Biquad(),
    ballisticsL: new DbBallistics(sampleRate, 0.5, 60),
    ballisticsR: new DbBallistics(sampleRate, 0.5, 60),
    rmsL: 0,
    rmsR: 0,
    reductionL: 0,
    reductionR: 0,
    lastFrequency: 0,
  };
}

/**
 * Stereo de-esser with fourth-order high/low split, separate left/right
 * detector histories, adjustable linking, peak/RMS detection and external key.
 *
 * Split band attenuates only the high-frequency region. Wideband applies the
 * same detector-driven gain to the full programme signal. Listen auditions the
 * detector high band, including an external key when one is connected.
 */
export class DeEsser implements AudioProcessor {
  readonly type = 'deesser';
  readonly latency = 0;
  private sr = 48000;
  private values: ParamValues = {};
  private maxBlock = 512;
  private state = makeState(48000);
  private sidechainL: Float32Array | null = null;
  private sidechainR: Float32Array | null = null;
  private reduction = 0;
  private meterBands = [0, 0];
  private outputGain = 1;

  prepare(sampleRate: number, maxBlock: number): void {
    this.sr = Math.max(8000, Number.isFinite(sampleRate) ? sampleRate : 48000);
    this.maxBlock = Math.max(1, maxBlock);
    this.state = makeState(this.sr);
    this.configure(clamp(finiteValue(this.values, 'frequency', 6500), 2500, this.sr * 0.45));
    this.outputGain = dbToGain(clamp(finiteValue(this.values, 'output', 0), -18, 18));
  }

  setValues(values: ParamValues): void {
    this.values = values;
    const frequency = clamp(finiteValue(values, 'frequency', 6500), 2500, this.sr * 0.45);
    if (Math.abs(frequency - this.state.lastFrequency) > 0.5) this.configure(frequency);
    this.outputGain = dbToGain(clamp(finiteValue(values, 'output', 0), -18, 18));
    this.state.ballisticsL.setTimes(
      clamp(finiteValue(values, 'attack', 0.5), 0.1, 20),
      clamp(finiteValue(values, 'release', 60), 10, 500),
      this.sr,
    );
    this.state.ballisticsR.setTimes(
      clamp(finiteValue(values, 'attack', 0.5), 0.1, 20),
      clamp(finiteValue(values, 'release', 60), 10, 500),
      this.sr,
    );
  }

  setSidechain(L: Float32Array | null, R: Float32Array | null): void {
    this.sidechainL = L;
    this.sidechainR = R;
  }

  private configure(frequency: number): void {
    const state = this.state;
    state.lastFrequency = frequency;
    for (const filter of [state.hpL, state.hpR, state.hpL2, state.hpR2, state.keyHpL, state.keyHpR, state.keyHpL2, state.keyHpR2]) {
      filter.configure('highpass', frequency, 0, 0.70710678, this.sr);
      filter.reset();
    }
    for (const filter of [state.lpL, state.lpR, state.lpL2, state.lpR2]) {
      filter.configure('lowpass', frequency, 0, 0.70710678, this.sr);
      filter.reset();
    }
  }

  private detect(sample: number, mode: number, coefficient: number, channel: 'L' | 'R'): number {
    if (mode < 0.5) return Math.abs(sample);
    if (channel === 'L') {
      this.state.rmsL += (sample * sample - this.state.rmsL) * coefficient;
      return Math.sqrt(Math.max(0, this.state.rmsL));
    }
    this.state.rmsR += (sample * sample - this.state.rmsR) * coefficient;
    return Math.sqrt(Math.max(0, this.state.rmsR));
  }

  process(L: Float32Array, R: Float32Array, n: number): void {
    const threshold = clamp(finiteValue(this.values, 'threshold', -28), -60, 0);
    const range = clamp(finiteValue(this.values, 'range', 8), 0, 18);
    const ratio = clamp(finiteValue(this.values, 'ratio', 5), 1, 20);
    const knee = clamp(finiteValue(this.values, 'knee', 4), 0, 24);
    const link = clamp(finiteValue(this.values, 'link', 100), 0, 100) / 100;
    const mode = Math.round(clamp(finiteValue(this.values, 'mode', 0), 0, 2));
    const detectorMode = clamp(finiteValue(this.values, 'detector', 0), 0, 1);
    const rmsWindow = clamp(finiteValue(this.values, 'rmsWindow', 5), 1, 100);
    const rmsCoefficient = 1 - Math.exp(-1 / (rmsWindow * 0.001 * this.sr));
    const externalKey = this.sidechainL !== null && this.sidechainR !== null;
    const state = this.state;
    let maxReduction = 0;
    let maxLeftReduction = 0;
    let maxRightReduction = 0;

    for (let i = 0; i < n; i++) {
      const inputL = L[i];
      const inputR = R[i];
      const lowL = state.lpL2.process(state.lpL.process(inputL));
      const lowR = state.lpR2.process(state.lpR.process(inputR));
      const highL = state.hpL2.process(state.hpL.process(inputL));
      const highR = state.hpR2.process(state.hpR.process(inputR));

      const keyHighL = externalKey
        ? state.keyHpL2.process(state.keyHpL.process(this.sidechainL![i] ?? 0))
        : highL;
      const keyHighR = externalKey
        ? state.keyHpR2.process(state.keyHpR.process(this.sidechainR![i] ?? 0))
        : highR;

      const detectorL = this.detect(keyHighL, detectorMode, rmsCoefficient, 'L');
      const detectorR = this.detect(keyHighR, detectorMode, rmsCoefficient, 'R');
      const linkedDetector = Math.max(detectorL, detectorR);
      const levelL = detectorL + (linkedDetector - detectorL) * link;
      const levelR = detectorR + (linkedDetector - detectorR) * link;
      const reductionTargetL = targetReduction(gainToDb(Math.max(levelL, 1e-8)), threshold, ratio, knee, range);
      const reductionTargetR = targetReduction(gainToDb(Math.max(levelR, 1e-8)), threshold, ratio, knee, range);
      state.reductionL = state.ballisticsL.process(reductionTargetL);
      state.reductionR = state.ballisticsR.process(reductionTargetR);

      if (state.reductionL > maxLeftReduction) maxLeftReduction = state.reductionL;
      if (state.reductionR > maxRightReduction) maxRightReduction = state.reductionR;
      maxReduction = Math.max(maxReduction, state.reductionL, state.reductionR);

      const gainL = dbToGain(-state.reductionL);
      const gainR = dbToGain(-state.reductionR);

      if (mode === 2) {
        // Listen mode exposes the detected high-frequency material without
        // gain reduction; it can audition the connected external key.
        L[i] = externalKey ? keyHighL : highL;
        R[i] = externalKey ? keyHighR : highR;
      } else if (mode === 1) {
        L[i] = inputL * gainL * (1 - link) + inputL * Math.min(gainL, gainR) * link;
        R[i] = inputR * gainR * (1 - link) + inputR * Math.min(gainL, gainR) * link;
      } else {
        L[i] = lowL + highL * gainL;
        R[i] = lowR + highR * gainR;
      }
    }

    if (mode !== 2 && this.outputGain !== 1) {
      for (let i = 0; i < n; i++) {
        L[i] *= this.outputGain;
        R[i] *= this.outputGain;
      }
    }

    this.reduction = maxReduction;
    this.meterBands = [-maxLeftReduction, -maxRightReduction];
  }

  reset(): void {
    const state = this.state;
    for (const filter of [
      state.hpL, state.hpR, state.hpL2, state.hpR2,
      state.lpL, state.lpR, state.lpL2, state.lpR2,
      state.keyHpL, state.keyHpR, state.keyHpL2, state.keyHpR2,
    ]) filter.reset();
    state.ballisticsL.reset();
    state.ballisticsR.reset();
    state.rmsL = 0;
    state.rmsR = 0;
    state.reductionL = 0;
    state.reductionR = 0;
    this.reduction = 0;
    this.meterBands = [0, 0];
  }

  meter(): ProcessorMeter {
    return { reduction: this.reduction, bands: this.meterBands };
  }
}

export const deEsserDefinition: ProcessorDefinition = {
  type: 'deesser',
  name: 'De-esser',
  shortName: 'DE-ESS',
  category: 'vocal',
  description: 'Fourth-order split-band de-esser with stereo-linked peak/RMS detection, wideband control and external key.',
  purpose: 'Controls sibilance only when the selected high-frequency detector region rises above threshold, helping vocals stay clear without permanently dulling the top end.',
  params: [
    { key: 'frequency', label: 'Crossover frequency', kind: 'float', min: 2500, max: 12000, step: 10, default: 6500, unit: 'Hz', scale: 'log', group: 'Detection' },
    { key: 'threshold', label: 'Threshold', kind: 'float', min: -60, max: 0, step: 0.5, default: -28, unit: 'dB', group: 'Detection' },
    { key: 'range', label: 'Maximum reduction', kind: 'float', min: 0, max: 18, step: 0.1, default: 8, unit: 'dB', group: 'Dynamics' },
    { key: 'ratio', label: 'Ratio', kind: 'float', min: 1, max: 20, step: 0.1, default: 5, unit: ':1', advanced: true, group: 'Dynamics' },
    { key: 'knee', label: 'Knee', kind: 'float', min: 0, max: 24, step: 0.1, default: 4, unit: 'dB', advanced: true, group: 'Dynamics' },
    { key: 'attack', label: 'Attack', kind: 'float', min: 0.1, max: 20, step: 0.1, default: 0.5, unit: 'ms', group: 'Dynamics' },
    { key: 'release', label: 'Release', kind: 'float', min: 10, max: 500, step: 1, default: 60, unit: 'ms', advanced: true, group: 'Dynamics' },
    { key: 'link', label: 'Stereo link', kind: 'float', min: 0, max: 100, step: 1, default: 100, unit: '%', advanced: true, group: 'Stereo' },
    { key: 'detector', label: 'Detector mode', kind: 'enum', options: ['Peak', 'RMS'], default: 0, advanced: true, group: 'Detection' },
    { key: 'rmsWindow', label: 'RMS window', kind: 'float', min: 1, max: 100, step: 0.5, default: 5, unit: 'ms', advanced: true, group: 'Detection' },
    { key: 'mode', label: 'Processing mode', kind: 'enum', options: [...DEESSER_MODES], default: 0, group: 'Output' },
    { key: 'output', label: 'Output', kind: 'float', min: -18, max: 18, step: 0.1, default: 0, unit: 'dB', advanced: true, group: 'Output' },
  ],
  create: () => new DeEsser(),
};

export interface DeEsserPreset {
  id: string;
  name: string;
  description: string;
  values: ParamValues;
}

function makeDeEsserPreset(id: string, name: string, description: string, overrides: ParamValues): DeEsserPreset {
  return {
    id,
    name,
    description,
    values: {
      frequency: 6500,
      threshold: -28,
      range: 8,
      ratio: 5,
      knee: 4,
      attack: 0.5,
      release: 60,
      link: 100,
      detector: 0,
      rmsWindow: 5,
      mode: 0,
      output: 0,
      ...overrides,
    },
  };
}

/** Editable de-essing starting points for different vocal and mix situations. */
export const DEESSER_PRESETS: DeEsserPreset[] = [
  makeDeEsserPreset('gentle-vocal', 'Gentle vocal', 'Light split-band control that preserves the surrounding top end.', {
    frequency: 6800, threshold: -28, range: 4, ratio: 2.5, knee: 8, attack: 1.2, release: 110,
  }),
  makeDeEsserPreset('strong-sibilance', 'Strong sibilance', 'More assertive control for sharp S and T consonants.', {
    frequency: 7200, threshold: -32, range: 9, ratio: 6, knee: 3, attack: 0.3, release: 75,
  }),
  makeDeEsserPreset('low-sibilance', 'Low sibilance', 'Targets lower vocal edge and chesty consonant energy.', {
    frequency: 4800, threshold: -30, range: 6, ratio: 4, knee: 5, attack: 0.7, release: 90,
  }),
  makeDeEsserPreset('smooth-rms', 'Smooth RMS', 'Slower RMS detection for softer, less reactive de-essing.', {
    frequency: 6500, threshold: -26, range: 5, ratio: 3, knee: 8, attack: 3, release: 160, detector: 1, rmsWindow: 15,
  }),
  makeDeEsserPreset('wideband-vocal', 'Wideband vocal', 'A linked wideband mode for cases where sibilance is especially piercing.', {
    frequency: 7000, threshold: -30, range: 7, ratio: 5, knee: 4, mode: 1,
  }),
];
