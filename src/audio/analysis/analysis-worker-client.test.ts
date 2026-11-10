import { describe, expect, it, vi } from 'vitest';
import { startAnalysisWorker, type AnalysisWorkerMessage, type AnalysisWorkerRequest } from './analysis-worker-client';

class FakeWorker {
  onmessage: ((event: MessageEvent<AnalysisWorkerMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminated = 0;
  sent: { request: AnalysisWorkerRequest; transferables: Transferable[] } | null = null;

  postMessage(request: AnalysisWorkerRequest, transferables: Transferable[] = []) {
    this.sent = { request, transferables };
  }

  terminate() {
    this.terminated++;
  }

  emit(message: AnalysisWorkerMessage) {
    this.onmessage?.({ data: message } as MessageEvent<AnalysisWorkerMessage>);
  }

  fail(message: string) {
    this.onerror?.({ message } as ErrorEvent);
  }
}

const request = (): AnalysisWorkerRequest => ({
  type: 'analyze',
  assetId: 'asset-test',
  L: new Float32Array([0, 0.25, -0.25]),
  R: new Float32Array([0, 0.2, -0.2]),
  sampleRate: 48_000,
  includeSections: true,
});

const report = {
  version: 1,
  createdAt: 1,
  sampleRate: 48_000,
  channels: 2,
  duration: 0,
  loudness: {} as never,
  spectrum: {} as never,
  stereo: {} as never,
  rhythm: {} as never,
  sections: [],
  transients: {} as never,
  resonances: [],
  warnings: [],
};

describe('analysis worker client', () => {
  it('transfers PCM copies and forwards progress before resolving', async () => {
    const worker = new FakeWorker();
    const progress = vi.fn();
    const left = new Float32Array(3);
    const right = new Float32Array(3);
    const task = startAnalysisWorker(worker as unknown as Worker, request(), [left.buffer, right.buffer], progress);

    expect(worker.sent?.request.type).toBe('analyze');
    expect(worker.sent?.transferables).toHaveLength(2);
    worker.emit({ type: 'progress', stage: 'Analysing spectrum', progress: 0.42 });
    expect(progress).toHaveBeenCalledWith('Analysing spectrum', 0.42);

    worker.emit({ type: 'done', assetId: 'asset-test', report: report as never });
    await expect(task.promise).resolves.toBe(report);
    expect(worker.terminated).toBe(1);
    expect(worker.onmessage).toBeNull();
  });

  it('terminates immediately and rejects with AbortError on cancel', async () => {
    const worker = new FakeWorker();
    const task = startAnalysisWorker(worker as unknown as Worker, request(), []);
    const rejected = expect(task.promise).rejects.toMatchObject({ name: 'AbortError', message: 'Analysis cancelled.' });

    task.cancel();
    task.cancel();

    await rejected;
    expect(worker.terminated).toBe(1);
    expect(worker.onmessage).toBeNull();
  });

  it('rejects worker errors and terminates the worker', async () => {
    const worker = new FakeWorker();
    const task = startAnalysisWorker(worker as unknown as Worker, request(), []);
    const rejected = expect(task.promise).rejects.toThrow('Analysis worker crashed.');
    worker.fail('Analysis worker crashed.');

    await rejected;
    expect(worker.terminated).toBe(1);
  });

  it('rejects structured worker errors and terminates the worker', async () => {
    const worker = new FakeWorker();
    const task = startAnalysisWorker(worker as unknown as Worker, request(), []);
    const rejected = expect(task.promise).rejects.toThrow('FFT stage failed.');
    worker.emit({ type: 'error', message: 'FFT stage failed.' });

    await rejected;
    expect(worker.terminated).toBe(1);
  });
});
