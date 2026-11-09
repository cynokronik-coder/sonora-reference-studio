import { describe, expect, it } from 'vitest';
import { createDefaultParams } from '../registry';
import { STEREO_PRESETS, StereoProcessor, stereoDefinition } from './stereo';

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 512;
const FRAME_COUNT = BLOCK_SIZE * 96;

function tone(frequency: number, amplitude: number, phase = 0): Float32Array {
  const result = new Float32Array(FRAME_COUNT);
  for (let i = 0; i < result.length; i++) {
    result[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE + phase);
  }
  return result;
}
function projection(values: Float32Array, frequency: number, start = 4_096): number {
  let sinProjection = 0;
  let cosProjection = 0;
  let count = 0;
  for (let i = start; i < values.length; i++) {
    const angle = (2 * Math.PI * frequency * i) / SAMPLE_RATE;
    sinProjection += values[i] * Math.sin(angle);
    cosProjection += values[i] * Math.cos(angle);
    count++;
  }
  return (2 * Math.hypot(sinProjection, cosProjection)) / Math.max(1, count);
}
function signedProjection(values: Float32Array, frequency: number, start = 4_096): number {
  let sinProjection = 0;
  let cosProjection = 0;
  let count = 0;
  for (let i = start; i < values.length; i++) {
    const angle = (2 * Math.PI * frequency * i) / SAMPLE_RATE;
    sinProjection += values[i] * Math.sin(angle);
    cosProjection += values[i] * Math.cos(angle);
    count++;
  }
  // Sine projection keeps the sign, unlike projection() which reports magnitude.
  return (2 * sinProjection) / Math.max(1, count);
}
function rms(values: Float32Array, start = 4_096): number {
  let energy = 0;
  for (let i = start; i < values.length; i++) energy += values[i] * values[i];
  return Math.sqrt(energy / Math.max(1, values.length - start));
}
function render(values: Record<string, number>, sourceL: Float32Array, sourceR = sourceL) {
  const processor = new StereoProcessor();
  processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
  processor.setValues(values);
  const left = sourceL.slice();
  const right = sourceR.slice();
  for (let start = 0; start < FRAME_COUNT; start += BLOCK_SIZE) {
    processor.process(left.subarray(start, start + BLOCK_SIZE), right.subarray(start, start + BLOCK_SIZE), BLOCK_SIZE);
  }
  return { left, right, meter: processor.meter() };
}
function defaults() {
  return {
    ...createDefaultParams('stereo'),
    width: 100, lowWidth: 0, highWidth: 100, split: 180, monoMaker: 1,
    midGain: 0, sideGain: 0, balance: 0, haas: 0, haasMix: 0, output: 0,
  };
}

describe('Stereo imaging M/S and frequency-dependent width', () => {
  it('preserves a centred mono signal at neutral settings', () => {
    const source = tone(1_000, 0.25);
    const result = render(defaults(), source);
    expect(projection(result.left, 1_000)).toBeGreaterThan(0.22);
    expect(projection(result.left, 1_000)).toBeLessThan(0.27);
    expect(projection(result.right, 1_000)).toBeCloseTo(projection(result.left, 1_000), 5);
  });

  it('collapses low-frequency side information when mono-maker is enabled', () => {
    const source = tone(80, 0.25);
    const result = render(defaults(), source, source.map((sample) => -sample));
    expect(projection(result.left, 80)).toBeLessThan(0.012);
    expect(projection(result.right, 80)).toBeLessThan(0.012);
  });

  it('preserves low-frequency side information when mono-maker is disabled and low width is 100%', () => {
    const source = tone(80, 0.25);
    const result = render({ ...defaults(), monoMaker: 0, lowWidth: 100 }, source, source.map((sample) => -sample));
    const leftSide = signedProjection(result.left, 80);
    const rightSide = signedProjection(result.right, 80);
    expect(Math.abs(leftSide)).toBeGreaterThan(0.2);
    expect(Math.abs(rightSide)).toBeGreaterThan(0.2);
    expect(leftSide).toBeCloseTo(-rightSide, 2);
    const sum = new Float32Array(FRAME_COUNT);
    for (let i = 0; i < FRAME_COUNT; i++) sum[i] = result.left[i] + result.right[i];
    expect(rms(sum)).toBeLessThan(rms(result.left) * 0.02);
  });

  it('collapses the full stereo side signal when global width is zero', () => {
    const source = tone(2_000, 0.3);
    const result = render({ ...defaults(), width: 0, monoMaker: 0, lowWidth: 100, highWidth: 100 }, source, source.map((sample) => -sample));
    expect(Math.abs(projection(result.left, 2_000))).toBeLessThan(0.002);
    expect(Math.abs(projection(result.right, 2_000))).toBeLessThan(0.002);
  });

  it('scales upper-band side information with the high-width control', () => {
    const source = tone(8_000, 0.2);
    const narrow = render({ ...defaults(), highWidth: 50, split: 180 }, source, source.map((sample) => -sample));
    const wide = render({ ...defaults(), highWidth: 150, split: 180 }, source, source.map((sample) => -sample));
    const narrowAmplitude = Math.abs(projection(narrow.left, 8_000));
    const wideAmplitude = Math.abs(projection(wide.left, 8_000));
    expect(wideAmplitude).toBeGreaterThan(narrowAmplitude * 2.5);
    expect(wideAmplitude).toBeLessThan(narrowAmplitude * 3.5);
  });

  it('applies mid gain to centred programme while keeping side gain independent', () => {
    const source = tone(1_000, 0.3);
    const midReduced = render({ ...defaults(), midGain: -6, sideGain: 0 }, source);
    const sideReduced = render({ ...defaults(), midGain: 0, sideGain: -6 }, source);
    expect(Math.abs(projection(midReduced.left, 1_000))).toBeCloseTo(0.3 * Math.pow(10, -6 / 20), 2);
    expect(Math.abs(projection(sideReduced.left, 1_000))).toBeCloseTo(0.3, 2);
  });

  it('delays only the right channel in Haas mode and preserves the left channel', () => {
    const sourceL = new Float32Array(FRAME_COUNT);
    const sourceR = new Float32Array(FRAME_COUNT);
    sourceL[100] = 0.5;
    sourceR[100] = 0.5;
    const baseline = render(defaults(), sourceL, sourceR);
    const delayed = render({ ...defaults(), haas: 10, haasMix: 100 }, sourceL, sourceR);
    for (let i = 4_096; i < FRAME_COUNT; i++) {
      expect(delayed.left[i]).toBeCloseTo(baseline.left[i], 6);
    }
    expect(delayed.right[100]).toBeCloseTo(0, 5);
    expect(delayed.right[580]).toBeCloseTo(baseline.right[100], 5);
  });

  it('keeps the Haas delay history fresh while the effect is disabled', () => {
    const processor = new StereoProcessor();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    const silenceL = new Float32Array(BLOCK_SIZE);
    const silenceR = new Float32Array(BLOCK_SIZE);
    processor.setValues({ ...defaults(), haas: 10, haasMix: 0 });
    for (let block = 0; block < 3; block++) {
      silenceL.fill(0.1);
      silenceR.fill(0.1);
      processor.process(silenceL, silenceR, BLOCK_SIZE);
    }
    processor.setValues({ ...defaults(), haas: 10, haasMix: 100 });
    silenceL.fill(0.1);
    silenceR.fill(0.1);
    processor.process(silenceL, silenceR, BLOCK_SIZE);
    // The ring has been advancing even with Haas disabled: no old/stale samples
    // are replayed when the effect is enabled.
    expect(silenceR[0]).toBeCloseTo(0.1, 2);
  });

  it('keeps output finite during crossover, width, balance and gain changes', () => {
    const processor = new StereoProcessor();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    for (let block = 0; block < 36; block++) {
      processor.setValues({
        ...defaults(),
        split: 80 + (block % 12) * 45,
        width: (block % 5) * 50,
        lowWidth: (block % 4) * 50,
        highWidth: (block % 5) * 50,
        midGain: -6 + (block % 6) * 2,
        sideGain: -5 + (block % 5) * 2,
        balance: -80 + (block % 9) * 20,
        output: -3 + (block % 6),
      });
      left.set(tone(1_000, 0.35).subarray(0, BLOCK_SIZE));
      right.set(tone(3_000, 0.25, 0.2).subarray(0, BLOCK_SIZE));
      processor.process(left, right, BLOCK_SIZE);
      for (const sample of left) expect(Number.isFinite(sample)).toBe(true);
      for (const sample of right) expect(Number.isFinite(sample)).toBe(true);
    }
  });

  it('reports finite independent channel output peaks', () => {
    const left = tone(440, 0.8);
    const right = tone(440, 0.2);
    const result = render(defaults(), left, right);
    expect(result.meter.peakL ?? 0).toBeGreaterThan(result.meter.peakR ?? 0);
    expect(Number.isFinite(result.meter.peakL ?? 0)).toBe(true);
    expect(Number.isFinite(result.meter.peakR ?? 0)).toBe(true);
  });

  it('rejects blocks larger than the preallocated render size', () => {
    const processor = new StereoProcessor();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    expect(() => processor.process(new Float32Array(BLOCK_SIZE + 1), new Float32Array(BLOCK_SIZE + 1), BLOCK_SIZE + 1)).toThrow(RangeError);
  });
});

describe('Stereo imaging factory presets', () => {
  it('contains complete valid parameter maps for all starting points', () => {
    const specs = new Map(stereoDefinition.params.map((param) => [param.key, param]));
    for (const preset of STEREO_PRESETS) {
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
