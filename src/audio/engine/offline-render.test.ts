import { describe, expect, it } from 'vitest';
import { copyLatencyAlignedBlock } from './offline-render';

describe('copyLatencyAlignedBlock', () => {
  it('drops latency that begins inside the first rendered block', () => {
    const outputL = new Float32Array(4);
    const outputR = new Float32Array(4);

    const copied = copyLatencyAlignedBlock(
      Float32Array.from([10, 11, 12, 13, 14, 15]),
      Float32Array.from([-10, -11, -12, -13, -14, -15]),
      6,
      0,
      2,
      outputL,
      outputR,
    );

    expect(copied).toBe(4);
    expect([...outputL]).toEqual([12, 13, 14, 15]);
    expect([...outputR]).toEqual([-12, -13, -14, -15]);
  });

  it('keeps exact sample order when latency crosses a block boundary', () => {
    const outputL = new Float32Array(5);
    const outputR = new Float32Array(5);
    const firstL = Float32Array.from([0, 1, 2, 3]);
    const firstR = Float32Array.from([0, -1, -2, -3]);
    const secondL = Float32Array.from([4, 5, 6, 7]);
    const secondR = Float32Array.from([-4, -5, -6, -7]);

    expect(copyLatencyAlignedBlock(firstL, firstR, 4, 0, 3, outputL, outputR)).toBe(1);
    expect(copyLatencyAlignedBlock(secondL, secondR, 4, 4, 3, outputL, outputR)).toBe(4);

    expect([...outputL]).toEqual([3, 4, 5, 6, 7]);
    expect([...outputR]).toEqual([-3, -4, -5, -6, -7]);
  });

  it('supports zero latency and truncates the final block to the requested output length', () => {
    const outputL = new Float32Array(3);
    const outputR = new Float32Array(3);

    const copied = copyLatencyAlignedBlock(
      Float32Array.from([1, 2, 3, 4]),
      Float32Array.from([-1, -2, -3, -4]),
      4,
      0,
      0,
      outputL,
      outputR,
    );

    expect(copied).toBe(3);
    expect([...outputL]).toEqual([1, 2, 3]);
    expect([...outputR]).toEqual([-1, -2, -3]);
  });

  it('rejects invalid block sizes and latency values', () => {
    const block = new Float32Array(4);
    const output = new Float32Array(4);
    expect(() => copyLatencyAlignedBlock(block, block, 5, 0, 0, output, output)).toThrow(RangeError);
    expect(() => copyLatencyAlignedBlock(block, block, 4, 0, -1, output, output)).toThrow(RangeError);
  });
});
