import { describe, expect, it } from 'vitest';
import { Annex2TruePeakMeter } from './oversample';

const SAMPLE_RATE = 48_000;

function sine(frequency: number, amplitude: number, phase: number, frames: number): Float32Array {
  const values = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    values[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE + phase);
  }
  return values;
}

describe('ITU-R BS.1770-5 Annex 2 true-peak meter', () => {
  it('detects the inter-sample peak of an unfavourably phased 12 kHz tone', () => {
    const amplitude = 0.8;
    const left = sine(12_000, amplitude, Math.PI / 4, SAMPLE_RATE);
    const right = new Float32Array(left.length);
    let samplePeak = 0;
    for (const sample of left) samplePeak = Math.max(samplePeak, Math.abs(sample));

    const meter = new Annex2TruePeakMeter();
    const measured = Math.max(
      meter.process(left.subarray(0, 512), right.subarray(0, 512), 512),
      ...Array.from({ length: Math.ceil((left.length - 512) / 512) }, (_, block) => {
        const start = 512 + block * 512;
        const end = Math.min(left.length, start + 512);
        return meter.process(left.subarray(start, end), right.subarray(start, end), end - start);
      }),
      meter.flush(),
    );

    expect(samplePeak).toBeLessThan(amplitude * 0.72);
    expect(measured).toBeGreaterThan(samplePeak * 1.35);
    expect(measured).toBeGreaterThan(amplitude * 0.99);
    expect(measured).toBeLessThan(amplitude * 1.02);
  });

  it('produces the same measurement regardless of render block boundaries', () => {
    const left = sine(11_997, 0.91, 0.29, 20_000);
    const right = sine(8_113, 0.42, -0.7, 20_000);
    const wholeMeter = new Annex2TruePeakMeter();
    const whole = Math.max(wholeMeter.process(left, right, left.length), wholeMeter.flush());

    const chunkedMeter = new Annex2TruePeakMeter();
    let chunked = 0;
    for (let start = 0; start < left.length; start += 127) {
      const end = Math.min(left.length, start + 127);
      chunked = Math.max(
        chunked,
        chunkedMeter.process(left.subarray(start, end), right.subarray(start, end), end - start),
      );
    }
    chunked = Math.max(chunked, chunkedMeter.flush());
    expect(chunked).toBeCloseTo(whole, 12);
  });

  it('includes a transient at the end of the file when the FIR tail is flushed', () => {
    const left = new Float32Array(2_000);
    const right = new Float32Array(2_000);
    left[left.length - 1] = 0.95;
    const meter = new Annex2TruePeakMeter();
    const beforeFlush = meter.process(left, right, left.length);
    const afterFlush = meter.flush();
    expect(afterFlush).toBeGreaterThan(beforeFlush * 10);
    // The specified finite 48-tap FIR is an approximation to ideal band-limited
    // reconstruction; a one-sample transient is not expected to reconstruct
    // with perfect unity amplitude.
    expect(afterFlush).toBeGreaterThan(0.95 * 0.96);
  });

  it('tracks stereo channels independently and ignores silence', () => {
    const left = new Float32Array(4_096);
    const right = new Float32Array(4_096);
    right[1_200] = -0.75;
    const meter = new Annex2TruePeakMeter();
    const measured = Math.max(meter.process(left, right, left.length), meter.flush());
    expect(measured).toBeGreaterThanOrEqual(0.75 * 0.97);

    meter.reset();
    expect(Math.max(meter.process(left, left, left.length), meter.flush())).toBe(0);
  });
});
