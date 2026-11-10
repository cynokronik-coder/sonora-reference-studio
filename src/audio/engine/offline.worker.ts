import { ProjectRenderer, type EngineAsset } from './renderer';
import { analyzeLoudnessAsync } from '../analysis/loudness';
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
let activeAnalysisController: AbortController | null = null;
const blockSize = 512;
const yieldIntervalMs = 24;

self.onmessage = (event: MessageEvent) => {
  const message = event.data as RenderRequest | { type: 'cancel' };
  if (message.type === 'cancel') {
    cancelled = true;
    activeAnalysisController?.abort();
    return;
  }
  if (message.type !== 'render') return;
  cancelled = false;
  const controller = new AbortController();
  activeAnalysisController = controller;
  void render(message, controller.signal)
    .catch((error) => {
      const wasCancelled = cancelled || (error instanceof Error && error.name === 'AbortError');
      self.postMessage(wasCancelled
        ? { type: 'cancelled' }
        : {
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
    })
    .finally(() => {
      if (activeAnalysisController === controller) activeAnalysisController = null;
    });
};

function yieldToWorkerEvents(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function render(request: RenderRequest, signal: AbortSignal): Promise<void> {
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
        stage: 'Rendering audio',
        progress: Math.min(0.85, (written / renderFrames) * 0.85),
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

  // Loudness analysis yields between bounded PCM blocks so the worker can
  // service Cancel while measuring long programmes instead of becoming
  // unresponsive after the final render block.
  self.postMessage({
    type: 'progress',
    stage: 'Measuring loudness',
    progress: 0.86,
    elapsedMs: performance.now() - started,
  });
  const loudness = await analyzeLoudnessAsync(outputL, outputR, sampleRate, {
    signal,
    onProgress: (fraction) => {
      self.postMessage({
        type: 'progress',
        stage: 'Measuring loudness',
        progress: 0.86 + fraction * 0.13,
        elapsedMs: performance.now() - started,
      });
    },
  });
  if (cancelled || signal.aborted) {
    self.postMessage({ type: 'cancelled' });
    return;
  }
  // Preserve the legacy peak scalar without another full programme scan.
  const peak = Number.isFinite(loudness.samplePeakDb)
    ? Math.pow(10, loudness.samplePeakDb / 20)
    : 0;
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
