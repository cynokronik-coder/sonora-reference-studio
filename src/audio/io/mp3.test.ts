import { describe, expect, it } from 'vitest';
import { fillStereoPcm16Block } from './mp3';

describe('fillStereoPcm16Block', () => {
  it('converts a selected stereo region into signed 16-bit samples', () => {
    const left = new Int16Array(3);
    const right = new Int16Array(3);

    fillStereoPcm16Block(
      Float32Array.from([0.9, -0.5, 0.25, 0.75]),
      Float32Array.from([-0.9, 0.5, -0.25, -0.75]),
      1,
      3,
      left,
      right,
    );

    expect([...left]).toEqual([-16383, 8192, 24575]);
    expect([...right]).toEqual([16384, -8192, -24575]);
  });

  it('clips out-of-range floats and does not overwrite unused scratch entries', () => {
    const left = Int16Array.from([123, 123, 123]);
    const right = Int16Array.from([456, 456, 456]);

    fillStereoPcm16Block(
      Float32Array.from([-2, 0, 2]),
      Float32Array.from([2, 0, -2]),
      0,
      2,
      left,
      right,
    );

    expect([...left]).toEqual([-32768, 0, 123]);
    expect([...right]).toEqual([32767, 0, 456]);
  });

  it('rejects source ranges or target buffers that are too short', () => {
    expect(() => fillStereoPcm16Block(
      new Float32Array(2), new Float32Array(2), 1, 2,
      new Int16Array(2), new Int16Array(2),
    )).toThrow(RangeError);
  });
});
