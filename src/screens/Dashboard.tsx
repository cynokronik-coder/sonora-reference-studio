import { useApp } from '../state/store';
import { AUDIO_ACCEPT, Badge, Button, EmptyState, HelpTip, InfoRow, Panel, useFilePicker } from '../ui/Primitives';
import { formatTime } from '../audio/dsp/util';

const FLOW = [
  {
    number: '01',
    title: 'Bring in your song',
    text: 'Upload the finished stereo mix you want to improve, or import separate stems into the Mixing Studio.',
    action: 'Import target',
    destination: 'target' as const,
  },
  {
    number: '02',
    title: 'Choose a sound reference',
    text: 'Add a released track whose tonal balance, punch or stereo image you admire.',
    action: 'Add reference',
    destination: 'reference' as const,
  },
  {
    number: '03',
    title: 'Build an editable match',
    text: 'Compare measured characteristics, generate a suggested chain and adjust every processor.',
    action: 'Open matching',
    destination: 'match' as const,
  },
];

const FEATURES = [
  { icon: '⌁', title: 'Mix', subtitle: 'Shape tracks, stems and buses', screen: 'studio' as const, accent: 'from-cyan-400/20' },
  { icon: '◎', title: 'Reference match', subtitle: 'Learn the tonal character of a release', screen: 'reference' as const, accent: 'from-lime-300/20' },
  { icon: '◒', title: 'Master', subtitle: 'Control dynamics, loudness and peaks', screen: 'mastering' as const, accent: 'from-violet-400/20' },
];

function MiniSpectrum() {
  const heights = [12, 18, 14, 25, 20, 31, 18, 27, 39, 23, 34, 47, 29, 40, 54, 35, 48, 62, 43, 55, 71, 49, 60, 78, 55, 68, 84, 60, 73, 91, 67, 79, 63, 86, 58, 74, 50, 65, 46, 58, 39, 52, 34, 44, 30, 38, 24, 32, 20, 27, 16, 22, 12];
  return (
    <div className="relative flex h-40 items-end justify-center gap-1 overflow-hidden rounded-xl border border-white/10 bg-black/20 px-4 pb-4 pt-8">
      <div className="pointer-events-none absolute inset-0 opacity-60" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px)', backgroundSize: '100% 25%, 9% 100%' }} />
      <div className="absolute inset-x-4 top-4 flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-[.2em] text-white/45">Spectral signature</span>
        <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[9px] text-accent">LIVE ANALYSIS</span>
      </div>
      {heights.map((height, index) => (
        <span
          key={index}
          className="relative z-10 min-w-0 flex-1 rounded-t-sm"
          style={{
            height: `${height}%`,
            background: index > 33 ? 'linear-gradient(180deg, #a78bfa, rgba(167,139,250,.18))' : 'linear-gradient(180deg, #c8f169, rgba(200,241,105,.15))',
            opacity: 0.42 + (height / 180),
          }}
        />
      ))}
    </div>
  );
}

export default function Dashboard() {
  const {
    projects,
    project,
    assets,
    exports,
    createProject,
    openProject,
    importFiles,
    analyses,
    mode,
    lastRenderStats,
  } = useApp();
  const picker = useFilePicker();
  const analyzed = Object.keys(analyses).length;
  const hasTarget = Boolean(project?.targetAssetIds.length);
  const hasReference = Boolean(project?.referenceAssetIds.length);
  const hasChain = Boolean(project?.master.processors.length);
  const duration = Math.max(0, ...(project?.tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)) ?? []));
  const completed = [hasTarget, hasReference, hasChain || Boolean(lastRenderStats), exports.length > 0].filter(Boolean).length;

  const importTarget = () => picker.open(AUDIO_ACCEPT, true, (files) => void importFiles(files, 'target'));
  const importReference = () => picker.open(AUDIO_ACCEPT, true, (files) => void importFiles(files, 'reference'));
  const go = (screen: 'studio' | 'reference' | 'mastering' | 'analysis' | 'export') => useApp.getState().setScreen(screen);

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-5 sm:p-7 lg:p-8">
      <section className="relative isolate overflow-hidden rounded-2xl border border-ink-700 bg-[#11161b] shadow-panel">
        <div className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full bg-accent/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 right-1/3 h-72 w-72 rounded-full bg-signal-violet/10 blur-3xl" />
        <div className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.1fr_.9fr] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent">AI-assisted audio production</Badge>
              <span className="font-mono text-[9px] uppercase tracking-[.18em] text-ink-500">Built for independent artists</span>
            </div>
            <h1 className="mt-4 max-w-2xl text-3xl font-semibold leading-[1.08] tracking-[-.04em] text-white sm:text-4xl">
              Make your music sound
              <span className="block bg-gradient-to-r from-accent via-[#d8f5a1] to-signal-cyan bg-clip-text text-transparent">release-ready.</span>
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-ink-300">
              Mix, compare against professional references and master your songs in one creative workspace.
              Start with smart suggestions, then shape every detail yourself.
            </p>
            <div data-tour="dashboard-import" className="mt-5 flex flex-wrap gap-2">
              <Button variant="primary" onClick={importTarget}>＋ Import your song</Button>
              <Button onClick={() => void createProject()}>Create blank project</Button>
              {project && <Button variant="ghost" onClick={() => go('studio')}>Continue session →</Button>}
            </div>
            <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-2xs text-ink-500">
              <span>✓ Original audio stays untouched</span>
              <span>✓ Every AI suggestion is editable</span>
              <span>✓ Offline high-quality rendering</span>
            </div>
          </div>
          <div className="relative">
            <MiniSpectrum />
            <div className="mt-2 grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-white/10 bg-white/[.035] p-2">
                <span className="block font-mono text-[9px] uppercase tracking-wider text-ink-500">Analyze</span>
                <span className="mt-1 block text-xs font-medium text-ink-100">Measure</span>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[.035] p-2">
                <span className="block font-mono text-[9px] uppercase tracking-wider text-ink-500">Compare</span>
                <span className="mt-1 block text-xs font-medium text-ink-100">Reference</span>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[.035] p-2">
                <span className="block font-mono text-[9px] uppercase tracking-wider text-ink-500">Create</span>
                <span className="mt-1 block text-xs font-medium text-ink-100">Your sound</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {project && (
        <section className="grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-ink-700 bg-ink-900/70 p-4">
            <div className="text-2xs text-ink-500">Active project</div>
            <div className="mt-1 truncate text-sm font-medium text-ink-100">{project.name}</div>
            <div className="mt-1 font-mono text-2xs text-ink-500">{project.sampleRate.toLocaleString()} Hz session</div>
          </div>
          <div className="rounded-2xl border border-ink-700 bg-ink-900/70 p-4">
            <div className="text-2xs text-ink-500">Arrangement</div>
            <div className="mt-1 text-sm font-medium text-ink-100">{project.tracks.length} tracks</div>
            <div className="mt-1 font-mono text-2xs text-ink-500">{formatTime(duration)} timeline length</div>
          </div>
          <div className="rounded-2xl border border-ink-700 bg-ink-900/70 p-4">
            <div className="text-2xs text-ink-500">Reference library</div>
            <div className="mt-1 text-sm font-medium text-ink-100">{project.referenceAssetIds.length} tracks</div>
            <div className="mt-1 font-mono text-2xs text-ink-500">{analyzed} assets analyzed</div>
          </div>
          <div className="rounded-2xl border border-ink-700 bg-ink-900/70 p-4">
            <div className="text-2xs text-ink-500">Latest measured master</div>
            <div className="mt-1 text-sm font-medium text-ink-100">{lastRenderStats ? `${lastRenderStats.lufs.toFixed(1)} LUFS` : 'Not rendered yet'}</div>
            <div className="mt-1 font-mono text-2xs text-ink-500">{lastRenderStats ? `${lastRenderStats.truePeakDb.toFixed(1)} dBTP` : 'Render to verify output'}</div>
          </div>
        </section>
      )}

      <section data-tour="dashboard-workflow" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="section-label">Your workflow</div>
            <h2 className="mt-1 text-lg font-medium tracking-tight text-ink-100">A professional result, one clear step at a time.</h2>
            <p className="mt-1 text-xs text-ink-500">You can start simple and open advanced controls whenever you need them.</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge>{completed}/4 steps started</Badge>
            <HelpTip title="How Sonora works" steps={['Import the stereo mix you want to improve.', 'Add a released song as your sonic reference.', 'Review the measurements and create a suggested chain.', 'Listen, adjust, render and export your own master.']}>
              Reference matching compares measurable sound qualities. It does not copy the reference recording itself.
            </HelpTip>
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {FLOW.map((step, index) => {
            const done = index === 0 ? hasTarget : index === 1 ? hasReference : hasChain;
            const action = index === 0 ? importTarget : index === 1 ? importReference : () => go('reference');
            return (
              <article key={step.number} className="group rounded-xl border border-ink-700 bg-gradient-to-br from-ink-800/80 to-ink-900/80 p-4 transition-colors hover:border-ink-500">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] tracking-wider text-accent">{step.number}</span>
                  {done ? <Badge tone="accent">Ready</Badge> : <span className="text-2xs text-ink-600">NEXT STEP</span>}
                </div>
                <h3 className="mt-4 text-sm font-semibold text-ink-100">{step.title}</h3>
                <p className="mt-2 min-h-[54px] text-xs leading-5 text-ink-400">{step.text}</p>
                <div className="mt-4 flex items-center justify-between">
                  <Button size="sm" variant={done ? 'ghost' : 'secondary'} onClick={action}>{step.action} →</Button>
                  {index === 2 && <HelpTip title="What does the match do?">Sonora compares measured frequency balance, loudness, dynamics and stereo behaviour, then proposes real processors you can edit or remove.</HelpTip>}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section data-tour="dashboard-workspaces" className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="section-label">Production spaces</div>
              <h2 className="mt-1 text-lg font-medium text-ink-100">Choose what you want to work on</h2>
            </div>
            <HelpTip title="Which workspace should I use?" steps={['Mixing Studio: balance multiple tracks, edit clips and build track effects.', 'Reference Match: compare your song with a professional release.', 'Mastering: process the complete mix and verify its final loudness.']}>
              Each workspace has a different job. You do not need to understand every control before getting started.
            </HelpTip>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            {FEATURES.map((feature) => (
              <button
                key={feature.screen}
                type="button"
                disabled={!project}
                onClick={() => go(feature.screen)}
                className={`group rounded-xl border border-ink-700 bg-gradient-to-br ${feature.accent} to-ink-900 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-ink-500 disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/20 text-lg text-accent">{feature.icon}</span>
                <span className="mt-4 block text-sm font-semibold text-ink-100">{feature.title}</span>
                <span className="mt-1 block text-2xs leading-relaxed text-ink-500">{feature.subtitle}</span>
                <span className="mt-4 block text-2xs text-ink-300 group-hover:text-accent">{project ? 'Open workspace ↗' : 'Create a project first'}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="section-label">Workspace library</div>
              <h2 className="mt-1 text-lg font-medium text-ink-100">Recent projects</h2>
            </div>
            <Button size="sm" variant="ghost" onClick={() => useApp.getState().setScreen('projects')}>All projects ↗</Button>
          </div>
          <div className="rounded-2xl border border-ink-700 bg-ink-900/70 p-4">
            {projects.length === 0 ? (
              <EmptyState
                title="Your studio starts here"
                description="Create a project or import your first song. Sonora will keep the original audio untouched."
                action={<Button size="sm" variant="primary" onClick={importTarget}>Import first song</Button>}
              />
            ) : (
              <div className="space-y-1">
                {projects.slice(0, 5).map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => void openProject(entry.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-ink-800"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-ink-100">{entry.name}</span>
                      <span className="mt-0.5 block font-mono text-2xs text-ink-500">{new Date(entry.updatedAt).toLocaleDateString()} · {entry.trackCount} tracks</span>
                    </span>
                    {entry.hasReference ? <Badge tone="info">Reference</Badge> : <span className="text-ink-600">↗</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Panel title="Recent exports" right={<HelpTip title="What is an export?">An export is a newly rendered audio file created from your current processing chain. The original uploaded file is not overwritten.</HelpTip>}>
            {exports.length === 0 ? (
              <p className="text-2xs leading-relaxed text-ink-500">Your finished WAV, AIFF or MP3 renders will appear here.</p>
            ) : (
              <div className="space-y-2">
                {exports.slice(0, 3).map((record) => (
                  <div key={record.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-2xs text-ink-200">{record.name}</span>
                    <span className="shrink-0 font-mono text-2xs text-ink-500">{record.lufs !== null ? `${record.lufs.toFixed(1)} LUFS` : '—'}</span>
                  </div>
                ))}
                <Button size="sm" variant="ghost" onClick={() => go('export')}>Open export center →</Button>
              </div>
            )}
          </Panel>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-ink-700 bg-ink-900/60 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold text-ink-100">New to mixing and mastering?</div>
            <Badge tone="info">{mode === 'beginner' ? 'Beginner mode' : 'Engineer mode'}</Badge>
          </div>
          <p className="mt-2 text-xs leading-5 text-ink-400">
            Start with Reference Match. You will see what differs between your song and the reference before any processing is applied.
            Every suggestion can be auditioned, changed or rejected.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" disabled={!project} onClick={() => go('reference')}>Start guided matching</Button>
            <HelpTip title="What should I listen for?" steps={['Is the vocal clear and easy to understand?', 'Does the bass feel controlled rather than boomy?', 'Can you hear the kick and snare clearly?', 'Does the master stay clean when it gets loud?']}>
              Compare at a similar listening volume. A louder version is not automatically a better mix.
            </HelpTip>
          </div>
        </div>
        <div className="rounded-2xl border border-ink-700 bg-ink-900/60 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold text-ink-100">Your progress</div>
            <span className="font-mono text-2xs text-ink-500">{completed}/4 milestones</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-700">
            <div className="h-full rounded-full bg-gradient-to-r from-accent to-signal-cyan transition-all" style={{ width: `${completed * 25}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-4 gap-1 text-center">
            {[
              ['Song', hasTarget],
              ['Reference', hasReference],
              ['Chain', hasChain],
              ['Export', exports.length > 0],
            ].map(([label, done]) => (
              <div key={String(label)} className="rounded-lg bg-ink-850/70 px-1 py-2">
                <div className={`text-sm ${done ? 'text-accent' : 'text-ink-600'}`}>{done ? '✓' : '○'}</div>
                <div className="mt-1 text-[9px] text-ink-500">{String(label)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
