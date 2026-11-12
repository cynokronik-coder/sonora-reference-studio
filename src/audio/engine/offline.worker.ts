import { ProjectRenderer, type EngineAsset } from './renderer';
import { analyzeLoudness } from '../analysis/loudness';
import { copyLatencyAlignedBlock } from './offline-render';
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
const blockSize = 512;
const yieldIntervalMs = 24;

self.onmessage = (event: MessageEvent) => {
  const message = event.data as RenderRequest | { type: 'cancel' };
  if (message.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (message.type !== 'render') return;
  cancelled = false;
  void render(message).catch((error) => {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  });
};

function yieldToWorkerEvents(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function render(request: RenderRequest): Promise<void> {
  const sampleRate = request.sampleRate;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error('The offline render sample rate is invalid.');
  }
  if (!Number.isFinite(request.startSec) || !Number.isFinite(request.endSec) || request.endSec <= request.startSec) {
    throw new Error('The offline render range is invalid.');
  }

  const startSample = Math.max(0, Math.round(request.startSec * sampleRate));
  const endSample = Math.max(startSample + 1, Math.round(request.endSec * sampleRate));
  const totalFrames = endSample - startSample;
  if (!Number.isSafeInteger(startSample) || !Number.isSafeInteger(endSample) || !Number.isSafeInteger(totalFrames)) {
    throw new Error('The offline render range is too large.');
  }

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
  if (!Number.isInteger(latency) || latency < 0 || !Number.isSafeInteger(totalFrames + latency)) {
    throw new Error('The offline render latency or range is invalid.');
  }

  // Render latency extra frames, then write only the timeline-aligned samples
  // directly into the final output arrays. This avoids the previous full-length
  // rawL/rawR allocation followed by another full-length slice copy.
  const renderFrames = totalFrames + latency;
  const outputL = new Float32Array(totalFrames);
  const outputR = new Float32Array(totalFrames);
  const blockL = new Float32Array(blockSize);
  const blockR = new Float32Array(blockSize);
  const started = performance.now();
  let written = 0;
  let lastReport = 0;
  let lastYield = started;

  while (written < renderFrames && !cancelled) {
    const frames = Math.min(blockSize, renderFrames - written);
    renderer.renderBlock(startSample + written, frames, blockL, blockR);
    copyLatencyAlignedBlock(blockL, blockR, frames, written, latency, outputL, outputR);
    written += frames;

    const now = performance.now();
    if (now - lastReport > 80) {
      lastReport = now;
      self.postMessage({
        type: 'progress',
        progress: Math.min(1, written / renderFrames),
        elapsedMs: now - started,
      });
    }
    // Worker message events cannot run during a synchronous render loop. Yield
    // on a short wall-clock budget so a queued Cancel action can be observed.
    if (now - lastYield >= yieldIntervalMs) {
      await yieldToWorkerEvents();
      lastYield = performance.now();
    }
  }

  if (cancelled) {
    self.postMessage({ type: 'cancelled' });
    return;
  }

  // Give a cancel event queued at the end of the final render block one last
  // opportunity to run before the synchronous loudness analysis begins.
  await yieldToWorkerEvents();
  if (cancelled) {
    self.postMessage({ type: 'cancelled' });
    return;
  }

  // Stats-only callers still need the complete programme for integrated
  // loudness/LRA analysis, but do not return or transfer those PCM arrays.
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
