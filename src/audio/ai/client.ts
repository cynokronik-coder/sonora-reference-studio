export interface SonoraAiStatus {
  configured: boolean;
  model: string;
  provider: string;
}

export interface SonoraAiResponse {
  id?: string;
  model: string;
  output: Record<string, unknown>[];
  outputText: string;
}

export async function getSonoraAiStatus(): Promise<SonoraAiStatus> {
  const response = await fetch('/api/health', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('The Sonora AI server is not reachable.');
  return response.json() as Promise<SonoraAiStatus>;
}

export async function requestSonoraAi(
  input: unknown[],
  context: Record<string, unknown>,
): Promise<SonoraAiResponse> {
  const response = await fetch('/api/assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ input, context }),
  });
  const payload = await response.json().catch(() => ({})) as {
    error?: string;
    id?: string;
    model?: string;
    output?: Record<string, unknown>[];
    outputText?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || `Sonora AI request failed (${response.status}).`);
  }
  return {
    id: payload.id,
    model: payload.model || 'configured model',
    output: Array.isArray(payload.output) ? payload.output : [],
    outputText: payload.outputText || '',
  };
}
