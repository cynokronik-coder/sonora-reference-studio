import { describe, expect, it } from 'vitest';
import { createProject, createTrack, createProcessorNode } from '../../model/defaults';
import { getDefinition } from '../../dsp/registry';
import { createValidatedAiProposal } from '../proposals';

function projectWithTrack() {
  const project = createProject('AI proposal test');
  const track = createTrack('vocal', 'Lead Vocal', 0);
  track.processors.push(createProcessorNode('eq'));
  project.tracks.push(track);
  return { project, track };
}

describe('AI proposal validation', () => {
  it('accepts a valid track EQ update without mutating the project', () => {
    const { project, track } = projectWithTrack();
    const before = structuredClone(track.processors[0].params);
    const proposal = createValidatedAiProposal({
      message: 'Reduce a little low-mid buildup.',
      explanation: ['The selected vocal track has an EQ available for a focused adjustment.'],
      confidence: 0.82,
      operations: [{
        kind: 'update',
        scope: 'track',
        trackId: track.id,
        processorType: 'eq',
        processorId: track.processors[0].id,
        parameters: [{ key: 'b1_gain', value: -2 }],
        note: 'Small, reversible low-mid reduction.',
      }],
    }, project);

    expect(proposal.operations).toHaveLength(1);
    expect(proposal.operations[0].scope).toBe('track');
    expect(proposal.operations[0].params?.b1_gain).toBe(-2);
    expect(track.processors[0].params).toEqual(before);
  });

  it('rejects unknown processors and parameter keys', () => {
    const { project, track } = projectWithTrack();
    expect(() => createValidatedAiProposal({
      message: 'Invalid processor.',
      explanation: [],
      confidence: 0.5,
      operations: [{
        kind: 'add',
        scope: 'track',
        trackId: track.id,
        processorType: 'invented-plugin',
        processorId: null,
        parameters: [],
        note: 'Not allowed.',
      }],
    }, project)).toThrow(/DSP registry/);

    expect(() => createValidatedAiProposal({
      message: 'Invalid parameter.',
      explanation: [],
      confidence: 0.5,
      operations: [{
        kind: 'update',
        scope: 'track',
        trackId: track.id,
        processorType: 'eq',
        processorId: track.processors[0].id,
        parameters: [{ key: 'fake_control', value: 1 }],
        note: 'Not allowed.',
      }],
    }, project)).toThrow(/not a parameter/);
  });

  it('clamps parameters to the real registry range', () => {
    const { project, track } = projectWithTrack();
    const spec = getDefinition('eq')?.params.find((parameter) => parameter.key === 'b1_gain');
    expect(spec?.max).toBeTypeOf('number');
    const proposal = createValidatedAiProposal({
      message: 'Keep the adjustment inside the supported EQ range.',
      explanation: [],
      confidence: 0.9,
      operations: [{
        kind: 'update',
        scope: 'track',
        trackId: track.id,
        processorType: 'eq',
        processorId: track.processors[0].id,
        parameters: [{ key: 'b1_gain', value: (spec?.max ?? 12) + 100 }],
        note: 'The value is clamped to the supported range.',
      }],
    }, project);
    expect(proposal.operations[0].params?.b1_gain).toBe(spec?.max);
  });

  it('rejects stale track and processor IDs', () => {
    const { project } = projectWithTrack();
    expect(() => createValidatedAiProposal({
      message: 'Stale target.',
      explanation: [],
      confidence: 0.5,
      operations: [{
        kind: 'remove',
        scope: 'track',
        trackId: 'missing-track',
        processorType: 'eq',
        processorId: 'missing-processor',
        parameters: [],
        note: 'This operation should not be allowed.',
      }],
    }, project)).toThrow(/no longer exists/);
  });
});
