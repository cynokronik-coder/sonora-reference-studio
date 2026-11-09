import { describe, expect, it } from 'vitest';
import { createDefaultParams } from '../registry';
import {
  DYNAMIC_EQ_PRESETS,
  DynamicEq,
  dynamicEqDefinition,
} from './dynamicEq';

const SAMPLE_RATE = 48000;
const BLOCK_SIZE = 512;

function sine(amplitude: number, frequency: number, sampleRate = SAMPLE_RATE, seconds = 2, phase = 0): Float32Array {
  const buffer = new Float32Array(Math.floor(sampleRate * seconds));
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate + phase);
  }
  return buffer;
}

function rms(buffer: Float32Array, sampleRate = SAMPLE_RATE, fromSeconds = 0.5): number {
  const start = Math.min(buffer.length, Math.floor(fromSeconds * sampleRate));
  let sum = 0;
  for (let i = start; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / Math.max(1, buffer.length - start));
}

function params(overrides: Record<string, number> = {}): Record<string, number> {
  return {
    ...createDefaultParams('dynamicEq'),
    b0_on: 1,
    b0_freq: 1000,
    b0_q: 1.4,
    b0_threshold: -18,
    b0_range: 18,
    b0_attack: 0.1,
    b0_release: 120,
    b0_ratio: 4,
    b0_knee: 0,
    b0_link: 100,
    b0_mode: 0,
    b0_rmsWindow: 10,
    output: 0,
    ...overrides,
  };
}

function processBlocks(
  processor: DynamicEq,
  left: Float32Array,
  right: Float32Array,
  blockSize = BLOCK_SIZE,
  keyLeft?: Float32Array,
  keyRight?: Float32Array,
): void {
  for (let offset = 0; offset < left.length; offset += blockSize) {
    const frames = Math.min(blockSize, left.length - offset);
    if (keyLeft && keyRight) {
      processor.setSidechain(keyLeft.subarray(offset, offset + frames), keyRight.subarray(offset, offset + frames));
    }
    processor.process(left.subarray(offset, offset + frames), right.subarray(offset, offset + frames), frames);
  }
}

function createProcessor(values: Record<string, number>, sampleRate = SAMPLE_RATE): DynamicEq {
  const processor = new DynamicEq();
  processor.prepare(sampleRate, BLOCK_SIZE);
  processor.setValues(values);
  return processor;
}

describe('Dynamic EQ band detection', () => {
  it('reduces a resonant tone in its active band and reports the measured reduction', () => {
    const left = sine(0.5, 1000);
    const right = left.slice();
    const inputRms = rms(left);
    const processor = createProcessor(params());
    processBlocks(processor, left, right);
    const outputGainDb = 20 * Math.log10(rms(left) / inputRms);
    const meter = processor.meter();
    expect(outputGainDb).toBeLessThan(-3);
    expect(meter.reduction ?? 0).toBeGreaterThan(3);
    expect(meter.bands?.[0] ?? 0).toBeLessThan(-3);
  });

  it('does not trigger a distant band from a non-overlapping tone', () => {
    const left = sine(0.5, 100);
    const right = left.slice();
    const processor = createProcessor(params({
      b0_freq: 6000,
      b0_threshold: -30,
      b0_q: 2,
    }));
    processBlocks(processor, left, right);
    expect(processor.meter().reduction ?? 0).toBeLessThan(0.5);
    expect(rms(left)).toBeCloseTo(rms(sine(0.5, 100)), 3);
  });

  it('keeps all output samples finite with malformed imported parameters', () => {
    const left = sine(0.4, 1000);
    const right = left.slice();
    const processor = createProcessor(params({
      b0_freq: Number.POSITIVE_INFINITY,
      b0_q: Number.NaN,
      b0_threshold: Number.NaN,
      b0_range: Number.POSITIVE_INFINITY,
      b0_attack: Number.NaN,
      b0_release: Number.NEGATIVE_INFINITY,
      b0_ratio: Number.POSITIVE_INFINITY,
      b0_knee: Number.NaN,
      b0_link: Number.NaN,
      output: Number.NaN,
    }));
    processBlocks(processor, left, right);
    expect(left.every(Number.isFinite)).toBe(true);
    expect(right.every(Number.isFinite)).toBe(true);
    expect(processor.meter().reduction).toBeFinite();
  });

  it('reports all four dynamic bands independently', () => {
    const values = params({
      b0_freq: 120, b0_q: 1.3,
      b1_on: 1, b1_freq: 400, b1_q: 1.4,
      b2_on: 1, b2_freq: 2500, b2_q: 1.4,
      b3_on: 1, b3_freq: 7000, b3_q: 1.4,
    });
    const left = Float32Array.from(
      sine(0.35, 120),
      (sample, index) => sample + sine(0.22, 400)[index] + sine(0.18, 2500)[index] + sine(0.14, 7000)[index],
    );
    const right = left.slice();
    const processor = createProcessor(values);
    processBlocks(processor, left, right);
    const bands = processor.meter().bands ?? [];
    expect(bands).toHaveLength(4);
    expect(bands.every((value) => value <= 0 && Number.isFinite(value))).toBe(true);
    expect(bands.some((value) => value < -1)).toBe(true);
  });
});

describe('Dynamic EQ stereo linking', () => {
  it('uses common gain reduction at 100% stereo link', () => {
    const left = sine(0.5, 1000);
    const right = sine(0.05, 1000);
    const inputLeft = rms(left);
    const inputRight = rms(right);
    const processor = createProcessor(params({ b0_link: 100 }));
    processBlocks(processor, left, right);
    const gainL = rms(left) / inputLeft;
    const gainR = rms(right) / inputRight;
    expect(gainL).toBeCloseTo(gainR, 2);
    expect(gainL).toBeLessThan(0.6);
  });

  it('allows independent left/right attenuation at 0% stereo link', () => {
    const left = sine(0.5, 1000);
    const right = sine(0.05, 1000);
    const inputLeft = rms(left);
    const inputRight = rms(right);
    const processor = createProcessor(params({ b0_link: 0 }));
    processBlocks(processor, left, right);
    const gainL = rms(left) / inputLeft;
    const gainR = rms(right) / inputRight;
    expect(gainL).toBeLessThan(0.6);
    expect(gainR).toBeGreaterThan(0.95);
  });
});

describe('Dynamic EQ detector modes and external key', () => {
  it('uses peak and RMS detector modes with different readings on a steady sine', () => {
    const input = sine(0.1, 1000);
    const peakL = input.slice();
    const peakR = input.slice();
    const rmsL = input.slice();
    const rmsR = input.slice();
    const peakProcessor = createProcessor(params({ b0_threshold: -22, b0_mode: 0, b0_range: 8 }));
    const rmsProcessor = createProcessor(params({ b0_threshold: -22, b0_mode: 1, b0_range: 8, b0_rmsWindow: 10 }));
    processBlocks(peakProcessor, peakL, peakR);
    processBlocks(rmsProcessor, rmsL, rmsR);
    expect(peakProcessor.meter().reduction ?? 0).toBeGreaterThan(0.5);
    expect(rmsProcessor.meter().reduction ?? 0).toBeLessThan(0.5);
  });

  it('responds to a frequency-matched external sidechain while preserving a quiet programme', () => {
    const programmeL = sine(0.02, 1000);
    const programmeR = programmeL.slice();
    const keyL = sine(0.8, 1000);
    const keyR = keyL.slice();
    const inputRms = rms(programmeL);
    const processor = createProcessor(params({ b0_threshold: -24, b0_range: 12 }));
    processBlocks(processor, programmeL, programmeR, BLOCK_SIZE, keyL, keyR);
    expect(processor.meter().reduction ?? 0).toBeGreaterThan(5);
    expect(rms(programmeL) / inputRms).toBeLessThan(0.6);
  });

  it('clears the external key and returns to internal detection', () => {
    const length = SAMPLE_RATE * 2;
    const programme = sine(0.02, 1000, SAMPLE_RATE, 2);
    const key = sine(0.8, 1000, SAMPLE_RATE, 2);
    const left = programme.slice();
    const right = programme.slice();
    const processor = createProcessor(params({ b0_threshold: -24, b0_range: 12, b0_release: 80 }));

    for (let offset = 0; offset < length / 2; offset += BLOCK_SIZE) {
      const frames = Math.min(BLOCK_SIZE, length / 2 - offset);
      processor.setSidechain(key.subarray(offset, offset + frames), key.subarray(offset, offset + frames));
      processor.process(left.subarray(offset, offset + frames), right.subarray(offset, offset + frames), frames);
    }
    expect(processor.meter().reduction ?? 0).toBeGreaterThan(5);

    processor.setSidechain(null, null);
    for (let offset = length / 2; offset < length; offset += BLOCK_SIZE) {
      const frames = Math.min(BLOCK_SIZE, length - offset);
      processor.process(left.subarray(offset, offset + frames), right.subarray(offset, offset + frames), frames);
    }
    expect(processor.meter().reduction ?? 0).toBeLessThan(0.5);
  });

  it('does not allocate a new detector or programme buffer per process block', () => {
    const processor = createProcessor(params());
    const left = sine(0.2, 1000, SAMPLE_RATE, 1);
    const right = left.slice();
    const detectorBuffers = (processor as unknown as { detectorInputL: Float32Array; detectorInputR: Float32Array });
    const beforeL = detectorBuffers.detectorInputL;
    const beforeR = detectorBuffers.detectorInputR;
    processBlocks(processor, left, right);
    expect(detectorBuffers.detectorInputL).toBe(beforeL);
    expect(detectorBuffers.detectorInputR).toBe(beforeR);
  });
});

describe('Dynamic EQ factory presets', () => {
  it('contains complete, finite and in-range parameter snapshots', () => {
    const specs = new Map(dynamicEqDefinition.params.map((spec) => [spec.key, spec]));
    expect(DYNAMIC_EQ_PRESETS.length).toBeGreaterThanOrEqual(4);
    for (const preset of DYNAMIC_EQ_PRESETS) {
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
