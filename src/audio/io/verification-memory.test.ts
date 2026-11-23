import { describe, expect, it } from 'vitest';
import {
  estimateVerificationWorkingSetBytes,
  formatMemoryEstimate,
  MAX_VERIFY_WORKING_SET_BYTES,
  shouldDeferVerification,
} from './verification-memory';

describe('verification memory guard', () => {
  it('estimates known PCM decode copies and reserves headroom', () => {
    const estimate = estimateVerificationWorkingSetBytes({
      encodedBytes: 48_000,
      decodedFrames: 1_000,
      channels: 2,
    });
    expect(estimate).toBe(2 * 48_000 + 1_000 * 2 * 4 * 2 + 64 * 1024 * 1024);
  });

  it('uses a conservative multiplier when the codec duration is unknown', () => {
    expect(estimateVerificationWorkingSetBytes({ encodedBytes: 1_000_000 })).toBe(
      1_000_000 * 24 + 64 * 1024 * 1024,
    );
  });

  it('defers verification above the working-set budget', () => {
    expect(shouldDeferVerification(MAX_VERIFY_WORKING_SET_BYTES)).toBe(false);
    expect(shouldDeferVerification(MAX_VERIFY_WORKING_SET_BYTES + 1)).toBe(true);
    expect(shouldDeferVerification(Number.POSITIVE_INFINITY)).toBe(true);
  });

  it('formats the estimate as a readable MiB amount', () => {
    expect(formatMemoryEstimate(2 * 1024 * 1024)).toBe('approximately 2 MiB of temporary memory');
  });

  it('rejects impossible dimensions conservatively', () => {
    expect(estimateVerificationWorkingSetBytes({ encodedBytes: -1 })).toBe(Number.POSITIVE_INFINITY);
    expect(estimateVerificationWorkingSetBytes({ encodedBytes: 1, decodedFrames: -1 })).toBe(Number.POSITIVE_INFINITY);
  });
});
