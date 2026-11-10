import { describe, expect, it } from 'vitest';
import { copyAuditionBlock, renderAuditionBlock, type StereoAuditionBuffers } from './audition';

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
    expect(left[0]).toBeCloseTo(0.6, 6);
    expect(left[1]).toBeCloseTo(0.7, 6);
    expect(right[0]).toBeCloseTo(-0.6, 6);
    expect(right[1]).toBeCloseTo(-0.7, 6);
  });

  it('copies the before version without changing its samples', () => {
    const left = new Float32Array(3);
    const right = new Float32Array(3);
    copyAuditionBlock(buffers(), 'before', 0, left, right);
    expect(left[0]).toBeCloseTo(0.1, 6);
    expect(left[1]).toBeCloseTo(0.2, 6);
    expect(left[2]).toBeCloseTo(0.3, 6);
    expect(right[0]).toBeCloseTo(-0.1, 6);
    expect(right[1]).toBeCloseTo(-0.2, 6);
    expect(right[2]).toBeCloseTo(-0.3, 6);
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
    expect(left[1]).toBeCloseTo(0.6, 6);
    expect(right[0]).toBeCloseTo(-0.3, 6);
    expect(right[1]).toBeCloseTo(-0.6, 6);
    expect(elapsed).toBe(2);
  });

  it('zero-fills samples beyond the rendered audition', () => {
    const left = new Float32Array(3);
    const right = new Float32Array(3);
    copyAuditionBlock(buffers(), 'after', 3, left, right);
    expect(left[0]).toBeCloseTo(0.8, 6);
    expect(left[1]).toBe(0);
    expect(left[2]).toBe(0);
    expect(right[0]).toBeCloseTo(-0.8, 6);
    expect(right[1]).toBe(0);
    expect(right[2]).toBe(0);
  });
});


describe('renderAuditionBlock', () => {
  it('renders both versions once at the same absolute sample position', () => {
    const calls: Array<{ name: string; position: number; frames: number }> = [];
    const before = {
      renderBlock(position: number, frames: number, left: Float32Array, right: Float32Array) {
        calls.push({ name: 'before', position, frames });
        for (let i = 0; i < frames; i++) {
          left[i] = (position + i) / 100;
          right[i] = -(position + i) / 100;
        }
      },
    };
    const after = {
      renderBlock(position: number, frames: number, left: Float32Array, right: Float32Array) {
        calls.push({ name: 'after', position, frames });
        for (let i = 0; i < frames; i++) {
          left[i] = (position + i) / 50;
          right[i] = -(position + i) / 50;
        }
      },
    };
    const scratch: StereoAuditionBuffers = {
      beforeL: new Float32Array(4),
      beforeR: new Float32Array(4),
      afterL: new Float32Array(4),
      afterR: new Float32Array(4),
    };
    const left = new Float32Array(3);
    const right = new Float32Array(3);

    renderAuditionBlock(before, after, 1200, 'after', scratch, left, right);

    expect(calls).toEqual([
      { name: 'before', position: 1200, frames: 3 },
      { name: 'after', position: 1200, frames: 3 },
    ]);
    expect(left[0]).toBeCloseTo(24, 6);
    expect(left[2]).toBeCloseTo(24.04, 5);
    expect(right[0]).toBeCloseTo(-24, 6);
    expect(right[2]).toBeCloseTo(-24.04, 5);
  });

  it('uses the same-position before block as the source when selecting A', () => {
    const makeRenderer = (offset: number) => ({
      renderBlock(position: number, frames: number, left: Float32Array, right: Float32Array) {
        for (let i = 0; i < frames; i++) {
          left[i] = position + i + offset;
          right[i] = -(position + i + offset);
        }
      },
    });
    const scratch: StereoAuditionBuffers = {
      beforeL: new Float32Array(2), beforeR: new Float32Array(2),
      afterL: new Float32Array(2), afterR: new Float32Array(2),
    };
    const left = new Float32Array(2);
    const right = new Float32Array(2);

    renderAuditionBlock(makeRenderer(10), makeRenderer(20), 50, 'before', scratch, left, right);

    expect([...left]).toEqual([60, 61]);
    expect([...right]).toEqual([-60, -61]);
  });


  it('uses a shared pre-master render when the before renderer supports it', () => {
    let pairedCalls = 0;
    const before = {
      renderBlock() { throw new Error('The optimized path should not render the graph twice.'); },
      renderPairedBlock(
        _other: typeof after,
        position: number,
        frames: number,
        beforeL: Float32Array,
        beforeR: Float32Array,
        afterL: Float32Array,
        afterR: Float32Array,
      ) {
        pairedCalls++;
        for (let i = 0; i < frames; i++) {
          beforeL[i] = (position + i) / 10;
          beforeR[i] = -(position + i) / 10;
          afterL[i] = (position + i) / 5;
          afterR[i] = -(position + i) / 5;
        }
        return true;
      },
    };
    const after = {
      renderBlock() { throw new Error('The optimized path should not render the graph twice.'); },
    };
    const scratch: StereoAuditionBuffers = {
      beforeL: new Float32Array(4), beforeR: new Float32Array(4),
      afterL: new Float32Array(4), afterR: new Float32Array(4),
    };
    const left = new Float32Array(2);
    const right = new Float32Array(2);

    renderAuditionBlock(before, after, 20, 'after', scratch, left, right);

    expect(pairedCalls).toBe(1);
    expect([...left]).toEqual([4, 4.2]);
    expect([...right]).toEqual([-4, -4.2]);
  });

  it('crossfades rendered blocks and rejects undersized scratch buffers', () => {
    const makeRenderer = (value: number) => ({
      renderBlock(_position: number, frames: number, left: Float32Array, right: Float32Array) {
        left.fill(value, 0, frames);
        right.fill(-value, 0, frames);
      },
    });
    const scratch: StereoAuditionBuffers = {
      beforeL: new Float32Array(2), beforeR: new Float32Array(2),
      afterL: new Float32Array(2), afterR: new Float32Array(2),
    };
    const left = new Float32Array(2);
    const right = new Float32Array(2);

    renderAuditionBlock(
      makeRenderer(0.2), makeRenderer(0.6), 900, 'after', scratch, left, right,
      { from: 'before', totalFrames: 2, elapsedFrames: 0 },
    );
    expect(left[0]).toBeCloseTo(0.4, 6);
    expect(left[1]).toBeCloseTo(0.6, 6);
    expect(right[0]).toBeCloseTo(-0.4, 6);
    expect(right[1]).toBeCloseTo(-0.6, 6);

    expect(() => renderAuditionBlock(
      makeRenderer(0), makeRenderer(1), 0, 'after',
      { ...scratch, afterR: new Float32Array(1) },
      left, right,
    )).toThrow(RangeError);
  });
});
