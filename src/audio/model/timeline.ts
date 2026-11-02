import type { ClipState } from './types';

export const MIN_CLIP_DURATION = 0.05;

export interface ClipTiming {
  start: number;
  duration: number;
  offset: number;
}

/** Quantise timeline time to a grid step while never allowing negative positions. */
export function snapTimelineTime(seconds: number, stepSeconds: number, enabled = true): number {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (!enabled || !Number.isFinite(stepSeconds) || stepSeconds <= 0) return safe;
  return Math.max(0, Math.round(safe / stepSeconds) * stepSeconds);
}

/** Move a clip without changing which part of its source audio is used. */
export function moveClipTo(
  clip: Pick<ClipState, 'start' | 'duration' | 'offset'>,
  requestedStart: number,
  stepSeconds: number,
  snapEnabled: boolean,
): ClipTiming {
  return {
    start: snapTimelineTime(requestedStart, stepSeconds, snapEnabled),
    duration: clip.duration,
    offset: clip.offset,
  };
}

/** Trim the beginning and advance the source offset by the removed duration. */
export function trimClipStart(
  clip: Pick<ClipState, 'start' | 'duration' | 'offset'>,
  requestedStart: number,
  stepSeconds: number,
  snapEnabled: boolean,
): ClipTiming {
  const minimumStart = Math.max(0, clip.start - clip.offset);
  const maximumStart = clip.start + clip.duration - MIN_CLIP_DURATION;
  const snapped = snapTimelineTime(requestedStart, stepSeconds, snapEnabled);
  const start = Math.min(maximumStart, Math.max(minimumStart, snapped));
  const shift = start - clip.start;
  return {
    start,
    duration: Math.max(MIN_CLIP_DURATION, clip.duration - shift),
    offset: Math.max(0, clip.offset + shift),
  };
}

/** Trim the end without allowing a clip to extend beyond its source asset. */
export function trimClipEnd(
  clip: Pick<ClipState, 'start' | 'duration' | 'offset'>,
  requestedEnd: number,
  sourceDuration: number,
  stepSeconds: number,
  snapEnabled: boolean,
): ClipTiming {
  const minimumEnd = clip.start + MIN_CLIP_DURATION;
  const availableSourceDuration = Math.max(MIN_CLIP_DURATION, sourceDuration - clip.offset);
  const maximumEnd = clip.start + Math.min(clip.duration + Math.max(0, sourceDuration - clip.offset - clip.duration), availableSourceDuration);
  const snapped = snapTimelineTime(requestedEnd, stepSeconds, snapEnabled);
  const end = Math.min(maximumEnd, Math.max(minimumEnd, snapped));
  return {
    start: clip.start,
    duration: end - clip.start,
    offset: clip.offset,
  };
}
