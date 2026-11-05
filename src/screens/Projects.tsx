import { useState } from 'react';
import { useApp } from '../state/store';
import { Badge, Button, EmptyState, Panel } from '../ui/Primitives';

export default function Projects() {
  const { projects, createProject, openProject, deleteProjectById, duplicateProjectById } = useApp();
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const filtered = projects.filter((project) => project.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-label">Workspace</p>
          <h1 className="mt-1 text-xl text-ink-100">Projects</h1>
          <p className="mt-1 text-xs text-ink-400">Stored locally in this browser, including the original audio files.</p>
        </div>
        <div data-tour="projects-create" className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects…"
            className="focus-ring rounded border border-ink-600 bg-ink-900 px-2 py-1.5 text-xs text-ink-100 placeholder:text-ink-500"
          />
          <Button variant="primary" onClick={() => void createProject()}>
            New project
          </Button>
        </div>
      </header>

      <Panel dataTour="projects-list">
        {filtered.length === 0 ? (
          <EmptyState
            title={projects.length ? 'No matching projects' : 'No projects yet'}
            description={
              projects.length
                ? 'Try a different search term.'
                : 'Create a project to start importing audio and generating an editable processing chain.'
            }
            action={
              <Button size="sm" variant="primary" onClick={() => void createProject()}>
                Create project
              </Button>
            }
          />
        ) : (
          <div className="divide-y divide-ink-700">
            {filtered.map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <button type="button" className="min-w-0 text-left" onClick={() => void openProject(entry.id)}>
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs text-ink-100">{entry.name}</span>
                    {entry.hasReference && <Badge tone="info">reference</Badge>}
                  </div>
                  <div className="mt-0.5 font-mono text-2xs text-ink-500">
                    edited {new Date(entry.updatedAt).toLocaleString()} · {entry.trackCount} tracks
                  </div>
                </button>
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={() => void openProject(entry.id)}>
                    Open
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void duplicateProjectById(entry.id)}>
                    Duplicate
                  </Button>
                  {pendingDelete === entry.id ? (
                    <>
                      <Button size="sm" variant="danger" onClick={() => void deleteProjectById(entry.id)}>
                        Confirm delete
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setPendingDelete(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setPendingDelete(entry.id)}>
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <p className="text-2xs leading-relaxed text-ink-500">
        Deleting a project removes its audio assets and renders from this browser. Duplicated projects currently share the
        same stored audio blobs to avoid duplicating large files; project settings and chains are independent.
      </p>
    </div>
  );
}
