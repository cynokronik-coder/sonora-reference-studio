export const MAX_VERIFY_WORKING_SET_BYTES = 512 * 1024 * 1024;
const UNKNOWN_CODEC_MEMORY_MULTIPLIER = 24;
const VERIFICATION_SAFETY_RESERVE_BYTES = 64 * 1024 * 1024;

export interface VerificationMemoryEstimate {
  encodedBytes: number;
  decodedFrames?: number | null;
  channels?: number;
}

/**
 * Conservative estimate for decode-and-measure verification.
 *
 * decodeAudioFile currently materializes the encoded file twice (arrayBuffer
 * plus a decoder input copy), then owns both a decoded AudioBuffer and copied
 * left/right Float32 channels. The reserve covers analysis/decoder overhead.
 * Browsers may allocate more, so this is a guardrail rather than a guarantee.
 */
export function estimateVerificationWorkingSetBytes(
  options: VerificationMemoryEstimate,
): number {
  const { encodedBytes, decodedFrames, channels = 2 } = options;
  if (!Number.isFinite(encodedBytes) || encodedBytes < 0 || !Number.isInteger(channels) || channels < 1) {
    return Number.POSITIVE_INFINITY;
  }

  if (decodedFrames === null || decodedFrames === undefined) {
    return encodedBytes * UNKNOWN_CODEC_MEMORY_MULTIPLIER + VERIFICATION_SAFETY_RESERVE_BYTES;
  }
  if (!Number.isSafeInteger(decodedFrames) || decodedFrames < 0) {
    return Number.POSITIVE_INFINITY;
  }

  const encodedCopies = encodedBytes * 2;
  const decodedPcmCopies = decodedFrames * channels * Float32Array.BYTES_PER_ELEMENT * 2;
  const estimate = encodedCopies + decodedPcmCopies + VERIFICATION_SAFETY_RESERVE_BYTES;
  return Number.isSafeInteger(estimate) ? estimate : Number.POSITIVE_INFINITY;
}

export function formatMemoryEstimate(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown memory requirement';
  const mib = bytes / (1024 * 1024);
  return `approximately ${Math.ceil(mib)} MiB of temporary memory`;
}

export function shouldDeferVerification(estimateBytes: number): boolean {
  return !Number.isFinite(estimateBytes) || estimateBytes > MAX_VERIFY_WORKING_SET_BYTES;
}
