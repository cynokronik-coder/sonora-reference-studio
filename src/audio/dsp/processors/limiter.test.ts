import { describe, expect, it } from 'vitest';
import { createDefaultParams } from '../registry';
import { ProcessorChain } from '../chain';
import { TruePeakMeter } from '../oversample';
import { Limiter, LIMITER_PRESETS, limiterDefinition } from './limiter';
import { dbToGain } from '../util';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 512;
const FRAME_COUNT = BLOCK_SIZE * 192;

function tone(frequency: number, amplitude: number, phase = 0): Float32Array {
  const result = new Float32Array(FRAME_COUNT);
  for (let i = 0; i < result.length; i++) {
    result[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE + phase);
  }
  return result;
}
function render(values: Record<string, number>, sourceL: Float32Array, sourceR = sourceL) {
  const limiter = new Limiter();
  limiter.prepare(SAMPLE_RATE, BLOCK_SIZE);
  limiter.setValues(values);
  const left = sourceL.slice();
  const right = sourceR.slice();
  for (let start = 0; start < left.length; start += BLOCK_SIZE) {
    limiter.process(left.subarray(start, start + BLOCK_SIZE), right.subarray(start, start + BLOCK_SIZE), BLOCK_SIZE);
  }
  return { left, right, meter: limiter.meter(), latency: limiter.latency };
}
function defaults() {
  return {
    ...createDefaultParams('limiter'),
    input: 0, ceiling: -1, release: 80, lookahead: 4, truePeak: 1, output: 0,
  };
}
/** A fresh post-processing analysis-stage IIR estimate; this is not standards-compliance certification. */
function measuredTruePeak(left: Float32Array, right: Float32Array): number {
  const meter = new TruePeakMeter(SAMPLE_RATE, 2, BLOCK_SIZE);
  let peak = 0;
  for (let start = 0; start < left.length; start += BLOCK_SIZE) {
    peak = Math.max(peak, meter.process(
      left.subarray(start, start + BLOCK_SIZE),
      right.subarray(start, start + BLOCK_SIZE),
      BLOCK_SIZE,
    ));
  }
  return peak;
}

describe('Limiter look-ahead and latency contract', () => {
  it('reports the exact configured look-ahead latency in samples', () => {
    const limiter = new Limiter();
    limiter.prepare(SAMPLE_RATE, BLOCK_SIZE);
    limiter.setValues({ ...defaults(), lookahead: 4 });
    expect(limiter.latency).toBe(192);
    limiter.setValues({ ...defaults(), lookahead: 0 });
    expect(limiter.latency).toBe(0);
    limiter.setValues({ ...defaults(), lookahead: 10 });
    expect(limiter.latency).toBe(480);
  });

  it('delays an unclipped impulse by exactly the configured look-ahead samples', () => {
    const limiter = new Limiter();
    limiter.prepare(SAMPLE_RATE, BLOCK_SIZE);
    limiter.setValues({ ...defaults(), lookahead: 4, truePeak: 0, ceiling: -1 });
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    left[100] = 0.4;
    right[100] = 0.2;
    limiter.process(left, right, BLOCK_SIZE);
    expect(left[100]).toBe(0);
    expect(right[100]).toBe(0);
    expect(left[292]).toBeCloseTo(0.4, 6);
    expect(right[292]).toBeCloseTo(0.2, 6);
  });

  it('does not add delay when look-ahead is set to zero', () => {
    const limiter = new Limiter();
    limiter.prepare(SAMPLE_RATE, BLOCK_SIZE);
    limiter.setValues({ ...defaults(), lookahead: 0, truePeak: 0 });
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    left[100] = 0.4;
    right[100] = 0.2;
    limiter.process(left, right, BLOCK_SIZE);
    expect(left[100]).toBeCloseTo(0.4, 6);
    expect(right[100]).toBeCloseTo(0.2, 6);
  });
});

describe('Limiter peak control', () => {
  it('controls repeated high-level transient bursts without exceeding the sample ceiling', () => {
    const frames = BLOCK_SIZE * 16;
    const sourceL = new Float32Array(frames);
    const sourceR = new Float32Array(frames);
    for (let index = 0; index < 32; index++) {
      const position = 40 + index * 230;
      sourceL[position] = index % 2 === 0 ? 2.2 : -2.2;
      sourceR[position + 7] = index % 2 === 0 ? -1.8 : 1.8;
    }
    const result = render({ ...defaults(), truePeak: 0, lookahead: 4, ceiling: -1 }, sourceL, sourceR);
    let peakL = 0;
    let peakR = 0;
    for (let i = 256; i < frames; i++) {
      peakL = Math.max(peakL, Math.abs(result.left[i]));
      peakR = Math.max(peakR, Math.abs(result.right[i]));
    }
    expect(peakL).toBeLessThanOrEqual(dbToGain(-1) + 0.003);
    expect(peakR).toBeLessThanOrEqual(dbToGain(-1) + 0.003);
  });

  it('ramps output trim over 20 ms instead of stepping the gain', () => {
    const limiter = new Limiter();
    limiter.prepare(SAMPLE_RATE, BLOCK_SIZE);
    const values = { ...defaults(), ceiling: 0, lookahead: 0, truePeak: 0, output: 0 };
    limiter.setValues(values);
    const warmL = new Float32Array(BLOCK_SIZE).fill(0.1);
    const warmR = warmL.slice();
    limiter.process(warmL, warmR, BLOCK_SIZE);

    limiter.setValues({ ...values, output: -6 });
    const rampL = new Float32Array(BLOCK_SIZE).fill(0.1);
    const rampR = rampL.slice();
    limiter.process(rampL, rampR, BLOCK_SIZE);
    const nextL = new Float32Array(BLOCK_SIZE).fill(0.1);
    const nextR = nextL.slice();
    limiter.process(nextL, nextR, BLOCK_SIZE);

    expect(rampL[0]).toBeGreaterThan(0.099);
    expect(rampL[BLOCK_SIZE - 1]).toBeLessThan(rampL[0]);
    expect(nextL[BLOCK_SIZE - 1]).toBeCloseTo(0.1 * dbToGain(-6), 4);
  });

  it('keeps sample peaks below the requested ceiling with look-ahead', () => {
    const source = tone(90, 1.2);
    const result = render({ ...defaults(), truePeak: 0 }, source);
    let peak = 0;
    for (let i = 4_096; i < FRAME_COUNT; i++) {
      peak = Math.max(peak, Math.abs(result.left[i]), Math.abs(result.right[i]));
    }
    expect(peak).toBeLessThanOrEqual(dbToGain(-1) + 0.002);
    expect(result.meter.reduction ?? 0).toBeGreaterThan(1);
  });

  it('keeps measured inter-sample peaks near or below the dBTP ceiling with true-peak mode enabled', () => {
    const sourceL = tone(11_000, 1.25, 0.17);
    const sourceR = tone(9_700, 1.1, 0.43);
    const result = render({ ...defaults(), truePeak: 1, lookahead: 5, ceiling: -1.5 }, sourceL, sourceR);
    const measured = measuredTruePeak(result.left, result.right);
    expect(measured).toBeLessThanOrEqual(dbToGain(-1.5) + 0.02);
    expect(result.meter.reduction ?? 0).toBeGreaterThan(1);
  });

  it('tracks left and right output peaks independently', () => {
    const left = tone(440, 1.2);
    const right = tone(440, 0.2);
    const result = render({ ...defaults(), truePeak: 0, lookahead: 2 }, left, right);
    expect(result.meter.peakL ?? 0).toBeGreaterThan(result.meter.peakR ?? 0);
    expect(Number.isFinite(result.meter.peakL ?? 0)).toBe(true);
    expect(Number.isFinite(result.meter.peakR ?? 0)).toBe(true);
  });

  it('keeps output finite while input gain, ceiling and output trim are adjusted', () => {
    const limiter = new Limiter();
    limiter.prepare(SAMPLE_RATE, BLOCK_SIZE);
    limiter.setValues(defaults());
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    for (let block = 0; block < 36; block++) {
      limiter.setValues({
        ...defaults(),
        input: -6 + (block % 10) * 2,
        ceiling: -0.2 - (block % 10) * 0.7,
        output: -3 + (block % 6),
        lookahead: block % 3 === 0 ? 0 : block % 3 === 1 ? 4 : 8,
      });
      const start = block * BLOCK_SIZE;
      for (let i = 0; i < BLOCK_SIZE; i++) {
        const sample = 1.2 * Math.sin((2 * Math.PI * 1_000 * (start + i)) / SAMPLE_RATE);
        left[i] = sample;
        right[i] = sample * 0.5;
      }
      limiter.process(left, right, BLOCK_SIZE);
      for (const sample of left) expect(Number.isFinite(sample)).toBe(true);
      for (const sample of right) expect(Number.isFinite(sample)).toBe(true);
    }
  });

  it('keeps the processed waveform finite across the prepared maximum block', () => {
    const limiter = new Limiter();
    limiter.prepare(SAMPLE_RATE, BLOCK_SIZE);
    limiter.setValues(defaults());
    const source = tone(8_000, 0.9);
    const left = source.subarray(0, BLOCK_SIZE);
    const right = source.subarray(0, BLOCK_SIZE);
    expect(() => limiter.process(left, right, BLOCK_SIZE)).not.toThrow();
    for (const sample of left) expect(Number.isFinite(sample)).toBe(true);
  });
});

describe('Limiter parameter definition', () => {
  it('declares a look-ahead range that fits the prepared delay buffer', () => {
    const lookahead = limiterDefinition.params.find((param) => param.key === 'lookahead');
    expect(lookahead?.min).toBe(0);
    expect(lookahead?.max).toBe(10);
  });
});


describe('Limiter integration and factory presets', () => {
  it('propagates dynamic look-ahead latency through the processor chain', () => {
    const chain = new ProcessorChain(SAMPLE_RATE, BLOCK_SIZE);
    chain.prepare(SAMPLE_RATE, BLOCK_SIZE);
    chain.update([{
      id: 'master-limiter',
      type: 'limiter',
      enabled: true,
      params: { ...createDefaultParams('limiter'), lookahead: 5 },
    }]);
    expect(chain.latency).toBe(240);

    chain.update([{
      id: 'master-limiter',
      type: 'limiter',
      enabled: true,
      params: { ...createDefaultParams('limiter'), lookahead: 0 },
    }]);
    expect(chain.latency).toBe(0);
  });

  it('contains complete valid parameter maps for every mastering starting point', () => {
    const specs = new Map(limiterDefinition.params.map((param) => [param.key, param]));
    expect(LIMITER_PRESETS.length).toBeGreaterThanOrEqual(4);
    for (const preset of LIMITER_PRESETS) {
      expect(Object.keys(preset.values).sort()).toEqual([...specs.keys()].sort());
      for (const [key, value] of Object.entries(preset.values)) {
        const spec = specs.get(key);
        expect(spec, `unknown parameter ${key} in ${preset.name}`).toBeDefined();
        expect(Number.isFinite(value)).toBe(true);
        if (!spec) continue;
        if (spec.kind === 'bool') expect([0, 1]).toContain(value);
        else if (spec.kind === 'enum') {
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


describe('Limiter reset and bypass behavior', () => {
  it('clears pending look-ahead audio and detector state on reset', () => {
    const limiter = new Limiter();
    limiter.prepare(SAMPLE_RATE, BLOCK_SIZE);
    limiter.setValues({ ...defaults(), ceiling: 0, lookahead: 4, truePeak: 0 });

    const firstL = new Float32Array(BLOCK_SIZE);
    const firstR = new Float32Array(BLOCK_SIZE);
    firstL[BLOCK_SIZE - 10] = 0.5;
    firstR[BLOCK_SIZE - 10] = 0.25;
    limiter.process(firstL, firstR, BLOCK_SIZE);

    limiter.reset();
    const nextL = new Float32Array(BLOCK_SIZE);
    const nextR = new Float32Array(BLOCK_SIZE);
    limiter.process(nextL, nextR, BLOCK_SIZE);

    expect(nextL.every((sample) => sample === 0)).toBe(true);
    expect(nextR.every((sample) => sample === 0)).toBe(true);
    expect(limiter.meter()).toEqual({ reduction: 0, peakL: 0, peakR: 0 });
  });

  it('passes audio unchanged while bypassed and does not replay pre-bypass delay samples on re-enable', () => {
    const chain = new ProcessorChain(SAMPLE_RATE, BLOCK_SIZE);
    chain.prepare(SAMPLE_RATE, BLOCK_SIZE);
    const config = {
      id: 'master-limiter',
      type: 'limiter',
      enabled: true,
      params: { ...defaults(), ceiling: 0, lookahead: 4, truePeak: 0 },
    };
    chain.update([config]);
    expect(chain.latency).toBe(192);

    const beforeL = new Float32Array(BLOCK_SIZE);
    const beforeR = new Float32Array(BLOCK_SIZE);
    beforeL[BLOCK_SIZE - 10] = 0.5;
    beforeR[BLOCK_SIZE - 10] = 0.25;
    chain.process(beforeL, beforeR, BLOCK_SIZE);

    chain.update([{ ...config, enabled: false }]);
    expect(chain.latency).toBe(0);
    const bypassL = new Float32Array(BLOCK_SIZE);
    const bypassR = new Float32Array(BLOCK_SIZE);
    bypassL[40] = 0.3;
    bypassR[80] = -0.2;
    const dryL = bypassL.slice();
    const dryR = bypassR.slice();
    chain.process(bypassL, bypassR, BLOCK_SIZE);
    expect(bypassL).toEqual(dryL);
    expect(bypassR).toEqual(dryR);

    chain.update([config]);
    expect(chain.latency).toBe(192);
    const resumedL = new Float32Array(BLOCK_SIZE);
    const resumedR = new Float32Array(BLOCK_SIZE);
    chain.process(resumedL, resumedR, BLOCK_SIZE);
    expect(resumedL.every((sample) => sample === 0)).toBe(true);
    expect(resumedR.every((sample) => sample === 0)).toBe(true);
  });
});
