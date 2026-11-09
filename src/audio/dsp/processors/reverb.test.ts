import { describe, expect, it } from 'vitest';
import { createDefaultParams } from '../registry';
import { REVERB_PRESETS, Reverb, reverbDefinition } from './reverb';

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
function rms(values: Float32Array, start: number, end = values.length): number {
  let energy = 0;
  for (let i = start; i < end; i++) energy += values[i] * values[i];
  return Math.sqrt(energy / Math.max(1, end - start));
}
function render(values: Record<string, number>, sourceL: Float32Array, sourceR = sourceL) {
  const processor = new Reverb();
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
    ...createDefaultParams('reverb'),
    style: 1,
    predelay: 20,
    decay: 2.4,
    damping: 0.35,
    diffusion: 0.75,
    width: 100,
    lowCut: 120,
    highCut: 8_000,
    mix: 25,
    output: 0,
  };
}
function impulse(amplitude = 0.8, at = 0): Float32Array {
  const result = new Float32Array(FRAME_COUNT);
  result[at] = amplitude;
  return result;
}

describe('Reverb algorithm and signal path', () => {
  it('returns the exact dry signal at 0% wet mix after the blend has settled', () => {
    const sourceL = tone(997, 0.31);
    const sourceR = tone(2_317, 0.17, 0.25);
    const result = render({ ...defaults(), mix: 0 }, sourceL, sourceR);
    expect(result.left.subarray(2_048)).toEqual(sourceL.subarray(2_048));
    expect(result.right.subarray(2_048)).toEqual(sourceR.subarray(2_048));
  });

  it('generates a measurable reverberant tail after an impulse', () => {
    const source = impulse();
    const result = render({ ...defaults(), predelay: 0, decay: 2.4, mix: 100 }, source);
    expect(rms(result.left, Math.round(SAMPLE_RATE * 0.08), Math.round(SAMPLE_RATE * 1.5))).toBeGreaterThan(1e-5);
    expect(result.meter.peakL ?? 0).toBeGreaterThan(0);
    expect(result.meter.peakR ?? 0).toBeGreaterThan(0);
  });

  it('produces a longer tail when RT60 decay is increased', () => {
    const source = impulse();
    const short = render({ ...defaults(), predelay: 0, decay: 0.5, damping: 0.1, mix: 100 }, source);
    const long = render({ ...defaults(), predelay: 0, decay: 8, damping: 0.1, mix: 100 }, source);
    const start = Math.round(SAMPLE_RATE * 0.9);
    const end = Math.round(SAMPLE_RATE * 1.8);
    expect(rms(long.left, start, end)).toBeGreaterThan(rms(short.left, start, end) * 1.5);
  });

  it('supports the complete 250 ms pre-delay range without reading the current write slot', () => {
    const source = impulse(0.8, 0);
    const delayed = render({ ...defaults(), predelay: 250, decay: 2.4, mix: 100 }, source);
    expect(rms(delayed.left, 0, Math.round(SAMPLE_RATE * 0.24))).toBeLessThan(1e-8);
    expect(rms(delayed.left, Math.round(SAMPLE_RATE * 0.28), Math.round(SAMPLE_RATE * 0.8))).toBeGreaterThan(1e-6);
  });

  it('keeps a centred mono source centred when the reverb width is zero', () => {
    const source = tone(1_000, 0.3);
    const mono = render({ ...defaults(), predelay: 0, mix: 100, width: 0 }, source);
    expect(rms(mono.left, 4_096)).toBeGreaterThan(0);
    for (let i = 4_096; i < FRAME_COUNT; i++) {
      expect(mono.left[i]).toBeCloseTo(mono.right[i], 5);
    }
  });

  it('creates a decorrelated stereo tail from a mono impulse when width is open', () => {
    const source = impulse();
    const result = render({ ...defaults(), predelay: 0, decay: 2.4, mix: 100, width: 100 }, source);
    let sideEnergy = 0;
    let totalEnergy = 0;
    for (let i = 4_096; i < FRAME_COUNT; i++) {
      const side = result.left[i] - result.right[i];
      sideEnergy += side * side;
      totalEnergy += result.left[i] * result.left[i] + result.right[i] * result.right[i];
    }
    expect(sideEnergy).toBeGreaterThan(1e-8);
    expect(totalEnergy).toBeGreaterThan(1e-8);
  });

  it('keeps output finite while decay, damping, predelay, width and tone filters change', () => {
    const processor = new Reverb();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    for (let block = 0; block < 36; block++) {
      processor.setValues({
        ...defaults(),
        style: block % 4,
        decay: 0.2 + (block % 10) * 0.9,
        damping: (block % 10) / 10,
        predelay: (block % 6) * 40,
        diffusion: 0.2 + (block % 8) * 0.1,
        width: (block % 6) * 30,
        lowCut: 60 + (block % 8) * 50,
        highCut: 2_000 + (block % 8) * 2_000,
        mix: (block % 5) * 25,
        output: -3 + (block % 6),
      });
      const start = block * BLOCK_SIZE;
      for (let i = 0; i < BLOCK_SIZE; i++) {
        left[i] = 0.4 * Math.sin((2 * Math.PI * 1_000 * (start + i)) / SAMPLE_RATE);
        right[i] = 0.25 * Math.sin((2 * Math.PI * 2_000 * (start + i)) / SAMPLE_RATE + 0.2);
      }
      processor.process(left, right, BLOCK_SIZE);
      for (const sample of left) expect(Number.isFinite(sample)).toBe(true);
      for (const sample of right) expect(Number.isFinite(sample)).toBe(true);
    }
  });

  it('does not allocate or overrun for the prepared block and rejects larger blocks', () => {
    const processor = new Reverb();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    expect(() => processor.process(left, right, BLOCK_SIZE)).not.toThrow();
    expect(() => processor.process(new Float32Array(BLOCK_SIZE + 1), new Float32Array(BLOCK_SIZE + 1), BLOCK_SIZE + 1)).toThrow(RangeError);
  });

  it('resets delay, comb and allpass histories without outputting stale tails', () => {
    const processor = new Reverb();
    processor.prepare(SAMPLE_RATE, BLOCK_SIZE);
    processor.setValues({ ...defaults(), predelay: 0, mix: 100 });
    const left = new Float32Array(BLOCK_SIZE);
    const right = new Float32Array(BLOCK_SIZE);
    left[0] = right[0] = 0.8;
    processor.process(left, right, BLOCK_SIZE);
    processor.reset();
    left.fill(0);
    right.fill(0);
    for (let block = 0; block < 20; block++) {
      processor.process(left, right, BLOCK_SIZE);
      for (const sample of left) expect(Math.abs(sample)).toBeLessThan(1e-8);
      for (const sample of right) expect(Math.abs(sample)).toBeLessThan(1e-8);
    }
  });
});

describe('Reverb factory presets', () => {
  it('contains complete valid parameter maps for all space characters', () => {
    const specs = new Map(reverbDefinition.params.map((param) => [param.key, param]));
    expect(REVERB_PRESETS.length).toBeGreaterThanOrEqual(4);
    for (const preset of REVERB_PRESETS) {
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
