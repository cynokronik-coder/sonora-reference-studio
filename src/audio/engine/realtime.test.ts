import { describe, expect, it } from 'vitest';
import { planAssetSync, shouldPauseTransport } from './realtime';

describe('transport toggle during audio context interruptions', () => {
  it('pauses normally while the audio context is running', () => {
    expect(shouldPauseTransport(true, 'running')).toBe(true);
  });

  it('attempts to resume when the context was suspended or interrupted', () => {
    expect(shouldPauseTransport(true, 'suspended')).toBe(false);
    expect(shouldPauseTransport(true, 'interrupted')).toBe(false);
  });

  it('rebuilds rather than treating a closed context as a normal pause', () => {
    expect(shouldPauseTransport(true, 'closed')).toBe(false);
  });

  it('starts playback when the transport is already stopped', () => {
    expect(shouldPauseTransport(false, 'running')).toBe(false);
  });
});

describe('AudioWorklet asset residency plan', () => {
  it('releases assets no longer referenced by the active project', () => {
    expect(planAssetSync(['old-a', 'shared', 'old-b'], ['shared', 'new-a'])).toEqual({
      releaseIds: ['old-a', 'old-b'],
      loadIds: ['new-a'],
    });
  });

  it('does not retransmit assets already resident in the worklet', () => {
    expect(planAssetSync(['one', 'two'], ['two', 'one'])).toEqual({
      releaseIds: [],
      loadIds: [],
    });
  });

  it('handles empty projects and deduplicates requested asset ids', () => {
    expect(planAssetSync(['one', 'two'], [])).toEqual({
      releaseIds: ['one', 'two'],
      loadIds: [],
    });
    expect(planAssetSync([], ['one', 'one', 'two'])).toEqual({
      releaseIds: [],
      loadIds: ['one', 'two'],
    });
  });
});
