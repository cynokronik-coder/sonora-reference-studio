import { analyzeAudio, type AnalysisReport } from './analyze';
import { analyzeLoudness, type LoudnessReport } from './loudness';

interface AnalyzeRequest {
  type: 'analyze';
  assetId: string;
  L: Float32Array;
  R: Float32Array;
  sampleRate: number;
  includeSections: boolean;
}

interface LoudnessRequest {
  type: 'loudness';
  L: Float32Array;
  R: Float32Array;
  sampleRate: number;
}

self.onmessage = (event: MessageEvent) => {
  const message = event.data as AnalyzeRequest | LoudnessRequest;
  try {
    if (message.type === 'analyze') {
      const report: AnalysisReport = analyzeAudio(
        {
          assetId: message.assetId,
          L: message.L,
          R: message.R,
          sampleRate: message.sampleRate,
        },
        {
          includeSections: message.includeSections,
          onProgress: (stage, fraction) => {
            self.postMessage({ type: 'progress', stage, progress: fraction });
          },
        },
      );
      self.postMessage({ type: 'done', assetId: message.assetId, report });
    } else if (message.type === 'loudness') {
      const report: LoudnessReport = analyzeLoudness(message.L, message.R, message.sampleRate);
      self.postMessage({ type: 'loudness', report });
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
