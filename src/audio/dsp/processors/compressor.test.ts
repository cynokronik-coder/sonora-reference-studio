import { describe, expect, it } from 'vitest';
import { COMPRESSOR_PRESETS, Compressor, compressorDefinition } from './compressor';

const SAMPLE_RATE = 48_000;
const FRAME_COUNT = SAMPLE_RATE;

function renderStereoCompression(link: number, leftAmplitude: number, rightAmplitude: number) {
  const left = new Float32Array(FRAME_COUNT);
  const right = new Float32Array(FRAME_COUNT);
  for (let i = 0; i < FRAME_COUNT; i++) {
    const sample = Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE);
    left[i] = sample * leftAmplitude;
    right[i] = sample * rightAmplitude;
  }

  const inputLeft = left.slice();
  const inputRight = right.slice();
  const compressor = new Compressor();
  compressor.prepare(SAMPLE_RATE, 512);
  compressor.setValues({
    threshold: -18,
    ratio: 4,
    attack: 0.1,
    release: 100,
    knee: 0,
    lookahead: 0,
    style: 0,
    scHpf: 20,
    link,
    makeup: 0,
    autoMakeup: 0,
    mix: 100,
  });
  compressor.process(left, right, FRAME_COUNT);

  const start = Math.floor(FRAME_COUNT * 0.75);
  let inL = 0;
  let inR = 0;
  let outL = 0;
  let outR = 0;
  for (let i = start; i < FRAME_COUNT; i++) {
    inL += inputLeft[i] * inputLeft[i];
    inR += inputRight[i] * inputRight[i];
    outL += left[i] * left[i];
    outR += right[i] * right[i];
  }
  const gainL = Math.sqrt(outL / inL);
  const gainR = Math.sqrt(outR / inR);
  return { left, right, gainL, gainR, reduction: compressor.meter().reduction ?? 0 };
}

describe('Compressor stereo detector linking', () => {
  it('uses common gain reduction at 100% stereo link', () => {
    const result = renderStereoCompression(100, 0.8, 0.05);
    expect(result.gainL).toBeCloseTo(result.gainR, 3);
    expect(result.reduction).toBeGreaterThan(5);
  });

  it('compresses channels independently at 0% stereo link', () => {
    const result = renderStereoCompression(0, 0.8, 0.05);
    expect(result.gainL).toBeLessThan(0.6);
    expect(result.gainR).toBeGreaterThan(0.95);
    expect(result.gainL).toBeLessThan(result.gainR * 0.7);
  });

  it('keeps identical left and right detector histories independent but matched', () => {
    const result = renderStereoCompression(0, 0.55, 0.55);
    for (let i = 0; i < FRAME_COUNT; i += 97) {
      expect(result.left[i]).toBeCloseTo(result.right[i], 6);
    }
  });
});

describe('Compressor factory starting points', () => {
  it('contains complete parameter maps within the live processor definition', () => {
    const specs = new Map(compressorDefinition.params.map((spec) => [spec.key, spec]));
    for (const preset of COMPRESSOR_PRESETS) {
      expect(Object.keys(preset.values).sort()).toEqual([...specs.keys()].sort());
      for (const [key, value] of Object.entries(preset.values)) {
        const spec = specs.get(key);
        expect(spec, `unknown parameter ${key} in ${preset.name}`).toBeDefined();
        expect(Number.isFinite(value)).toBe(true);
        if (!spec) continue;
        if (spec.kind === 'bool') {
          expect([0, 1]).toContain(value);
        } else if (spec.kind === 'enum') {
          expect(Number.isInteger(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThan(spec.options?.length ?? 1);
        } else {
          expect(value).toBeGreaterThanOrEqual(spec.min ?? -Infinity);
          expect(value).toBeLessThanOrEqual(spec.max ?? Infinity);
        }
      }
    }
  });
});
