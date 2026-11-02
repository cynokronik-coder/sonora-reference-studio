import type { AssistantProposal, AssistantOperation } from './assistant';
import { createDefaultParams, findParam, clampParam, getDefinition } from '../dsp/registry';
import { chainFor } from '../model/project';
import type { ProjectState } from '../model/types';
import { uid } from '../model/defaults';

type RecordValue = Record<string, unknown>;

function record(value: unknown, name: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`AI proposal has an invalid ${name} object.`);
  }
  return value as RecordValue;
}

function boundedText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`AI proposal is missing ${name}.`);
  return value.trim().slice(0, maxLength);
}

/**
 * Validate model-generated operations against the live project and DSP registry.
 * No project mutation occurs here; a validated proposal still needs user approval.
 */
export function createValidatedAiProposal(raw: unknown, project: ProjectState): AssistantProposal {
  const input = record(raw, 'proposal');
  const message = boundedText(input.message, 'message', 360);
  const explanationInput = Array.isArray(input.explanation) ? input.explanation : [];
  const explanation = explanationInput.slice(0, 8).map((line, index) => boundedText(line, `explanation ${index + 1}`, 240));
  const confidence = typeof input.confidence === 'number' && Number.isFinite(input.confidence)
    ? Math.max(0, Math.min(1, input.confidence))
    : 0.5;
  if (!Array.isArray(input.operations) || input.operations.length < 1 || input.operations.length > 8) {
    throw new Error('AI proposal must contain between 1 and 8 processor operations.');
  }

  const operations: AssistantOperation[] = input.operations.map((value, index) => {
    const rawOperation = record(value, `operation ${index + 1}`);
    const kind = rawOperation.kind;
    const scope = rawOperation.scope;
    if (!['add', 'update', 'remove', 'bypass', 'enable'].includes(String(kind))) {
      throw new Error(`Operation ${index + 1} has an unsupported action.`);
    }
    if (!['master', 'track', 'bus'].includes(String(scope))) {
      throw new Error(`Operation ${index + 1} has an unsupported target.`);
    }
    const operationKind = kind as AssistantOperation['kind'];
    const operationScope = scope as AssistantOperation['scope'];
    const requestedTrackId = typeof rawOperation.trackId === 'string' ? rawOperation.trackId : null;
    if (operationScope === 'master' && requestedTrackId !== null) {
      throw new Error('Master-chain operations must not include a track or bus ID.');
    }
    if (operationScope !== 'master' && !requestedTrackId) {
      throw new Error('Track and bus operations require an exact target ID.');
    }
    const chain = chainFor(project, operationScope, requestedTrackId);
    if (!chain) throw new Error(`Operation ${index + 1} targets a track or bus that no longer exists.`);

    const processorType = boundedText(rawOperation.processorType, 'processor type', 80);
    const definition = getDefinition(processorType);
    if (!definition) throw new Error(`The DSP registry does not contain processor "${processorType}".`);

    const requestedProcessorId = typeof rawOperation.processorId === 'string' ? rawOperation.processorId : null;
    let processorId = requestedProcessorId;
    let base: Record<string, number> | undefined;
    const parametersInput = Array.isArray(rawOperation.parameters) ? rawOperation.parameters : [];
    if (parametersInput.length > 40) throw new Error('An operation contains too many parameter changes.');
    const changes: Record<string, number> = {};
    for (const [parameterIndex, parameterValue] of parametersInput.entries()) {
      const parameter = record(parameterValue, `parameter ${parameterIndex + 1}`);
      const key = boundedText(parameter.key, 'parameter key', 80);
      if (typeof parameter.value !== 'number' || !Number.isFinite(parameter.value)) {
        throw new Error(`Parameter "${key}" must be a finite number.`);
      }
      if (!findParam(processorType, key)) {
        throw new Error(`"${key}" is not a parameter of ${definition.name}.`);
      }
      changes[key] = clampParam(processorType, key, parameter.value);
    }

    if (operationKind === 'add') {
      if (requestedProcessorId !== null) throw new Error('New processors must not reference an existing processor ID.');
      const defaults = createDefaultParams(processorType);
      base = defaults;
      processorId = uid('ai-proc');
      Object.assign(defaults, changes);
      if (chain.some((node) => node.type === processorType && node.enabled)) {
        // Duplicate processors can be intentional; the model must state why.
        const note = typeof rawOperation.note === 'string' ? rawOperation.note : '';
        if (note.trim().length < 12) {
          throw new Error(`Explain why another ${definition.name} is needed before adding a duplicate.`);
        }
      }
      changes && Object.assign(changes, defaults);
    } else {
      if (!requestedProcessorId) throw new Error(`Operation ${index + 1} must reference an existing processor ID.`);
      const existing = chain.find((node) => node.id === requestedProcessorId);
      if (!existing || existing.type !== processorType) {
        throw new Error(`Processor "${requestedProcessorId}" is not a ${processorType} in the selected chain.`);
      }
      base = { ...existing.params };
      if (operationKind === 'update' && Object.keys(changes).length === 0) {
        throw new Error('An update operation must change at least one parameter.');
      }
      if (operationKind !== 'update' && parametersInput.length > 0) {
        throw new Error('Only update and add operations may include parameter changes.');
      }
    }

    const note = boundedText(rawOperation.note, 'operation note', 220);
    const result: AssistantOperation = {
      kind: operationKind,
      scope: operationScope,
      trackId: requestedTrackId ?? undefined,
      processorType,
      processorId: processorId ?? undefined,
      note,
      label: definition.name,
    };
    if (operationKind === 'add') {
      result.params = changes;
      result.base = base;
    } else if (operationKind === 'update') {
      result.params = changes;
      result.base = base;
    }
    return result;
  });

  const hasReferenceOperation = operations.some((operation) => operation.kind === 'reference-match');
  return {
    id: uid('ai-proposal'),
    message,
    explanation,
    operations,
    requiresReference: hasReferenceOperation,
    confidence,
  };
}
