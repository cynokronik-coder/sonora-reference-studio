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
 * Copy the selected pre-rendered comparison version at the same absolute
 * timeline position. A short linear crossfade avoids clicks when A/B is
 * switched while playback is running. This function allocates no buffers.
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

export interface AuditionBlockRenderer {
  renderBlock(position: number, frames: number, outL: Float32Array, outR: Float32Array): void;
}

/**
 * Render both versions for the same absolute timeline block, then select or
 * crossfade the output. Scratch arrays are caller-owned and reused per block.
 */
export function renderAuditionBlock(
  beforeRenderer: AuditionBlockRenderer,
  afterRenderer: AuditionBlockRenderer,
  position: number,
  mode: AuditionMode,
  scratch: StereoAuditionBuffers,
  outL: Float32Array,
  outR: Float32Array,
  transition?: AuditionTransition,
): number {
  const frames = outL.length;
  if (outR.length !== frames ||
      scratch.beforeL.length < frames || scratch.beforeR.length < frames ||
      scratch.afterL.length < frames || scratch.afterR.length < frames) {
    throw new RangeError('A/B audition scratch buffers must fit the output block.');
  }
  beforeRenderer.renderBlock(position, frames, scratch.beforeL, scratch.beforeR);
  afterRenderer.renderBlock(position, frames, scratch.afterL, scratch.afterR);
  return copyAuditionBlock(scratch, mode, 0, outL, outR, transition);
}
