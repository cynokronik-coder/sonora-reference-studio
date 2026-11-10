import type { AnalysisReport } from './analyze';

export interface AnalysisWorkerRequest {
  type: 'analyze';
  assetId: string;
  L: Float32Array;
  R: Float32Array;
  sampleRate: number;
  includeSections: boolean;
}

export type AnalysisWorkerMessage =
  | { type: 'progress'; stage: string; progress: number }
  | { type: 'done'; assetId: string; report: AnalysisReport }
  | { type: 'error'; message: string };

export interface AnalysisWorkerTask {
  promise: Promise<AnalysisReport>;
  cancel: () => void;
}

/**
 * Starts an analysis worker with hard cancellation.
 *
 * The DSP stages are synchronous inside a dedicated worker, so a posted
 * "cancel" message cannot be serviced while a stage is executing. Terminating
 * the worker is immediate, stops every analysis stage, and releases the
 * worker's transferred PCM copies without blocking the UI thread.
 */
export function startAnalysisWorker(
  worker: Worker,
  request: AnalysisWorkerRequest,
  transferables: Transferable[],
  onProgress?: (stage: string, progress: number) => void,
): AnalysisWorkerTask {
  let settled = false;
  let resolvePromise: (report: AnalysisReport) => void = () => {};
  let rejectPromise: (error: Error) => void = () => {};

  const promise = new Promise<AnalysisReport>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const cleanup = () => {
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  };

  const rejectOnce = (error: Error) => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectPromise(error);
  };

  const resolveOnce = (report: AnalysisReport) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolvePromise(report);
  };

  const cancel = () => {
    const error = new Error('Analysis cancelled.');
    error.name = 'AbortError';
    rejectOnce(error);
  };

  worker.onmessage = (event: MessageEvent<AnalysisWorkerMessage>) => {
    if (settled) return;
    const message = event.data;
    if (message.type === 'progress') {
      try {
        onProgress?.(message.stage, message.progress);
      } catch (error) {
        rejectOnce(error instanceof Error ? error : new Error(String(error)));
      }
    } else if (message.type === 'done') {
      resolveOnce(message.report);
    } else {
      rejectOnce(new Error(message.message));
    }
  };

  worker.onerror = (event: ErrorEvent) => {
    rejectOnce(new Error(event.message || 'Analysis worker failed.'));
  };

  worker.onmessageerror = () => {
    rejectOnce(new Error('Could not read the analysis worker response.'));
  };

  try {
    worker.postMessage(request, transferables);
  } catch (error) {
    rejectOnce(error instanceof Error ? error : new Error(String(error)));
  }

  return { promise, cancel };
}
