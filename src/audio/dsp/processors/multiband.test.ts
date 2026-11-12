import { describe, expect, it } from 'vitest';
import { createDefaultParams } from '../registry';
import { MultibandCompressor, MULTIBAND_PRESETS, multibandCompDefinition } from './multiband';

const SAMPLE_RATE = 48_000;

function sine(amplitude: number, frequency: number, sampleRate: number, length: number, phase = 0): Float32Array {
  const signal = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    signal[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate + phase);
  }
  return signal;
}

function rms(signal: Float32Array, sampleRate: number, fromSeconds = 0.5): number {
  const start = Math.min(signal.length, Math.floor(fromSeconds * sampleRate));
  let sum = 0;
  for (let i = start; i < signal.length; i++) sum += signal[i] * signal[i];
  return Math.sqrt(sum / Math.max(1, signal.length - start));
}

function amplitudeAt(signal: Float32Array, frequency: number, sampleRate: number, fromSeconds = 0.5): number {
  const start = Math.min(signal.length, Math.floor(fromSeconds * sampleRate));
  let sinSum = 0;
  let cosSum = 0;
  const count = Math.max(1, signal.length - start);
  for (let i = start; i < signal.length; i++) {
    const phase = (2 * Math.PI * frequency * i) / sampleRate;
    sinSum += signal[i] * Math.sin(phase);
    cosSum += signal[i] * Math.cos(phase);
  }
  return (2 / count) * Math.hypot(sinSum, cosSum);
}

function neutralParameters() {
  const values = createDefaultParams('multibandComp');
  for (let band = 0; band < 3; band++) {
    values[`b${band}_ratio`] = 1;
    values[`b${band}_makeup`] = 0;
    values[`b${band}_mix`] = 100;
  }
  values.output = 0;
  return values;
}

function renderAsymmetricLowBand(link: number, style = 0) {
  const frames = SAMPLE_RATE;
  const left = sine(0.8, 100, SAMPLE_RATE, frames);
  const right = sine(0.05, 100, SAMPLE_RATE, frames);
  const inputLeft = left.slice();
  const inputRight = right.slice();
  const params = neutralParameters();
  params.xLow = 200;
  params.xHigh = 2000;
  params.b0_threshold = -18;
  params.b0_ratio = 8;
  params.b0_attack = 0.1;
  params.b0_release = 100;
  params.b0_knee = 0;
  params.b0_style = style;
  params.b0_link = link;
  const processor = new MultibandCompressor();
  processor.prepare(SAMPLE_RATE, 512);
  processor.setValues(params);
  for (let offset = 0; offset < frames; offset += 512) {
    const n = Math.min(512, frames - offset);
    processor.process(left.subarray(offset, offset + n), right.subarray(offset, offset + n), n);
  }
  return {
    gainL: rms(left, SAMPLE_RATE) / rms(inputLeft, SAMPLE_RATE),
    gainR: rms(right, SAMPLE_RATE) / rms(inputRight, SAMPLE_RATE),
  };
}

describe('Multiband crossover reconstruction', () => {
  it.each([44_100, 48_000, 96_000])('reconstructs the summed signal at %i Hz sample rate', (sampleRate) => {
    const frequencies = [50, 100, 180, 200, 500, 1000, 4000, 4500, 8000, 12_000];
    for (const frequency of frequencies) {
      if (frequency >= sampleRate / 2) continue;
      const input = sine(0.25, frequency, sampleRate, sampleRate);
      const left = input.slice();
      const right = input.slice();
      const processor = new MultibandCompressor();
      processor.prepare(sampleRate, 512);
      processor.setValues(neutralParameters());
      for (let offset = 0; offset < sampleRate; offset += 257) {
        const n = Math.min(257, sampleRate - offset);
        processor.process(left.subarray(offset, offset + n), right.subarray(offset, offset + n), n);
      }
      const ratio = rms(left, sampleRate) / rms(input, sampleRate);
      expect(ratio, `${frequency} Hz at ${sampleRate} Hz`).toBeGreaterThan(0.98);
      expect(ratio, `${frequency} Hz at ${sampleRate} Hz`).toBeLessThan(1.02);
    }
  });

  it('accepts variable blocks within its prepared capacity and remains finite', () => {
    const processor = new MultibandCompressor();
    processor.prepare(SAMPLE_RATE, 512);
    processor.setValues(neutralParameters());
    const left = sine(0.2, 73, SAMPLE_RATE, SAMPLE_RATE);
    const right = sine(0.17, 6130, SAMPLE_RATE, SAMPLE_RATE, 0.23);
    const blockSizes = [128, 257, 512, 191];
    let offset = 0;
    let blockIndex = 0;
    while (offset < left.length) {
      const n = Math.min(blockSizes[blockIndex % blockSizes.length], left.length - offset);
      processor.process(left.subarray(offset, offset + n), right.subarray(offset, offset + n), n);
      offset += n;
      blockIndex++;
    }
    expect(left.every(Number.isFinite)).toBe(true);
    expect(right.every(Number.isFinite)).toBe(true);
  });

  it('rejects blocks larger than its prepared capacity without reallocating', () => {
    const processor = new MultibandCompressor();
    processor.prepare(SAMPLE_RATE, 16);
    const left = new Float32Array(17);
    const right = new Float32Array(17);
    expect(() => processor.process(left, right, 17)).toThrow(RangeError);
  });

  it('smooths crossover changes and band solo transitions', () => {
    const processor = new MultibandCompressor();
    processor.prepare(SAMPLE_RATE, 128);
    processor.setValues(neutralParameters());
    const left = sine(0.2, 1000, SAMPLE_RATE, 4096);
    const right = left.slice();
    let previous = 0;
    let maxStep = 0;
    for (let offset = 0; offset < left.length; offset += 128) {
      if (offset === 1024) processor.setValues({ ...neutralParameters(), xLow: 600, xHigh: 800, b1_solo: 1 });
      const n = Math.min(128, left.length - offset);
      processor.process(left.subarray(offset, offset + n), right.subarray(offset, offset + n), n);
      for (let i = 0; i < n; i++) {
        const index = offset + i;
        if (index > 0) maxStep = Math.max(maxStep, Math.abs(left[index] - previous));
        previous = left[index];
      }
    }
    expect(maxStep).toBeLessThan(0.12);
  });

  it('keeps bypassed bands audible and solos only the selected band', () => {
    const length = SAMPLE_RATE;
    const low = sine(0.2, 100, SAMPLE_RATE, length);
    const high = sine(0.15, 6000, SAMPLE_RATE, length);
    const input = Float32Array.from(low, (value, index) => value + high[index]);
    const left = input.slice();
    const right = input.slice();
    const params = neutralParameters();
    params.b0_on = 0;
    params.b0_solo = 1;
    const processor = new MultibandCompressor();
    processor.prepare(SAMPLE_RATE, 512);
    processor.setValues(params);
    for (let offset = 0; offset < length; offset += 512) {
      const n = Math.min(512, length - offset);
      processor.process(left.subarray(offset, offset + n), right.subarray(offset, offset + n), n);
    }
    expect(amplitudeAt(left, 100, SAMPLE_RATE)).toBeGreaterThan(0.18);
    expect(amplitudeAt(left, 100, SAMPLE_RATE)).toBeLessThan(0.22);
    expect(amplitudeAt(left, 6000, SAMPLE_RATE)).toBeLessThan(0.002);
  });
});

describe('Multiband band dynamics and sidechains', () => {
  it('provides independent stereo linking for each band', () => {
    const linked = renderAsymmetricLowBand(100);
    const dualMono = renderAsymmetricLowBand(0);
    expect(linked.gainL).toBeCloseTo(linked.gainR, 2);
    expect(dualMono.gainL).toBeLessThan(0.7);
    expect(dualMono.gainR).toBeGreaterThan(0.95);
  });

  it('keeps RMS-style band detection linked or independent as selected', () => {
    const linked = renderAsymmetricLowBand(100, 2);
    const dualMono = renderAsymmetricLowBand(0, 2);
    expect(linked.gainL).toBeCloseTo(linked.gainR, 2);
    expect(dualMono.gainL).toBeLessThan(0.7);
    expect(dualMono.gainR).toBeGreaterThan(0.95);
  });

  it('routes frequency-matched external keys to the corresponding band detector', () => {
    const frames = SAMPLE_RATE;
    const left = sine(0.12, 100, SAMPLE_RATE, frames);
    const right = left.slice();
    const key = sine(0.8, 6000, SAMPLE_RATE, frames);
    const params = neutralParameters();
    params.xLow = 200;
    params.xHigh = 2000;
    for (let band = 0; band < 3; band++) {
      params[`b${band}_threshold`] = -30;
      params[`b${band}_ratio`] = 8;
      params[`b${band}_attack`] = 0.1;
      params[`b${band}_release`] = 100;
      params[`b${band}_knee`] = 0;
    }
    const processor = new MultibandCompressor();
    processor.prepare(SAMPLE_RATE, 512);
    processor.setValues(params);
    const keyBlock = new Float32Array(512);
    for (let offset = 0; offset < frames; offset += 512) {
      const n = Math.min(512, frames - offset);
      keyBlock.set(key.subarray(offset, offset + n));
      processor.setSidechain(keyBlock, keyBlock);
      processor.process(left.subarray(offset, offset + n), right.subarray(offset, offset + n), n);
    }
    const bands = processor.meter().bands ?? [];
    expect(Math.abs(bands[0] ?? 0)).toBeLessThan(0.5);
    expect(Math.abs(bands[1] ?? 0)).toBeLessThan(0.5);
    expect(Math.abs(bands[2] ?? 0)).toBeGreaterThan(5);
    expect(processor.meter().reduction ?? 0).toBeGreaterThan(5);
  });

  it('returns to internal key detection after the external key is disconnected', () => {
    const frames = SAMPLE_RATE;
    const left = sine(0.6, 100, SAMPLE_RATE, frames);
    const right = left.slice();
    const key = sine(0.8, 6000, SAMPLE_RATE, frames);
    const params = neutralParameters();
    params.xLow = 200;
    params.xHigh = 2000;
    for (let band = 0; band < 3; band++) {
      params[`b${band}_threshold`] = -30;
      params[`b${band}_ratio`] = 8;
      params[`b${band}_attack`] = 0.1;
      params[`b${band}_release`] = 100;
      params[`b${band}_knee`] = 0;
    }
    const processor = new MultibandCompressor();
    processor.prepare(SAMPLE_RATE, 512);
    processor.setValues(params);
    const keyBlock = new Float32Array(512);
    for (let offset = 0; offset < frames / 2; offset += 512) {
      const n = Math.min(512, frames / 2 - offset);
      keyBlock.set(key.subarray(offset, offset + n));
      processor.setSidechain(keyBlock, keyBlock);
      processor.process(left.subarray(offset, offset + n), right.subarray(offset, offset + n), n);
    }
    processor.setSidechain(null, null);
    for (let offset = frames / 2; offset < frames; offset += 512) {
      const n = Math.min(512, frames - offset);
      processor.process(left.subarray(offset, offset + n), right.subarray(offset, offset + n), n);
    }
    expect(processor.meter().reduction ?? 0).toBeGreaterThan(5);
  });

  it('keeps older parameter maps valid with defaults for newly added controls', () => {
    const values = neutralParameters();
    for (let band = 0; band < 3; band++) {
      delete values[`b${band}_solo`];
      delete values[`b${band}_link`];
    }
    const processor = new MultibandCompressor();
    processor.prepare(SAMPLE_RATE, 512);
    processor.setValues(values);
    const left = sine(0.2, 800, SAMPLE_RATE, 512);
    const right = left.slice();
    processor.process(left, right, left.length);
    expect(left.every(Number.isFinite)).toBe(true);
    expect(processor.meter().bands).toHaveLength(3);
  });

  it('keeps audio finite with non-finite and extreme parameter values', () => {
    const params = neutralParameters();
    params.xLow = 600;
    params.xHigh = 800;
    params.output = 18;
    params.b0_threshold = Number.NaN;
    params.b0_ratio = Number.POSITIVE_INFINITY;
    params.b0_attack = Number.NaN;
    params.b0_release = Number.POSITIVE_INFINITY;
    params.b0_knee = Number.POSITIVE_INFINITY;
    params.b0_makeup = Number.POSITIVE_INFINITY;
    params.b0_mix = Number.NaN;
    params.b0_link = Number.POSITIVE_INFINITY;
    params.b1_ratio = 20;
    params.b1_threshold = -60;
    params.b2_style = 4;

    const processor = new MultibandCompressor();
    processor.prepare(SAMPLE_RATE, 512);
    processor.setValues(params);
    const left = sine(0.9, 6000, SAMPLE_RATE, 4096);
    const right = left.slice();
    for (let offset = 0; offset < left.length; offset += 512) {
      processor.process(left.subarray(offset, offset + 512), right.subarray(offset, offset + 512), 512);
    }
    expect(left.every(Number.isFinite)).toBe(true);
    expect(right.every(Number.isFinite)).toBe(true);
  });
});

describe('Multiband starting points', () => {
  it('provides complete finite in-range parameter maps', () => {
    const specs = new Map(multibandCompDefinition.params.map((spec) => [spec.key, spec]));
    for (const preset of MULTIBAND_PRESETS) {
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
