import { ProjectRenderer, type EngineAsset } from './renderer';
import { analyzeLoudness } from '../analysis/loudness';
import type { ProjectState } from '../model/types';

interface RenderRequest {
  type: 'render';
  project: ProjectState;
  assets: { id: string; sampleRate: number; length: number; L: Float32Array; R: Float32Array }[];
  sampleRate: number;
  startSec: number;
  endSec: number;
  statsOnly?: boolean;
}

let cancelled = false;

self.onmessage = (event: MessageEvent) => {
  const message = event.data as RenderRequest | { type: 'cancel' };
  if (message.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (message.type !== 'render') return;
  cancelled = false;
  try {
    render(message);
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

function render(request: RenderRequest): void {
  const sampleRate = request.sampleRate;
  const startSample = Math.max(0, Math.round(request.startSec * sampleRate));
  const endSample = Math.max(startSample + 1, Math.round(request.endSec * sampleRate));
  const blockSize = 512;
  const renderer = new ProjectRenderer();
  const assets: EngineAsset[] = request.assets.map((a) => ({
    id: a.id,
    length: a.length,
    sampleRate: a.sampleRate,
    L: a.L,
    R: a.R,
  }));
  renderer.configure(request.project, assets, sampleRate, blockSize);
  renderer.reset();
  const latency = renderer.totalLatency;
  const totalFrames = endSample - startSample;
  // Render `latency` extra frames; because every path is delayed by exactly
  // that amount, dropping the first `latency` frames aligns the result with the
  // timeline sample-for-sample. This is especially important for the lookahead
  // limiter, whose output is otherwise shifted by several milliseconds.
  const renderFrames = totalFrames + latency;
  const rawL = new Float32Array(renderFrames);
  const rawR = new Float32Array(renderFrames);
  const blockL = new Float32Array(blockSize);
  const blockR = new Float32Array(blockSize);
  const started = performance.now();
  let written = 0;

  let lastReport = 0;
  while (written < renderFrames && !cancelled) {
    const frames = Math.min(blockSize, renderFrames - written);
    renderer.renderBlock(startSample + written, frames, blockL, blockR);
    rawL.set(blockL.subarray(0, frames), written);
    rawR.set(blockR.subarray(0, frames), written);
    written += frames;
    const now = performance.now();
    if (now - lastReport > 80) {
      lastReport = now;
      self.postMessage({
        type: 'progress',
        progress: written / renderFrames,
        elapsedMs: now - started,
      });
    }
  }

  if (cancelled) {
    self.postMessage({ type: 'cancelled' });
    return;
  }

  const outputL = request.statsOnly ? rawL.subarray(latency) : rawL.slice(latency);
  const outputR = request.statsOnly ? rawR.subarray(latency) : rawR.slice(latency);
  const loudness = analyzeLoudness(outputL, outputR, sampleRate);
  let peak = 0;
  for (let i = 0; i < outputL.length; i++) {
    peak = Math.max(peak, Math.abs(outputL[i]), Math.abs(outputR[i]));
  }
  const resultL = request.statsOnly ? new Float32Array(0) : outputL;
  const resultR = request.statsOnly ? new Float32Array(0) : outputR;
  const bufferL = resultL.buffer;
  const bufferR = resultR.buffer;
  (self.postMessage as unknown as (message: unknown, transfer?: Transferable[]) => void)(
    {
      type: 'done',
      L: resultL,
      R: resultR,
      sampleRate,
      stats: {
        lufs: loudness.integratedLufs,
        truePeakDb: loudness.truePeakDb,
        samplePeakDb: loudness.samplePeakDb,
        lra: loudness.lra,
        crestDb: loudness.crestDb,
        duration: totalFrames / sampleRate,
        elapsedMs: performance.now() - started,
        peak,
      },
    },
    request.statsOnly ? [] : [bufferL, bufferR],
  );
}
