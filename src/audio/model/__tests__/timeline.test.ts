import { describe, expect, it } from 'vitest';
import { moveClipTo, snapTimelineTime, trimClipEnd, trimClipStart } from '../timeline';
import type { ClipState } from '../types';

const clip: Pick<ClipState, 'start' | 'duration' | 'offset'> = {
  start: 4,
  duration: 6,
  offset: 2,
};

describe('timeline editing', () => {
  it('snaps positions to the selected grid and never allows negative time', () => {
    expect(snapTimelineTime(1.13, 0.5, true)).toBe(1);
    expect(snapTimelineTime(1.13, 0.5, false)).toBeCloseTo(1.13);
    expect(snapTimelineTime(-3, 0.25, true)).toBe(0);
  });

  it('moves a clip without changing its source range', () => {
    expect(moveClipTo(clip, 7.1, 0.5, true)).toEqual({ start: 7, duration: 6, offset: 2 });
  });

  it('trims the start by advancing source offset and preserving the source end', () => {
    expect(trimClipStart(clip, 5.5, 0.5, true)).toEqual({
      start: 5.5,
      duration: 4.5,
      offset: 3.5,
    });
    expect(trimClipStart(clip, 0, 0.5, true).offset).toBe(0);
  });

  it('trims the end at the source file boundary', () => {
    const trimmed = trimClipEnd(clip, 20, 8, 0.5, true);
    expect(trimmed.start).toBe(4);
    expect(trimmed.duration).toBe(6);
    expect(trimmed.offset + trimmed.duration).toBe(8);
  });

  it('does not permit an empty clip', () => {
    expect(trimClipEnd(clip, 4, 8, 0.25, true).duration).toBeGreaterThan(0);
    expect(trimClipStart(clip, 99, 0.25, true).duration).toBeGreaterThan(0);
  });
});
