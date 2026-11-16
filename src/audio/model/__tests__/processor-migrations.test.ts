import { describe, expect, it } from 'vitest';
import { createProcessorNode, createProject, createTrack, createBus } from '../defaults';
import { migrateLegacyGateParams, migrateProjectProcessorNodes } from '../migrations';

describe('legacy gate state migration', () => {
  it('preserves the old ratio slope and supplies compatible controls', () => {
    const migrated = migrateLegacyGateParams({ ratio: 4, threshold: -30, range: 24 });

    expect(migrated.ratio).toBe(4);
    expect(migrated.curve).toBe(1);
    expect(migrated.knee).toBe(0);
    expect(migrated.link).toBe(100);
    expect(migrated.output).toBe(0);
    expect(migrated.threshold).toBe(-30);
    expect(migrated.range).toBe(24);
  });

  it('migrates gate nodes throughout projects once and leaves current state unchanged', () => {
    const project = createProject();
    project.tracks.push(createTrack('audio', 'Track', 0));
    project.buses.push(createBus('Bus', 0));
    project.master.processors.push(createProcessorNode('gate', { ratio: 4 }));
    project.tracks[0].processors.push(createProcessorNode('gate', { ratio: 2 }));
    project.buses[0].processors.push(createProcessorNode('gate', { ratio: 8 }));
    project.masters.push({
      id: 'master-version',
      name: 'Version',
      createdAt: 0,
      lufs: null,
      truePeak: null,
      processors: [createProcessorNode('gate', { ratio: 4 })],
    });
    const nodes = [
      project.master.processors[0],
      project.tracks[0].processors[0],
      project.buses[0].processors[0],
      project.masters[0].processors[0],
    ];
    project.tracks[0].automation.push({
      id: 'legacy-ratio-automation',
      target: 'volume',
      processorId: nodes[1].id,
      param: 'ratio',
      points: [{ time: 0, value: 4, curve: 0 }],
      enabled: true,
    });
    for (const node of nodes) {
      node.version = 1;
      delete node.params.knee;
      delete node.params.curve;
      delete node.params.link;
      delete node.params.output;
    }

    expect(migrateProjectProcessorNodes(project)).toBe(true);
    expect(nodes.every((node) => node.version === 2)).toBe(true);
    expect(nodes.map((node) => node.params.knee)).toEqual([0, 0, 0, 0]);
    expect(nodes.map((node) => node.params.curve)).toEqual([1, 1, 1, 1]);
    expect(nodes.map((node) => node.params.ratio)).toEqual([4, 2, 8, 4]);
    expect(project.tracks[0].automation[0].points[0].value).toBe(4);
    expect(migrateProjectProcessorNodes(project)).toBe(false);
    expect(nodes[0].params.ratio).toBe(4);
  });
});
