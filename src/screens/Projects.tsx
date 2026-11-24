import { useState } from 'react';
import { useApp } from '../state/store';
import { AUDIO_ACCEPT, Badge, Button, EmptyState, Panel, useFilePicker } from '../ui/Primitives';

export default function Projects() {
  const { projects, createProject, openProject, deleteProjectById, duplicateProjectById, importFiles } = useApp();
  const picker = useFilePicker();
  const [search, setSearch] = useState('');
  const importSong = () => picker.open(AUDIO_ACCEPT, true, (files) => void importFiles(files, 'target'));
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const filtered = projects.filter((project) => project.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5 sm:p-6 lg:p-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-label">Workspace</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink-100">Projects</h1>
          <p className="mt-1 text-sm text-ink-400">Stored locally in this browser, including the original audio files.</p>
        </div>
        {projects.length > 0 && (
          <div data-tour="projects-create" className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap">
            <label className="sr-only" htmlFor="project-search">Search projects</label>
            <input
              id="project-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects…"
              className="focus-ring min-h-11 min-w-0 flex-1 rounded-xl border border-ink-600 bg-ink-900 px-3 text-sm text-ink-100 placeholder:text-ink-500 sm:w-56 sm:flex-none"
            />
            <Button variant="primary" onClick={() => void createProject()}>
              New project
            </Button>
          </div>
        )}
      </header>

      <Panel dataTour="projects-list">
        {filtered.length === 0 ? (
          <EmptyState
            title={projects.length ? 'No matching projects' : 'No projects yet'}
            description={
              projects.length
                ? 'Try a different search term.'
                : 'Start with a song you want to improve, or create an empty workspace and add audio later. Your original audio stays untouched.'
            }
            action={
              projects.length ? (
                <Button size="sm" variant="primary" onClick={() => void createProject()}>
                  Create project
                </Button>
              ) : (
                <div data-tour={projects.length === 0 ? "projects-create" : undefined} className="flex flex-wrap items-center justify-center gap-2">
                  <Button variant="primary" onClick={importSong}>
                    Import a song
                  </Button>
                  <Button onClick={() => void createProject()}>
                    Create blank project
                  </Button>
                </div>
              )
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
