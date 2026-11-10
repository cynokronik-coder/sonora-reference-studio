import { describe, expect, it } from 'vitest';
import { shouldPauseTransport } from './realtime';

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
