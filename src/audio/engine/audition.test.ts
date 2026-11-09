import { describe, expect, it } from 'vitest';
import { copyAuditionBlock, type StereoAuditionBuffers } from './audition';

function buffers(): StereoAuditionBuffers {
  return {
    beforeL: Float32Array.from([0.1, 0.2, 0.3, 0.4]),
    beforeR: Float32Array.from([-0.1, -0.2, -0.3, -0.4]),
    afterL: Float32Array.from([0.5, 0.6, 0.7, 0.8]),
    afterR: Float32Array.from([-0.5, -0.6, -0.7, -0.8]),
  };
}

describe('copyAuditionBlock', () => {
  it('copies the selected version from the same absolute sample position', () => {
    const left = new Float32Array(2);
    const right = new Float32Array(2);
    copyAuditionBlock(buffers(), 'after', 1, left, right);
    expect([...left]).toEqual([0.6, 0.7]);
    expect([...right]).toEqual([-0.6, -0.7]);
  });

  it('copies the before version without changing its samples', () => {
    const left = new Float32Array(3);
    const right = new Float32Array(3);
    copyAuditionBlock(buffers(), 'before', 0, left, right);
    expect([...left]).toEqual([0.1, 0.2, 0.3]);
    expect([...right]).toEqual([-0.1, -0.2, -0.3]);
  });

  it('crossfades from the old version to the new version over the requested frames', () => {
    const left = new Float32Array(2);
    const right = new Float32Array(2);
    const elapsed = copyAuditionBlock(
      buffers(),
      'after',
      0,
      left,
      right,
      { from: 'before', totalFrames: 2, elapsedFrames: 0 },
    );
    expect(left[0]).toBeCloseTo(0.3, 6);
    expect(left[1]).toBeCloseTo(0.8, 6);
    expect(right[0]).toBeCloseTo(-0.3, 6);
    expect(right[1]).toBeCloseTo(-0.8, 6);
    expect(elapsed).toBe(2);
  });

  it('zero-fills samples beyond the rendered audition', () => {
    const left = new Float32Array(3);
    const right = new Float32Array(3);
    copyAuditionBlock(buffers(), 'after', 3, left, right);
    expect([...left]).toEqual([0.8, 0, 0]);
    expect([...right]).toEqual([-0.8, 0, 0]);
  });
});
