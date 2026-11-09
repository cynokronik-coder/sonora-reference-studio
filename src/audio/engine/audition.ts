export type AuditionMode = 'before' | 'after';

export interface StereoAuditionBuffers {
  beforeL: Float32Array;
  beforeR: Float32Array;
  afterL: Float32Array;
  afterR: Float32Array;
}

export interface AuditionTransition {
  from: AuditionMode;
  totalFrames: number;
  elapsedFrames: number;
}

/**
 * Select between two simultaneously rendered stereo blocks for the same
 * absolute timeline position. A short linear crossfade avoids clicks when
 * A/B is switched while playback is running. This function allocates no buffers.
 */
export function copyAuditionBlock(
  buffers: StereoAuditionBuffers,
  mode: AuditionMode,
  position: number,
  outL: Float32Array,
  outR: Float32Array,
  transition?: AuditionTransition,
): number {
  const selectedL = mode === 'before' ? buffers.beforeL : buffers.afterL;
  const selectedR = mode === 'before' ? buffers.beforeR : buffers.afterR;
  const previousL = transition?.from === 'before' ? buffers.beforeL : buffers.afterL;
  const previousR = transition?.from === 'before' ? buffers.beforeR : buffers.afterR;
  const total = transition?.totalFrames ?? 0;
  let elapsed = transition?.elapsedFrames ?? total;

  for (let i = 0; i < outL.length; i++) {
    const index = position + i;
    const nextLeft = index >= 0 && index < selectedL.length ? selectedL[index] : 0;
    const nextRight = index >= 0 && index < selectedR.length ? selectedR[index] : 0;
    if (transition && transition.from !== mode && elapsed < total && total > 0) {
      const previousLeft = index >= 0 && index < previousL.length ? previousL[index] : 0;
      const previousRight = index >= 0 && index < previousR.length ? previousR[index] : 0;
      const blend = Math.min(1, (elapsed + 1) / total);
      outL[i] = previousLeft + (nextLeft - previousLeft) * blend;
      outR[i] = previousRight + (nextRight - previousRight) * blend;
      elapsed++;
    } else {
      outL[i] = nextLeft;
      outR[i] = nextRight;
    }
  }
  return Math.min(total, elapsed);
}
