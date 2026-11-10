import { describe, expect, it } from 'vitest';
import { resampleStereoSinc } from './resample';

function tone(rate: number, frequency: number, seconds: number, amplitude = 0.5) {
  const samples = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / rate);
  }
  return samples;
}

function rms(samples: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, end - start));
}

describe('polyphase Kaiser-windowed sample-rate conversion', () => {
  it('returns the original arrays without allocating when the rates match', async () => {
    const left = new Float32Array([0.1, -0.2, 0.3]);
    const right = new Float32Array([-0.1, 0.2, -0.3]);
    const result = await resampleStereoSinc(left, right, 48_000, 48_000);
    expect(result.L).toBe(left);
    expect(result.R).toBe(right);
  });

  it('produces the exact ceiling frame count and preserves a constant signal', async () => {
    const left = new Float32Array(4_410).fill(0.25);
    const right = new Float32Array(4_410).fill(-0.125);
    const result = await resampleStereoSinc(left, right, 44_100, 48_000);
    expect(result.L).toHaveLength(4_800);
    expect(result.R).toHaveLength(4_800);
    expect(result.L[2_400]).toBeCloseTo(0.25, 5);
    expect(result.R[2_400]).toBeCloseTo(-0.125, 5);
  });

  it('preserves a pass-band 1 kHz tone across a common 44.1 to 48 kHz conversion', async () => {
    const source = tone(44_100, 1_000, 0.5);
    const result = await resampleStereoSinc(source, source, 44_100, 48_000);
    const measured = rms(result.L, 2_000, result.L.length - 2_000);
    expect(measured).toBeGreaterThan(0.34);
    expect(measured).toBeLessThan(0.37);
  });

  it('suppresses a tone above the destination Nyquist frequency during downsampling', async () => {
    const source = tone(48_000, 18_000, 1);
    const result = await resampleStereoSinc(source, source, 48_000, 16_000);
    const measured = rms(result.L, 500, result.L.length - 500);
    expect(measured).toBeLessThan(0.002);
  });

  it('yields in bounded blocks and reports monotonically increasing progress', async () => {
    const source = tone(48_000, 440, 0.25);
    const progress: number[] = [];
    await resampleStereoSinc(source, source, 48_000, 44_100, {
      blockFrames: 1024,
      onProgress: (value) => progress.push(value),
    });
    expect(progress.length).toBeGreaterThan(1);
    expect(progress[0]).toBeGreaterThan(0);
    expect(progress[progress.length - 1]).toBe(1);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
  });

  it('honours cancellation between output blocks', async () => {
    const source = tone(48_000, 440, 1);
    const controller = new AbortController();
    await expect(resampleStereoSinc(source, source, 48_000, 44_100, {
      blockFrames: 256,
      signal: controller.signal,
      onProgress: () => controller.abort(),
    })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects invalid rates and mismatched stereo lengths', async () => {
    const samples = new Float32Array([0, 1]);
    await expect(resampleStereoSinc(samples, samples, 0, 48_000)).rejects.toThrow(/positive/);
    await expect(resampleStereoSinc(samples, new Float32Array(1), 48_000, 44_100)).rejects.toThrow(/same number/);
  });
});
