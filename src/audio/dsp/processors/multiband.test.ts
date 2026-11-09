import { describe, expect, it } from 'vitest';
import { createDefaultParams } from '../registry';
import { MultibandCompressor, MULTIBAND_PRESETS, multibandCompDefinition } from './multiband';

const frequencies = [50, 100, 200, 500, 1000, 2000, 4000, 8000, 12000];

function rms(signal: Float32Array, sampleRate: number, fromSeconds = 0.5): number {
  const start = Math.min(signal.length, Math.floor(fromSeconds * sampleRate));
  let sum = 0;
  for (let i = start; i < signal.length; i++) sum += signal[i] * signal[i];
  return Math.sqrt(sum / Math.max(1, signal.length - start));
}

function sine(amplitude: number, frequency: number, sampleRate: number, length: number, phase = 0): Float32Array {
  const signal = new Float32Array(length);
  for (let i = 0; i < length; i++) signal[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate + phase);
  return signal;
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

describe('Multiband compressor crossover reconstruction', () => {
  it.each([44100, 48000, 96000])('keeps the neutral summed response flat at %i Hz sample rate', (sampleRate) => {
    for (const frequency of frequencies) {
      const length = sampleRate;
      const input = sine(0.25, frequency, sampleRate, length);
      const left = input.slice();
      const right = input.slice();
      const processor = new MultibandCompressor();
      processor.prepare(sampleRate, 512);
      processor.setValues(neutralParameters());

      for (let offset = 0; offset < length; offset += 257) {
        const frames = Math.min(257, length - offset);
        processor.process(left.subarray(offset, offset + frames), right.subarray(offset, offset + frames), frames);
      }

      const inputRms = rms(input, sampleRate);
      const outputRms = rms(left, sampleRate);
      const gainDb = 20 * Math.log10(Math.max(outputRms, 1e-12) / Math.max(inputRms, 1e-12));
      expect(gainDb, `frequency ${frequency} Hz at ${sampleRate} Hz`).toBeGreaterThan(-0.15);
      expect(gainDb, `frequency ${frequency} Hz at ${sampleRate} Hz`).toBeLessThan(0.15);
    }
  });

  it('accepts changing block sizes and preserves finite stereo output', () => {
    const sampleRate = 48000;
    const processor = new MultibandCompressor();
    processor.prepare(sampleRate, 512);
    processor.setValues(neutralParameters());
    const left = sine(0.2, 73, sampleRate, sampleRate);
    const right = sine(0.17, 6130, sampleRate, sampleRate, 0.23);
    const blockSizes = [128, 257, 512, 191];
    let offset = 0;
    let blockIndex = 0;
    while (offset < left.length) {
      const frames = Math.min(blockSizes[blockIndex % blockSizes.length], left.length - offset);
      processor.process(left.subarray(offset, offset + frames), right.subarray(offset, offset + frames), frames);
      offset += frames;
      blockIndex++;
    }
    expect(left.every(Number.isFinite)).toBe(true);
    expect(right.every(Number.isFinite)).toBe(true);
  });

  it('keeps bypassed bands audible and solos only the selected band', () => {
    const sampleRate = 48000;
    const length = sampleRate;
    const low = sine(0.2, 100, sampleRate, length);
    const high = sine(0.15, 6000, sampleRate, length);
    const input = Float32Array.from(low, (value, index) => value + high[index]);
    const left = input.slice();
    const right = input.slice();
    const params = neutralParameters();
    params.b0_on = 0; // Bypass compression, not the low band signal.
    params.b0_solo = 1;
    const processor = new MultibandCompressor();
    processor.prepare(sampleRate, 512);
    processor.setValues(params);
    for (let offset = 0; offset < length; offset += 512) {
      const frames = Math.min(512, length - offset);
      processor.process(left.subarray(offset, offset + frames), right.subarray(offset, offset + frames), frames);
    }

    const outputLow = amplitudeAt(left, 100, sampleRate);
    const outputHigh = amplitudeAt(left, 6000, sampleRate);
    expect(outputLow).toBeGreaterThan(0.18);
    expect(outputLow).toBeLessThan(0.22);
    expect(outputHigh).toBeLessThan(0.002);
  });
});

describe('Multiband external sidechain routing', () => {
  it('splits the external key into matching frequency bands before detection', () => {
    const sampleRate = 48000;
    const length = sampleRate;
    const left = sine(0.12, 100, sampleRate, length);
    const right = sine(0.12, 100, sampleRate, length);
    const keyLeft = sine(0.8, 6000, sampleRate, length);
    const keyRight = sine(0.8, 6000, sampleRate, length);
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
    processor.prepare(sampleRate, 512);
    processor.setValues(params);
    for (let offset = 0; offset < length; offset += 512) {
      const frames = Math.min(512, length - offset);
      processor.setSidechain(keyLeft.subarray(offset, offset + frames), keyRight.subarray(offset, offset + frames));
      processor.process(left.subarray(offset, offset + frames), right.subarray(offset, offset + frames), frames);
    }

    const bands = processor.meter().bands ?? [];
    expect(Math.abs(bands[0] ?? 0)).toBeLessThan(0.5);
    expect(Math.abs(bands[1] ?? 0)).toBeLessThan(0.5);
    expect(Math.abs(bands[2] ?? 0)).toBeGreaterThan(5);
    expect(processor.meter().reduction ?? 0).toBeGreaterThan(5);
  });

  it('returns to internal band detection when the external key is cleared', () => {
    const sampleRate = 48000;
    const length = sampleRate;
    const input = sine(0.6, 100, sampleRate, length);
    const key = sine(0.8, 6000, sampleRate, length);
    const left = input.slice();
    const right = input.slice();
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
    processor.prepare(sampleRate, 512);
    processor.setValues(params);
    for (let offset = 0; offset < length / 2; offset += 512) {
      const frames = Math.min(512, length / 2 - offset);
      processor.setSidechain(key.subarray(offset, offset + frames), key.subarray(offset, offset + frames));
      processor.process(left.subarray(offset, offset + frames), right.subarray(offset, offset + frames), frames);
    }
    processor.setSidechain(null, null);
    for (let offset = length / 2; offset < length; offset += 512) {
      const frames = Math.min(512, length - offset);
      processor.process(left.subarray(offset, offset + frames), right.subarray(offset, offset + frames), frames);
    }
    expect(processor.meter().reduction ?? 0).toBeGreaterThan(5);
  });
});

describe('Multiband factory presets', () => {
  it('provides complete, finite and in-range parameter snapshots', () => {
    const specs = new Map(multibandCompDefinition.params.map((spec) => [spec.key, spec]));
    expect(MULTIBAND_PRESETS.length).toBeGreaterThanOrEqual(4);
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

  it('never places the upper crossover below twice the lower crossover', () => {
    for (const preset of MULTIBAND_PRESETS) {
      expect(preset.values.xHigh).toBeGreaterThanOrEqual((preset.values.xLow ?? 0) * 2);
    }
  });
});
