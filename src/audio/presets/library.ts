import { createDefaultParams } from '../dsp/registry';
import type { ParamValues } from '../dsp/types';
import { uid } from '../model/defaults';

export type PresetCategory = 'vocal' | 'mix' | 'mastering';

export interface PresetProcessor {
  type: string;
  params: ParamValues;
}

export interface PresetDefinition {
  id: string;
  name: string;
  category: PresetCategory;
  description: string;
  processors: PresetProcessor[];
  /** Format version for parameter maps whose meaning has changed. */
  version?: number;
  builtIn: boolean;
  createdAt: number;
}

function p(type: string, overrides: ParamValues): PresetProcessor {
  return { type, params: { ...createDefaultParams(type), ...overrides } };
}

const eq = (bands: ParamValues) => p('eq', bands);
const comp = (values: ParamValues) => p('compressor', values);

/**
 * Presets are starting points, not universal solutions. Every parameter stays
 * editable, and the rack makes it obvious that a preset simply loaded ordinary
 * processors with ordinary values.
 */
export const BUILT_IN_PRESETS: PresetDefinition[] = [
  {
    id: 'vocal-modern-clean',
    name: 'Modern clean vocal',
    category: 'vocal',
    description: 'Controlled low mids, clear presence and gentle sibilance control.',
    builtIn: true,
    createdAt: 0,
    processors: [
      p('gain', { input: 0 }),
      p('deesser', { frequency: 6800, threshold: -30, range: 7 }),
      eq({
        b0_on: 1, b0_type: 3, b0_freq: 90, b0_q: 0.7,
        b1_on: 1, b1_type: 0, b1_freq: 320, b1_gain: -2.2, b1_q: 1.1,
        b2_on: 1, b2_type: 0, b2_freq: 3200, b2_gain: 1.8, b2_q: 1.0,
        b3_on: 1, b3_type: 2, b3_freq: 11000, b3_gain: 1.5, b3_q: 0.7,
      }),
      comp({ threshold: -22, ratio: 2.8, attack: 12, release: 110, knee: 8, style: 0, mix: 100 }),
      p('saturation', { mode: 0, drive: 2.5, mix: 18, tone: 0, oversample: 2 }),
    ],
  },
  {
    id: 'vocal-warm',
    name: 'Warm vocal',
    category: 'vocal',
    description: 'Weight around 180 Hz with softened top end and light tube colour.',
    builtIn: true,
    createdAt: 0,
    processors: [
      p('deesser', { frequency: 6200, threshold: -32, range: 6 }),
      eq({
        b0_on: 1, b0_type: 1, b0_freq: 180, b0_gain: 2.2, b0_q: 0.7,
        b1_on: 1, b1_type: 0, b1_freq: 350, b1_gain: -1.2, b1_q: 1.0,
        b2_on: 1, b2_type: 2, b2_freq: 8500, b2_gain: -1.4, b2_q: 0.7,
      }),
      p('saturation', { mode: 1, drive: 4, mix: 28, tone: 0.8 }),
      comp({ threshold: -24, ratio: 2.2, attack: 20, release: 160, knee: 10, style: 2, mix: 100 }),
    ],
  },
  {
    id: 'vocal-bright',
    name: 'Bright vocal',
    category: 'vocal',
    description: 'Presence and air forward, with a controlled harshness band.',
    builtIn: true,
    createdAt: 0,
    processors: [
      p('deesser', { frequency: 7200, threshold: -28, range: 8 }),
      eq({
        b0_on: 1, b0_type: 3, b0_freq: 110, b0_q: 0.7,
        b1_on: 1, b1_type: 0, b1_freq: 3000, b1_gain: 2.4, b1_q: 1.0,
        b2_on: 1, b2_type: 0, b2_freq: 5200, b2_gain: -1.6, b2_q: 1.2,
        b3_on: 1, b3_type: 2, b3_freq: 10000, b3_gain: 2.5, b3_q: 0.7,
      }),
      p('exciter', { frequency: 8000, drive: 5, mix: 22 }),
      comp({ threshold: -20, ratio: 2.4, attack: 8, release: 90, knee: 6, style: 1 }),
    ],
  },
  {
    id: 'vocal-rap-punch',
    name: 'Punchy rap vocal',
    category: 'vocal',
    description: 'Fast FET-style control, forward mids and clipped consonant peaks.',
    builtIn: true,
    createdAt: 0,
    processors: [
      p('deesser', { frequency: 7500, threshold: -26, range: 9, mode: 0 }),
      eq({
        b0_on: 1, b0_type: 3, b0_freq: 80, b0_q: 0.7,
        b1_on: 1, b1_type: 0, b1_freq: 220, b1_gain: -2.8, b1_q: 1.0,
        b2_on: 1, b2_type: 0, b2_freq: 2400, b2_gain: 2.6, b2_q: 1.1,
        b3_on: 1, b3_type: 0, b3_freq: 6500, b3_gain: -1.5, b3_q: 1.2,
      }),
      comp({ threshold: -26, ratio: 3.6, attack: 4, release: 80, knee: 4, style: 1, mix: 100 }),
      p('transient', { attack: 18, sustain: -6, mix: 45 }),
      p('saturation', { mode: 2, drive: 4, mix: 25 }),
    ],
  },
  {
    id: 'vocal-rnb-smooth',
    name: 'Smooth R&B vocal',
    category: 'vocal',
    description: 'Optical compression, silky top end and restrained dynamics.',
    builtIn: true,
    createdAt: 0,
    processors: [
      p('deesser', { frequency: 6000, threshold: -34, range: 6 }),
      eq({
        b0_on: 1, b0_type: 3, b0_freq: 100, b0_q: 0.7,
        b1_on: 1, b1_type: 0, b1_freq: 400, b1_gain: -1.5, b1_q: 1.0,
        b2_on: 1, b2_type: 2, b2_freq: 12000, b2_gain: 1.8, b2_q: 0.7,
      }),
      comp({ threshold: -28, ratio: 2.2, attack: 30, release: 220, knee: 12, style: 2, mix: 100 }),
      p('saturation', { mode: 0, drive: 1.8, mix: 12 }),
    ],
  },
  {
    id: 'vocal-aggressive',
    name: 'Aggressive vocal',
    category: 'vocal',
    description: 'Driven FET compression and console saturation for attitude.',
    builtIn: true,
    createdAt: 0,
    processors: [
      p('deesser', { frequency: 7000, threshold: -26, range: 10 }),
      eq({
        b0_on: 1, b0_type: 0, b0_freq: 1500, b0_gain: 2.0, b0_q: 0.9,
        b1_on: 1, b1_type: 0, b1_freq: 4000, b1_gain: 1.8, b1_q: 1.1,
        b2_on: 1, b2_type: 0, b2_freq: 250, b2_gain: -2.0, b2_q: 1.0,
      }),
      comp({ threshold: -30, ratio: 5, attack: 2, release: 70, knee: 3, style: 1, mix: 100 }),
      p('saturation', { mode: 2, drive: 7, mix: 38, tone: 0.5 }),
      p('clipper', { mode: 1, drive: 1.5, ceiling: -1, mix: 40 }),
    ],
  },
  {
    id: 'vocal-airy',
    name: 'Airy vocal',
    category: 'vocal',
    description: 'Wide air band with gentle de-essing and a clean compressor.',
    builtIn: true,
    createdAt: 0,
    processors: [
      p('deesser', { frequency: 8000, threshold: -32, range: 8 }),
      eq({
        b0_on: 1, b0_type: 3, b0_freq: 120, b0_q: 0.7,
        b1_on: 1, b1_type: 0, b1_freq: 300, b1_gain: -1.5, b1_q: 1.0,
        b2_on: 1, b2_type: 2, b2_freq: 13000, b2_gain: 3.0, b2_q: 0.6,
      }),
      p('exciter', { frequency: 11000, drive: 4, mix: 18 }),
      comp({ threshold: -22, ratio: 2.0, attack: 18, release: 140, knee: 8, style: 0 }),
    ],
  },
  {
    id: 'vocal-intimate',
    name: 'Intimate vocal',
    category: 'vocal',
    description: 'Close, dry presence with low-level detail preserved.',
    builtIn: true,
    createdAt: 0,
    processors: [
      p('deesser', { frequency: 6500, threshold: -36, range: 5 }),
      eq({
        b0_on: 1, b0_type: 3, b0_freq: 140, b0_q: 0.7,
        b1_on: 1, b1_type: 0, b1_freq: 500, b1_gain: -1.2, b1_q: 0.9,
        b2_on: 1, b2_type: 0, b2_freq: 3800, b2_gain: 1.2, b2_q: 1.0,
      }),
      comp({ threshold: -26, ratio: 1.8, attack: 15, release: 180, knee: 10, style: 2, mix: 80 }),
      p('saturation', { mode: 0, drive: 1.2, mix: 10 }),
    ],
  },

  {
    id: 'mix-clean-modern',
    name: 'Clean modern mix',
    category: 'mix',
    description: 'Transparent bus glue with a clear top and controlled low mids.',
    builtIn: true,
    createdAt: 0,
    processors: [
      eq({
        b0_on: 1, b0_type: 3, b0_freq: 30, b0_q: 0.7,
        b1_on: 1, b1_type: 0, b1_freq: 350, b1_gain: -1.5, b1_q: 1.0,
        b2_on: 1, b2_type: 0, b2_freq: 3200, b2_gain: 1.0, b2_q: 0.9,
      }),
      comp({ threshold: -18, ratio: 1.8, attack: 30, release: 180, knee: 8, style: 4, mix: 35 }),
      p('limiter', { ceiling: -3, release: 120 }),
    ],
  },
  {
    id: 'mix-warm',
    name: 'Warm mix',
    category: 'mix',
    description: 'Weight and tape-style colour without losing clarity.',
    builtIn: true,
    createdAt: 0,
    processors: [
      eq({
        b0_on: 1, b0_type: 1, b0_freq: 120, b0_gain: 1.6, b0_q: 0.7,
        b1_on: 1, b1_type: 2, b2_freq: 9000, b2_gain: -1.2, b2_q: 0.7,
      }),
      p('saturation', { mode: 0, drive: 3.5, mix: 22, tone: 1 }),
      comp({ threshold: -20, ratio: 2.0, attack: 25, release: 200, knee: 10, style: 2, mix: 40 }),
    ],
  },
  {
    id: 'mix-wide',
    name: 'Wide mix',
    category: 'mix',
    description: 'Expanded sides above the bass with a mono low end.',
    builtIn: true,
    createdAt: 0,
    processors: [
      p('stereo', { width: 128, lowWidth: 0, highWidth: 112, split: 220, monoMaker: 1 }),
      eq({
        b0_on: 1, b0_type: 3, b0_freq: 35, b0_q: 0.7,
        b1_on: 1, b1_type: 0, b1_freq: 400, b1_gain: -1.2, b1_q: 1.0,
      }),
      comp({ threshold: -18, ratio: 1.6, attack: 30, release: 200, knee: 8, style: 4, mix: 30 }),
    ],
  },
  {
    id: 'mix-punchy',
    name: 'Punchy mix',
    category: 'mix',
    description: 'Transient emphasis with firm low-end control.',
    builtIn: true,
    createdAt: 0,
    processors: [
      p('transient', { attack: 28, sustain: -6, mix: 50 }),
      eq({
        b0_on: 1, b0_type: 0, b0_freq: 65, b0_gain: 1.5, b0_q: 1.2,
        b1_on: 1, b1_type: 0, b1_freq: 300, b1_gain: -2.0, b1_q: 1.0,
      }),
      comp({ threshold: -20, ratio: 2.5, attack: 12, release: 120, knee: 6, style: 1, mix: 45 }),
    ],
  },
  {
    id: 'mix-dark',
    name: 'Dark mix',
    category: 'mix',
    description: 'Rounded top end with a low-mid weight emphasis.',
    builtIn: true,
    createdAt: 0,
    processors: [
      eq({
        b0_on: 1, b0_type: 1, b0_freq: 150, b0_gain: 1.5, b0_q: 0.7,
        b1_on: 1, b1_type: 2, b1_freq: 6000, b1_gain: -3.0, b1_q: 0.7,
        b2_on: 1, b2_type: 3, b2_freq: 25, b2_q: 0.7,
      }),
      comp({ threshold: -22, ratio: 2.0, attack: 25, release: 200, knee: 10, style: 2, mix: 30 }),
    ],
  },
  {
    id: 'mix-bright',
    name: 'Bright mix',
    category: 'mix',
    description: 'Open top end with reduced mud and air shelf.',
    builtIn: true,
    createdAt: 0,
    processors: [
      eq({
        b0_on: 1, b0_type: 0, b0_freq: 350, b0_gain: -2.0, b0_q: 1.0,
        b1_on: 1, b1_type: 2, b1_freq: 10000, b1_gain: 2.4, b1_q: 0.7,
        b2_on: 1, b2_type: 0, b2_freq: 3000, b2_gain: 1.2, b2_q: 0.9,
      }),
      p('exciter', { frequency: 9000, drive: 3, mix: 12 }),
    ],
  },
  {
    id: 'mix-vintage',
    name: 'Vintage-inspired mix',
    category: 'mix',
    description: 'Tape colour, gentle compression and a mid-focused balance.',
    builtIn: true,
    createdAt: 0,
    processors: [
      p('saturation', { mode: 0, drive: 5, mix: 35, tone: 1.5, oversample: 2 }),
      eq({
        b0_on: 1, b1_on: 1, b1_type: 0, b1_freq: 700, b1_gain: 1.2, b1_q: 0.8,
        b2_on: 1, b2_type: 2, b2_freq: 7000, b2_gain: -1.8, b2_q: 0.7,
      }),
      comp({ threshold: -24, ratio: 2.2, attack: 35, release: 250, knee: 14, style: 3, mix: 45 }),
    ],
  },
  {
    id: 'mix-heavy-low',
    name: 'Heavy low-end mix',
    category: 'mix',
    description: 'Sub weight with a mono low end and slow control.',
    builtIn: true,
    createdAt: 0,
    processors: [
      eq({ b0_on: 1, b0_type: 1, b0_freq: 70, b0_gain: 3.0, b0_q: 0.7, b1_on: 1, b1_type: 0, b1_freq: 260, b1_gain: -2.0, b1_q: 1.0 }),
      comp({ threshold: -24, ratio: 2.8, attack: 40, release: 250, knee: 12, style: 4, mix: 50, scHpf: 90 }),
      p('stereo', { width: 100, lowWidth: 0, highWidth: 105, split: 160, monoMaker: 1 }),
    ],
  },

  {
    id: 'master-transparent',
    name: 'Transparent master',
    category: 'mastering',
    description: 'Small corrections, clean limiting, no unnecessary colour.',
    builtIn: true,
    createdAt: 0,
    processors: [
      eq({ b0_on: 1, b0_type: 3, b0_freq: 25, b0_q: 0.7, b1_on: 1, b1_type: 0, b1_freq: 300, b1_gain: -0.8, b1_q: 1.0 }),
      comp({ threshold: -16, ratio: 1.5, attack: 30, release: 200, knee: 10, style: 4, mix: 20 }),
      p('limiter', { ceiling: -1.0, release: 120, truePeak: 1, lookahead: 4 }),
    ],
  },
  {
    id: 'master-loud-commercial',
    name: 'Loud commercial master',
    category: 'mastering',
    description: 'Density from clipping and limiting while keeping peaks clean.',
    builtIn: true,
    createdAt: 0,
    processors: [
      eq({ b0_on: 1, b0_type: 3, b0_freq: 30, b0_q: 0.7, b1_on: 1, b1_type: 0, b1_freq: 250, b1_gain: -1.5, b1_q: 1.0, b2_on: 1, b2_type: 2, b2_freq: 9000, b2_gain: 1.2, b2_q: 0.7 }),
      comp({ threshold: -20, ratio: 2.0, attack: 20, release: 150, knee: 6, style: 0, mix: 60 }),
      p('clipper', { mode: 0, drive: 2.5, ceiling: -0.8, mix: 55 }),
      p('limiter', { ceiling: -0.3, release: 70, truePeak: 1, lookahead: 5 }),
    ],
  },
  {
    id: 'master-warm',
    name: 'Warm master',
    category: 'mastering',
    description: 'Tape-style glue with a soft top and gentle limiting.',
    builtIn: true,
    createdAt: 0,
    processors: [
      p('saturation', { mode: 0, drive: 2.8, mix: 25, tone: 1 }),
      eq({ b0_on: 1, b0_type: 1, b0_freq: 100, b0_gain: 1.2, b0_q: 0.7, b1_on: 1, b1_type: 2, b1_freq: 10000, b1_gain: -1.0, b1_q: 0.7 }),
      comp({ threshold: -18, ratio: 1.8, attack: 40, release: 250, knee: 12, style: 3, mix: 35 }),
      p('limiter', { ceiling: -1.0, release: 120 }),
    ],
  },
  {
    id: 'master-open-dynamic',
    name: 'Open and dynamic master',
    category: 'mastering',
    description: 'Preserves transients with minimal gain reduction.',
    builtIn: true,
    createdAt: 0,
    processors: [
      eq({ b0_on: 1, b0_type: 3, b0_freq: 30, b0_q: 0.7, b1_on: 1, b1_type: 0, b1_freq: 400, b1_gain: -1.0, b1_q: 1.0 }),
      p('transient', { attack: 12, sustain: 0, mix: 35 }),
      p('limiter', { ceiling: -1.2, release: 160, lookahead: 4 }),
    ],
  },
  {
    id: 'master-bass-heavy',
    name: 'Bass-heavy master',
    category: 'mastering',
    description: 'Sub emphasis with mono bass and controlled low band.',
    builtIn: true,
    createdAt: 0,
    processors: [
      eq({ b0_on: 1, b0_type: 1, b0_freq: 65, b0_gain: 2.4, b0_q: 0.7, b1_on: 1, b1_type: 0, b1_freq: 280, b1_gain: -1.8, b1_q: 1.1 }),
      p('stereo', { width: 108, lowWidth: 0, highWidth: 105, split: 150, monoMaker: 1 }),
      p('limiter', { ceiling: -0.7, release: 100 }),
    ],
  },
  {
    id: 'master-modern-pop',
    name: 'Modern pop master',
    category: 'mastering',
    description: 'Bright, dense and consistent; a commercial pop starting point.',
    builtIn: true,
    createdAt: 0,
    processors: [
      eq({ b0_on: 1, b0_type: 0, b0_freq: 300, b0_gain: -1.2, b0_q: 1.0, b1_on: 1, b1_type: 2, b1_freq: 11000, b1_gain: 1.8, b1_q: 0.7 }),
      comp({ threshold: -18, ratio: 2.0, attack: 18, release: 140, knee: 6, style: 0, mix: 50 }),
      p('clipper', { mode: 2, drive: 1.8, ceiling: -0.6, mix: 35 }),
      p('limiter', { ceiling: -0.3, release: 80 }),
    ],
  },
  {
    id: 'master-hiphop',
    name: 'Hip-hop master',
    category: 'mastering',
    description: 'Weight, punch and a firm ceiling for streaming delivery.',
    builtIn: true,
    createdAt: 0,
    processors: [
      eq({ b0_on: 1, b0_type: 1, b0_freq: 80, b0_gain: 1.8, b0_q: 0.7, b1_on: 1, b1_type: 0, b1_freq: 350, b1_gain: -2.0, b1_q: 1.1 }),
      p('transient', { attack: 16, sustain: -4, mix: 40 }),
      p('clipper', { mode: 0, drive: 2.2, ceiling: -0.7, mix: 45 }),
      p('limiter', { ceiling: -0.4, release: 85 }),
    ],
  },
  {
    id: 'master-electronic',
    name: 'Electronic master',
    category: 'mastering',
    description: 'Controlled low end, wide top and loud, stable limiting.',
    builtIn: true,
    createdAt: 0,
    processors: [
      p('multibandComp', {
        xLow: 160, xHigh: 5000,
        b0_on: 1, b0_threshold: -24, b0_ratio: 2.2, b0_attack: 30, b0_release: 200, b0_makeup: 0,
        b1_on: 1, b1_threshold: -22, b1_ratio: 1.6, b1_attack: 15, b1_release: 140, b1_makeup: 0,
        b2_on: 0,
      }),
      p('stereo', { width: 118, lowWidth: 0, highWidth: 115, split: 180, monoMaker: 1 }),
      p('limiter', { ceiling: -0.5, release: 75 }),
    ],
  },
];

export function presetById(id: string): PresetDefinition | undefined {
  return BUILT_IN_PRESETS.find((preset) => preset.id === id);
}

export function createPreset(
  name: string,
  category: PresetCategory,
  description: string,
  processors: PresetProcessor[],
): PresetDefinition {
  return {
    id: uid('preset'),
    name,
    category,
    description,
    processors,
    version: 2,
    builtIn: false,
    createdAt: Date.now(),
  };
}
