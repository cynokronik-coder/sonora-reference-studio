import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectSaveQueue } from './project-save-queue';

interface TestProject {
  id: string;
  autosave: boolean;
  revision: number;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ProjectSaveQueue', () => {
  it('debounces changes independently for each project', async () => {
    vi.useFakeTimers();
    const saved: TestProject[] = [];
    const queue = new ProjectSaveQueue<TestProject>(async (project) => {
      saved.push(project);
    }, 700);

    queue.schedule({ id: 'one', autosave: true, revision: 1 });
    queue.schedule({ id: 'one', autosave: true, revision: 2 });
    queue.schedule({ id: 'two', autosave: true, revision: 1 });

    await vi.advanceTimersByTimeAsync(700);

    expect(saved).toEqual([
      { id: 'one', autosave: true, revision: 2 },
      { id: 'two', autosave: true, revision: 1 },
    ]);
    expect(queue.pendingCount).toBe(0);
  });

  it('persists an immutable snapshot rather than a subsequently mutated object', async () => {
    vi.useFakeTimers();
    const saved: TestProject[] = [];
    const queue = new ProjectSaveQueue<TestProject>(async (project) => {
      saved.push(project);
    }, 100);
    const project = { id: 'one', autosave: true, revision: 1 };

    queue.schedule(project);
    project.revision = 9;
    await vi.advanceTimersByTimeAsync(100);

    expect(saved).toEqual([{ id: 'one', autosave: true, revision: 1 }]);
  });

  it('lets Save Now replace and cancel a pending older snapshot', async () => {
    vi.useFakeTimers();
    const saved: TestProject[] = [];
    const queue = new ProjectSaveQueue<TestProject>(async (project) => {
      saved.push(project);
    }, 700);

    queue.schedule({ id: 'one', autosave: true, revision: 1 });
    await queue.flush({ id: 'one', autosave: false, revision: 2 });
    await vi.advanceTimersByTimeAsync(1000);

    expect(saved).toEqual([{ id: 'one', autosave: false, revision: 2 }]);
  });

  it('continues writing in order when an earlier storage write is slow', async () => {
    const started: number[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const queue = new ProjectSaveQueue<TestProject>(async (project) => {
      started.push(project.revision);
      if (project.revision === 1) await firstWrite;
    });

    const first = queue.flush({ id: 'one', autosave: true, revision: 1 });
    const second = queue.flush({ id: 'one', autosave: true, revision: 2 });
    await Promise.resolve();
    expect(started).toEqual([1]);

    releaseFirst?.();
    await Promise.all([first, second]);
    expect(started).toEqual([1, 2]);
  });

  it('flushes pending projects even when the current project changes', async () => {
    vi.useFakeTimers();
    const saved: TestProject[] = [];
    const queue = new ProjectSaveQueue<TestProject>(async (project) => {
      saved.push(project);
    }, 700);

    queue.schedule({ id: 'one', autosave: true, revision: 4 });
    queue.schedule({ id: 'two', autosave: true, revision: 7 });
    await queue.flushAll();

    expect(saved.map((project) => [project.id, project.revision])).toEqual([
      ['one', 4],
      ['two', 7],
    ]);
    expect(queue.pendingCount).toBe(0);
  });

  it('cancels a pending autosave when autosave is disabled', async () => {
    vi.useFakeTimers();
    const saved: TestProject[] = [];
    const queue = new ProjectSaveQueue<TestProject>(async (project) => {
      saved.push(project);
    }, 700);

    queue.schedule({ id: 'one', autosave: true, revision: 1 });
    queue.schedule({ id: 'one', autosave: false, revision: 2 });
    await vi.advanceTimersByTimeAsync(1000);

    expect(saved).toEqual([]);
  });

  it('does not permanently block later saves after a failed write', async () => {
    const saved: number[] = [];
    const queue = new ProjectSaveQueue<TestProject>(async (project) => {
      if (project.revision === 1) throw new Error('quota exceeded');
      saved.push(project.revision);
    });

    await expect(queue.flush({ id: 'one', autosave: true, revision: 1 })).rejects.toThrow('quota exceeded');
    await queue.flush({ id: 'one', autosave: true, revision: 2 });

    expect(saved).toEqual([2]);
  });
});
