import { useApp } from '../state/store';
import { AUDIO_ACCEPT, Badge, Button, EmptyState, InfoRow, Panel, useFilePicker } from '../ui/Primitives';
import { formatTime } from '../audio/dsp/util';

export default function Dashboard() {
  const { projects, project, assets, exports, createProject, openProject, importFiles, openProject: open, analyses } = useApp();
  const picker = useFilePicker();
  const analyzed = Object.keys(analyses).length;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-label">Reference match studio</p>
          <h1 className="mt-1 text-2xl font-medium tracking-tight text-ink-100">
            Turn a commercial release into an editable processing chain.
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-400">
            Measure your song against references, see the real differences, and generate a chain you can change one
            parameter at a time. Processing runs in a real DSP engine — not a preview mock-up.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => (project ? open('studio') : void createProject())}>
            {project ? 'Open studio' : 'New project'}
          </Button>
          <Button
            onClick={() =>
              picker.open(AUDIO_ACCEPT, true, (files) => {
                void importFiles(files, 'target');
              })
            }
          >
            Import a song
          </Button>
        </div>
      </header>

      {project && (
        <Panel title="Current project" right={<Badge tone="accent">{project.tracks.length} tracks</Badge>}>
          <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
            <div>
              <p className="text-lg text-ink-100">{project.name}</p>
              <p className="mt-0.5 text-2xs text-ink-500">
                {project.sampleRate} Hz session · {project.tracks.filter((t) => t.clips.length).length} audio tracks ·{' '}
                {project.referenceAssetIds.length} references
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => useApp.getState().setScreen('reference')}>
                  Reference Match Studio
                </Button>
                <Button size="sm" onClick={() => useApp.getState().setScreen('mastering')}>
                  Mastering
                </Button>
                <Button size="sm" onClick={() => useApp.getState().setScreen('analysis')}>
                  Analysis
                </Button>
                <Button size="sm" variant="ghost" onClick={() => useApp.getState().setScreen('export')}>
                  Export
                </Button>
              </div>
            </div>
            <div className="rounded border border-ink-700 bg-ink-900/50 p-2">
              <InfoRow label="Analysed assets" value={`${analyzed} / ${assets.length}`} />
              <InfoRow label="Master processors" value={project.master.processors.length} />
              <InfoRow label="Exports" value={exports.length} />
              <InfoRow
                label="Timeline"
                value={formatTime(
                  Math.max(0, ...project.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration))),
                )}
              />
            </div>
          </div>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Recent projects" right={<Button size="sm" variant="ghost" onClick={() => useApp.getState().setScreen('projects')}>All projects</Button>}>
          {projects.length === 0 ? (
            <EmptyState
              title="No projects yet"
              description="Create a project, import a WAV/AIFF/FLAC/MP3, then upload a reference to start matching."
              action={
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() =>
                    picker.open(AUDIO_ACCEPT, true, (files) => {
                      void importFiles(files, 'target');
                    })
                  }
                >
                  Import your first song
                </Button>
              }
            />
          ) : (
            <div className="divide-y divide-ink-700">
              {projects.slice(0, 5).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => void openProject(entry.id)}
                  className="flex w-full items-center justify-between gap-3 py-2 text-left hover:text-accent"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs text-ink-100">{entry.name}</span>
                    <span className="block font-mono text-2xs text-ink-500">
                      {new Date(entry.updatedAt).toLocaleString()} · {entry.trackCount} tracks
                    </span>
                  </span>
                  {entry.hasReference && <Badge tone="info">ref</Badge>}
                </button>
              ))}
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title="Start a reference match">
            <ol className="space-y-2 text-xs leading-relaxed text-ink-300">
              {[
                'Import your song as the target.',
                'Add one or more commercial references.',
                'Let the engine measure loudness, tone, dynamics and stereo.',
                'Choose which characteristics to match and generate a chain.',
                'Edit every parameter, then render offline.',
              ].map((step, i) => (
                <li key={step} className="flex gap-2">
                  <span className="font-mono text-2xs text-accent">{String(i + 1).padStart(2, '0')}</span>
                  <span className="text-ink-400">{step}</span>
                </li>
              ))}
            </ol>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                onClick={() =>
                  picker.open(AUDIO_ACCEPT, true, (files) => {
                    void importFiles(files, 'reference');
                  })
                }
              >
                Add reference
              </Button>
              <Button size="sm" variant="ghost" onClick={() => useApp.getState().setScreen('reference')}>
                Open studio
              </Button>
            </div>
          </Panel>

          <Panel title="Recent exports">
            {exports.length === 0 ? (
              <p className="text-2xs leading-relaxed text-ink-500">
                Rendered files appear here with their measured LUFS and true peak. Export works offline at the selected
                resolution.
              </p>
            ) : (
              <div className="space-y-1.5">
                {exports.slice(0, 4).map((record) => (
                  <div key={record.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-2xs text-ink-200">{record.name}</span>
                    <span className="shrink-0 font-mono text-2xs text-ink-500">
                      {record.lufs !== null ? `${record.lufs.toFixed(1)} LUFS` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      <Panel title="What is real in this build">
        <div className="grid gap-3 text-2xs leading-relaxed text-ink-400 md:grid-cols-3">
          <div>
            <p className="mb-1 text-ink-200">Implemented</p>
            <p>
              Real-time and offline DSP share one engine. Analysis, reference matching, editable chains, undo/redo,
              persistence, WAV/AIFF/MP3 export and true-peak limiting are functional.
            </p>
          </div>
          <div>
            <p className="mb-1 text-ink-200">Deliberately limited</p>
            <p>
              Source separation, collaboration, batch export and external LLM control are not implemented. The UI marks
              those areas instead of pretending they work.
            </p>
          </div>
          <div>
            <p className="mb-1 text-ink-200">Local-first</p>
            <p>
              Projects and audio are stored in this browser with IndexedDB. There is no account system in this build;
              multi-user access control is documented as a deployment concern.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
