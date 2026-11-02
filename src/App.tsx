import { useEffect } from 'react';
import { useApp, type Screen } from './state/store';
import Dashboard from './screens/Dashboard';
import Projects from './screens/Projects';
import Studio from './screens/Studio';
import ReferenceMatch from './screens/ReferenceMatch';
import Mastering from './screens/Mastering';
import Presets from './screens/Presets';
import Analysis from './screens/Analysis';
import Export from './screens/Export';
import Settings from './screens/Settings';
import { Button, EmptyState, Panel, ProgressBar } from './ui/Primitives';
import { realtimeHost } from './audio/engine/realtime';

const NAV: { screen: Screen; label: string; glyph: string; requiresProject?: boolean }[] = [
  { screen: 'dashboard', label: 'Dashboard', glyph: '◫' },
  { screen: 'projects', label: 'Projects', glyph: '▤' },
  { screen: 'studio', label: 'Mixing Studio', glyph: '⌁', requiresProject: true },
  { screen: 'reference', label: 'Reference Match', glyph: '◎', requiresProject: true },
  { screen: 'mastering', label: 'Mastering', glyph: '▮', requiresProject: true },
  { screen: 'presets', label: 'Preset Library', glyph: '♪', requiresProject: true },
  { screen: 'analysis', label: 'Audio Analysis', glyph: '∿', requiresProject: true },
  { screen: 'export', label: 'Export Center', glyph: '⤓', requiresProject: true },
  { screen: 'settings', label: 'Settings', glyph: '⚙' },
];

const TITLES: Record<Screen, string> = {
  dashboard: 'Dashboard',
  projects: 'Projects',
  studio: 'Mixing Studio',
  reference: 'Reference Match Studio',
  mastering: 'Mastering Studio',
  presets: 'Preset Library',
  analysis: 'Audio Analysis',
  export: 'Export Center',
  settings: 'Settings',
};

export default function App() {
  const { screen, setScreen, project, init, mode, setMode, busy, toast, setToast, undo, redo, saveNow, engineError } = useApp();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(timer);
  }, [toast, setToast]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (typing) return;
      if (event.code === 'Space') {
        event.preventDefault();
        void useApp.getState().togglePlay();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveNow();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, saveNow]);

  const active = NAV.find((item) => item.screen === screen);
  const blocked = active?.requiresProject && !project;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-ink-950 text-ink-100">
      <aside className="hidden w-[212px] shrink-0 flex-col border-r border-ink-700 bg-ink-900/70 lg:flex">
        <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-3">
          <div className="flex h-7 w-7 items-center justify-center rounded border border-accent/30 bg-accent/10">
            <span className="font-mono text-sm text-accent">≋</span>
          </div>
          <div>
            <div className="text-xs font-medium tracking-tight text-ink-100">SONORA</div>
            <div className="font-mono text-2xs uppercase tracking-widest text-ink-500">reference studio</div>
          </div>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {NAV.map((item) => {
            const disabled = item.requiresProject && !project;
            return (
              <button
                key={item.screen}
                type="button"
                disabled={disabled}
                onClick={() => setScreen(item.screen)}
                className={`focus-ring mb-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                  screen === item.screen
                    ? 'bg-ink-800 text-accent'
                    : 'text-ink-400 hover:bg-ink-850 hover:text-ink-200'
                }`}
              >
                <span className="w-4 text-center font-mono text-2xs">{item.glyph}</span>
                <span className="flex-1 truncate">{item.label}</span>
                {screen === item.screen && <span className="h-1 w-1 rounded-full bg-accent" />}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-ink-700 p-2">
          {project ? (
            <div className="mb-2 rounded border border-ink-700 bg-ink-850/60 p-2">
              <div className="truncate text-2xs text-ink-200" title={project.name}>{project.name}</div>
              <div className="mt-0.5 font-mono text-2xs text-ink-500">
                {project.sampleRate} Hz · {project.tracks.length} trk
              </div>
            </div>
          ) : (
            <div className="mb-2 text-2xs leading-relaxed text-ink-500">No project open.</div>
          )}
          <div className="flex rounded border border-ink-700 p-0.5">
            {(['beginner', 'advanced'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMode(option)}
                className={`flex-1 rounded px-1 py-0.5 text-2xs capitalize ${mode === option ? 'bg-ink-700 text-ink-100' : 'text-ink-500'}`}
              >
                {option === 'advanced' ? 'engineer' : option}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between font-mono text-2xs text-ink-600">
            <span>{realtimeHost.isReady ? 'engine ready' : 'engine idle'}</span>
            <span>v0.1</span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-ink-700 bg-ink-900/50 px-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="lg:hidden font-mono text-accent">≋</span>
            <span className="truncate text-xs text-ink-200">{TITLES[screen]}</span>
            {project && screen !== 'dashboard' && (
              <>
                <span className="text-ink-700">/</span>
                <span className="hidden truncate text-2xs text-ink-500 sm:block">{project.name}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <div className="lg:hidden">
              <select
                value={screen}
                onChange={(e) => setScreen(e.target.value as Screen)}
                className="max-w-[140px] rounded border border-ink-700 bg-ink-850 px-1 py-1 text-2xs text-ink-200"
              >
                {NAV.filter((item) => !item.requiresProject || project).map((item) => (
                  <option key={item.screen} value={item.screen}>{item.label}</option>
                ))}
              </select>
            </div>
            <button type="button" onClick={undo} title="Undo" className="focus-ring rounded border border-ink-700 px-1.5 py-1 text-2xs text-ink-300 hover:text-ink-100">↶</button>
            <button type="button" onClick={redo} title="Redo" className="focus-ring rounded border border-ink-700 px-1.5 py-1 text-2xs text-ink-300 hover:text-ink-100">↷</button>
            <Button size="sm" variant="ghost" onClick={() => setScreen('projects')}>Projects</Button>
            {project && <Button size="sm" variant="primary" onClick={() => setScreen('reference')}>Match</Button>}
          </div>
        </header>

        {engineError && (
          <div className="flex items-center justify-between gap-2 border-b border-signal-red/30 bg-signal-red/10 px-3 py-1.5 text-2xs text-signal-red">
            <span>Audio engine: {engineError}</span>
            <button type="button" className="underline" onClick={() => useApp.setState({ engineError: null })}>dismiss</button>
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-y-auto">
          {blocked ? (
            <div className="p-5">
              <Panel>
                <EmptyState
                  title="Open a project first"
                  description="This workspace needs a project. Create one or open an existing project, then import audio."
                  action={<Button variant="primary" onClick={() => setScreen('projects')}>Go to projects</Button>}
                />
              </Panel>
            </div>
          ) : screen === 'dashboard' ? (
            <Dashboard />
          ) : screen === 'projects' ? (
            <Projects />
          ) : screen === 'studio' ? (
            <Studio />
          ) : screen === 'reference' ? (
            <ReferenceMatch />
          ) : screen === 'mastering' ? (
            <Mastering />
          ) : screen === 'presets' ? (
            <Presets />
          ) : screen === 'analysis' ? (
            <Analysis />
          ) : screen === 'export' ? (
            <Export />
          ) : (
            <Settings />
          )}
        </main>
      </div>

      {busy && (
        <div className="fixed bottom-4 right-4 z-40 w-72 rounded border border-ink-600 bg-ink-850 p-3 shadow-panel">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-2xs text-ink-200">{busy.label}</span>
            <span className="font-mono text-2xs text-ink-500">{Math.round(busy.progress * 100)}%</span>
          </div>
          <ProgressBar value={busy.progress} />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-2xs text-ink-500">Processing in background</span>
            {busy.cancel && (
              <button type="button" className="text-2xs text-ink-400 underline hover:text-signal-red" onClick={busy.cancel}>
                cancel
              </button>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 max-w-xl -translate-x-1/2 rounded border border-ink-600 bg-ink-850 px-3 py-2 text-xs text-ink-100 shadow-panel">
          {toast}
          <button type="button" className="ml-3 text-ink-500 hover:text-ink-100" onClick={() => setToast(null)}>×</button>
        </div>
      )}
    </div>
  );
}
