import { describe, expect, it } from 'vitest';
import { Biquad, designBiquad } from '../biquad';
import { createDefaultParams } from '../registry';
import { DynamicEq, DYNAMIC_EQ_PRESETS, dynamicEqDefinition } from './dynamicEq';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 256;

function tone(amplitude: number, frequency: number, length = SAMPLE_RATE, sampleRate = SAMPLE_RATE): Float32Array {
  const signal = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    signal[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  }
  return signal;
}

function rms(signal: Float32Array, from = Math.floor(signal.length / 2)): number {
  let energy = 0;
  for (let i = from; i < signal.length; i++) energy += signal[i] * signal[i];
  return Math.sqrt(energy / Math.max(1, signal.length - from));
}

function bandParams(overrides: Record<string, number> = {}): Record<string, number> {
  return {
    ...createDefaultParams('dynamicEq'),
    b0_on: 1,
    b0_freq: 1_000,
    b0_q: 8,
    b0_threshold: -20,
    b0_ratio: 4,
    b0_knee: 0,
    b0_range: 18,
    b0_attack: 0.1,
    b0_release: 100,
    b0_link: 100,
    b0_mode: 0,
    b0_rmsWindow: 10,
    output: 0,
    ...overrides,
  };
}

function createProcessor(values: Record<string, number>, sampleRate = SAMPLE_RATE, blockSize = BLOCK_SIZE): DynamicEq {
  const processor = new DynamicEq();
  processor.prepare(sampleRate, blockSize);
  processor.setValues(values);
  return processor;
}

function processBlocks(
  processor: DynamicEq,
  left: Float32Array,
  right: Float32Array,
  keyLeft?: Float32Array,
  keyRight?: Float32Array,
): void {
  for (let offset = 0; offset < left.length; offset += BLOCK_SIZE) {
    const n = Math.min(BLOCK_SIZE, left.length - offset);
    if (keyLeft && keyRight) {
      processor.setSidechain(keyLeft.subarray(offset, offset + n), keyRight.subarray(offset, offset + n));
    }
    processor.process(left.subarray(offset, offset + n), right.subarray(offset, offset + n), n);
  }
}

describe('Dynamic EQ detection and gain control', () => {
  it('reduces its target frequency without triggering on a rectified harmonic', () => {
    const targetL = tone(0.6, 1_000);
    const targetR = targetL.slice();
    const target = createProcessor(bandParams());
    processBlocks(target, targetL, targetR);
    expect(target.meter().reduction ?? 0).toBeGreaterThan(3);

    const offBandL = tone(0.6, 500);
    const offBandR = offBandL.slice();
    const offBand = createProcessor(bandParams());
    processBlocks(offBand, offBandL, offBandR);
    expect(offBand.meter().reduction ?? 0).toBeLessThan(0.5);
  });

  it('supports Peak and RMS detector modes', () => {
    const peakL = tone(0.1, 1_000);
    const peakR = peakL.slice();
    const rmsL = peakL.slice();
    const rmsR = peakL.slice();
    const peak = createProcessor(bandParams({ b0_threshold: -22, b0_mode: 0 }));
    const rmsDetector = createProcessor(bandParams({ b0_threshold: -22, b0_mode: 1, b0_rmsWindow: 10 }));
    processBlocks(peak, peakL, peakR);
    processBlocks(rmsDetector, rmsL, rmsR);
    expect(peak.meter().reduction ?? 0).toBeGreaterThan(0.5);
    expect(rmsDetector.meter().reduction ?? 0).toBeLessThan(0.5);
  });

  it('supports dual-mono and fully linked stereo detection', () => {
    const linkedL = tone(0.6, 1_000);
    const linkedR = tone(0.05, 1_000);
    const linked = createProcessor(bandParams({ b0_link: 100 }));
    processBlocks(linked, linkedL, linkedR);
    const linkedGainL = rms(linkedL) / rms(tone(0.6, 1_000));
    const linkedGainR = rms(linkedR) / rms(tone(0.05, 1_000));
    expect(linkedGainL).toBeCloseTo(linkedGainR, 2);

    const independentL = tone(0.6, 1_000);
    const independentR = tone(0.05, 1_000);
    const independent = createProcessor(bandParams({ b0_link: 0 }));
    processBlocks(independent, independentL, independentR);
    const independentGainL = rms(independentL) / rms(tone(0.6, 1_000));
    const independentGainR = rms(independentR) / rms(tone(0.05, 1_000));
    expect(independentGainL).toBeLessThan(0.7);
    expect(independentGainR).toBeGreaterThan(0.95);

    const partiallyLinkedL = tone(0.6, 1_000);
    const partiallyLinkedR = tone(0.05, 1_000);
    const partiallyLinked = createProcessor(bandParams({ b0_link: 50 }));
    processBlocks(partiallyLinked, partiallyLinkedL, partiallyLinkedR);
    const partiallyLinkedGainR = rms(partiallyLinkedR) / rms(tone(0.05, 1_000));
    expect(partiallyLinkedGainR).toBeGreaterThan(linkedGainR);
    expect(partiallyLinkedGainR).toBeLessThan(independentGainR);
  });

  it.each([44_100, 48_000, 96_000])('processes every band at its center frequency and %i Hz', (sampleRate) => {
    const frequencies = [120, 400, 2_500, 7_000];
    for (let bandIndex = 0; bandIndex < frequencies.length; bandIndex++) {
      const frequency = frequencies[bandIndex];
      const values = createDefaultParams('dynamicEq');
      values[`b${bandIndex}_on`] = 1;
      values[`b${bandIndex}_freq`] = frequency;
      values[`b${bandIndex}_q`] = 2;
      values[`b${bandIndex}_threshold`] = -24;
      values[`b${bandIndex}_ratio`] = 4;
      values[`b${bandIndex}_range`] = 18;
      values[`b${bandIndex}_attack`] = 0.1;
      values[`b${bandIndex}_release`] = 100;
      const input = tone(0.6, frequency, sampleRate / 2, sampleRate);
      const left = input.slice();
      const right = input.slice();
      const processor = createProcessor(values, sampleRate);
      processBlocks(processor, left, right);
      expect(Math.abs(processor.meter().bands?.[bandIndex] ?? 0), `band ${bandIndex + 1} at ${sampleRate}`).toBeGreaterThan(1);
      expect(rms(left, sampleRate / 4)).toBeLessThan(rms(input, sampleRate / 4) * 0.8);
    }
  });

  it('uses a frequency-matched external key and returns to internal detection when cleared', () => {
    const programL = tone(0.02, 1_000);
    const programR = programL.slice();
    const keyL = tone(0.8, 1_000);
    const keyR = keyL.slice();
    const processor = createProcessor(bandParams({ b0_threshold: -24, b0_range: 12 }));
    const inputRms = rms(programL);
    processBlocks(processor, programL, programR, keyL, keyR);
    expect(processor.meter().reduction ?? 0).toBeGreaterThan(5);
    expect(rms(programL) / inputRms).toBeLessThan(0.6);

    processor.setSidechain(null, null);
    const quietL = tone(0.02, 1_000);
    const quietR = quietL.slice();
    processBlocks(processor, quietL, quietR);
    expect(processor.meter().reduction ?? 0).toBeLessThan(0.5);
  });

  it('does not react to an external key outside the active band', () => {
    const programL = tone(0.5, 1_000);
    const programR = programL.slice();
    const keyL = tone(0.8, 50);
    const keyR = keyL.slice();
    const processor = createProcessor(bandParams({ b0_threshold: -24, b0_range: 12 }));
    processBlocks(processor, programL, programR, keyL, keyR);
    expect(processor.meter().reduction ?? 0).toBeLessThan(0.5);
    expect(rms(programL)).toBeCloseTo(rms(tone(0.5, 1_000)), 2);
  });

  it('keeps new controls backward-compatible with older parameter maps', () => {
    const legacy = {
      b0_on: 1,
      b0_freq: 1_000,
      b0_q: 1.4,
      b0_threshold: -30,
      b0_range: 6,
      b0_attack: 8,
      b0_release: 120,
    };
    const processor = createProcessor(legacy);
    const left = tone(0.4, 1_000, BLOCK_SIZE);
    const right = left.slice();
    processor.process(left, right, BLOCK_SIZE);
    expect(processor.meter().bands).toHaveLength(4);
    expect(processor.meter().reduction).toBeGreaterThanOrEqual(0);
    expect(dynamicEqDefinition.params.find((param) => param.key === 'b0_knee')?.default).toBe(0);
    expect(dynamicEqDefinition.params.find((param) => param.key === 'b0_ratio')?.default).toBe(4);
    expect(dynamicEqDefinition.params.find((param) => param.key === 'b0_link')?.default).toBe(100);
    expect(dynamicEqDefinition.params.find((param) => param.key === 'b0_mode')?.default).toBe(0);
  });

  it('resets detector state and meter without leaving stale gain reduction', () => {
    const processor = createProcessor(bandParams());
    const activeL = tone(0.6, 1_000);
    const activeR = activeL.slice();
    processBlocks(processor, activeL, activeR);
    expect(processor.meter().reduction ?? 0).toBeGreaterThan(3);

    processor.reset();
    expect(processor.meter().reduction).toBe(0);
    const quietL = tone(0.01, 1_000, BLOCK_SIZE);
    const quietR = quietL.slice();
    processor.process(quietL, quietR, BLOCK_SIZE);
    expect(processor.meter().reduction ?? 0).toBeLessThan(0.1);
    expect(quietL.every(Number.isFinite)).toBe(true);
  });

  it('smooths frequency and output changes without non-finite output or abrupt steps', () => {
    const processor = createProcessor(bandParams({ b0_threshold: 0 }));
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    let sampleIndex = 0;
    let previous = 0;
    let maxStep = 0;
    for (let block = 0; block < 24; block++) {
      if (block === 8) processor.setValues(bandParams({ b0_freq: 7_000, b0_threshold: 0, output: -12 }));
      for (let i = 0; i < BLOCK_SIZE; i++) {
        const value = 0.4 * Math.sin((2 * Math.PI * 1_000 * sampleIndex) / SAMPLE_RATE);
        left[i] = value;
        right[i] = value;
        sampleIndex++;
      }
      processor.process(left, right, BLOCK_SIZE);
      for (let i = 0; i < BLOCK_SIZE; i++) {
        maxStep = Math.max(maxStep, Math.abs(left[i] - previous));
        previous = left[i];
      }
    }
    expect(left.every(Number.isFinite)).toBe(true);
    expect(maxStep).toBeLessThan(0.12);
  });

  it('rejects processing blocks larger than the prepared capacity', () => {
    const processor = createProcessor(bandParams(), SAMPLE_RATE, 16);
    expect(() => processor.process(new Float32Array(17), new Float32Array(17), 17)).toThrow(RangeError);
  });

  it('clamps hostile parameter values and remains finite', () => {
    const processor = createProcessor(bandParams({
      b0_freq: Number.POSITIVE_INFINITY,
      b0_q: Number.NaN,
      b0_threshold: Number.NaN,
      b0_range: Number.POSITIVE_INFINITY,
      b0_ratio: Number.POSITIVE_INFINITY,
      b0_knee: Number.NaN,
      b0_attack: Number.NaN,
      b0_release: Number.NEGATIVE_INFINITY,
      b0_link: Number.NaN,
      b0_mode: Number.POSITIVE_INFINITY,
      b0_rmsWindow: Number.NaN,
      output: Number.NaN,
    }));
    const left = tone(0.8, 1_000);
    const right = left.slice();
    processBlocks(processor, left, right);
    expect(left.every(Number.isFinite)).toBe(true);
    expect(right.every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(processor.meter().reduction)).toBe(true);
  });
});

describe('Dynamic EQ parameter automation and presets', () => {
  it('provides complete, finite, in-range factory starting points', () => {
    const specs = new Map(dynamicEqDefinition.params.map((param) => [param.key, param]));
    expect(DYNAMIC_EQ_PRESETS.length).toBeGreaterThanOrEqual(4);
    for (const preset of DYNAMIC_EQ_PRESETS) {
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

  it('ramps Biquad coefficients to the requested dynamic-EQ shape', () => {
    const filter = new Biquad();
    const target = designBiquad('peak', 1_000, -9, 2, SAMPLE_RATE);
    filter.setSmoothed(target, 48);
    expect(filter.isSmoothing).toBe(true);
    for (let i = 0; i < 48; i++) filter.process(0);
    expect(filter.isSmoothing).toBe(false);
    expect(filter.b0).toBe(target.b0);
    expect(filter.a2).toBe(target.a2);
  });
});
