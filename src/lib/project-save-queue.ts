export interface SaveableProject {
  id: string;
  autosave?: boolean;
}

export interface SaveLifecycle<T> {
  onSaved?: (snapshot: T) => void;
  onError?: (error: unknown, snapshot: T) => void;
}

interface PendingSave<T> {
  snapshot: T;
  lifecycle?: SaveLifecycle<T>;
}

/**
 * Debounces independently per project and serializes writes globally.
 *
 * IndexedDB transactions for the same object store are ordered by creation,
 * but a delayed callback can still be created after an explicit Save Now.
 * This queue ensures Save Now replaces pending older snapshots and that a
 * slow write cannot be overtaken by a newer write from this application.
 */
export class ProjectSaveQueue<T extends SaveableProject> {
  private readonly pending = new Map<string, PendingSave<T>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private writeTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly save: (snapshot: T) => Promise<void>,
    private readonly delayMs = 700,
    private readonly clone: (value: T) => T = (value) => structuredClone(value),
  ) {}

  schedule(project: T, lifecycle?: SaveLifecycle<T>): void {
    if (project.autosave === false) {
      this.cancel(project.id);
      return;
    }

    const snapshot = this.clone(project);
    this.pending.set(project.id, { snapshot, lifecycle });
    this.clearTimer(project.id);
    const timer = setTimeout(() => {
      this.timers.delete(project.id);
      const entry = this.pending.get(project.id);
      if (!entry) return;
      this.pending.delete(project.id);
      void this.enqueue(entry).catch(() => undefined);
    }, this.delayMs);
    this.timers.set(project.id, timer);
  }

  /** Immediately persist this exact snapshot, replacing any delayed older one. */
  flush(project: T, lifecycle?: SaveLifecycle<T>): Promise<void> {
    this.clearTimer(project.id);
    this.pending.delete(project.id);
    return this.enqueue({ snapshot: this.clone(project), lifecycle });
  }

  /** Immediately queue every project currently waiting for its debounce timer. */
  flushAll(): Promise<void> {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const id of this.timers.keys()) this.clearTimer(id);
    return Promise.all(entries.map((entry) => this.enqueue(entry))).then(() => undefined);
  }

  /** Flush one project's delayed snapshot, if any. */
  flushPending(projectId: string): Promise<void> {
    const entry = this.pending.get(projectId);
    if (!entry) {
      this.clearTimer(projectId);
      return Promise.resolve();
    }
    this.pending.delete(projectId);
    this.clearTimer(projectId);
    return this.enqueue(entry);
  }

  cancel(projectId: string): void {
    this.pending.delete(projectId);
    this.clearTimer(projectId);
  }

  cancelAll(): void {
    for (const id of this.timers.keys()) this.clearTimer(id);
    this.pending.clear();
  }

  /** Wait until all writes already submitted to the queue have settled. */
  drain(): Promise<void> {
    return this.writeTail;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  private clearTimer(projectId: string): void {
    const timer = this.timers.get(projectId);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(projectId);
  }

  private enqueue(entry: PendingSave<T>): Promise<void> {
    const operation = this.writeTail.then(() => this.save(entry.snapshot));
    this.writeTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation.then(
      () => entry.lifecycle?.onSaved?.(entry.snapshot),
      (error: unknown) => {
        entry.lifecycle?.onError?.(error, entry.snapshot);
        throw error;
      },
    );
  }
}
