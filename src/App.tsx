import { useEffect, useState } from 'react';
import { useApp, type Screen } from './state/store';
import Dashboard from './screens/Dashboard';
import Landing from './screens/Landing';
import Projects from './screens/Projects';
import Studio from './screens/Studio';
import ReferenceMatch from './screens/ReferenceMatch';
import Mastering from './screens/Mastering';
import Presets from './screens/Presets';
import Analysis from './screens/Analysis';
import Export from './screens/Export';
import Settings from './screens/Settings';
import Monetization from './screens/Monetization';
import Learn from './screens/Learn';
import { Button, EmptyState, HelpTip, Panel, ProgressBar } from './ui/Primitives';
import { realtimeHost } from './audio/engine/realtime';

const NAV: { screen: Screen; label: string; glyph: string; requiresProject?: boolean }[] = [
  { screen: 'dashboard', label: 'Dashboard', glyph: '◫' },
  { screen: 'projects', label: 'Projects', glyph: '▤' },
  { screen: 'plans', label: 'Plans & Add-ons', glyph: '✦' },
  { screen: 'studio', label: 'Mixing Studio', glyph: '⌁', requiresProject: true },
  { screen: 'reference', label: 'Reference Match', glyph: '◎', requiresProject: true },
  { screen: 'mastering', label: 'Mastering', glyph: '▮', requiresProject: true },
  { screen: 'presets', label: 'Preset Library', glyph: '♪', requiresProject: true },
  { screen: 'analysis', label: 'Audio Analysis', glyph: '∿', requiresProject: true },
  { screen: 'export', label: 'Export Center', glyph: '⤓', requiresProject: true },
  { screen: 'learn', label: 'Learn & Help', glyph: '✳' },
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
  plans: 'Plans & Add-ons',
  learn: 'Learn & Help',
};

export default function App() {
  const { screen, setScreen, project, init, mode, setMode, busy, toast, setToast, undo, redo, saveNow, engineError, storageError } = useApp();
  const [showLanding, setShowLanding] = useState(() => !['#studio', '#plans'].includes(window.location.hash));

  const enterStudio = () => {
    window.location.hash = 'studio';
    setShowLanding(false);
    setScreen('studio');
  };

  const openPricing = () => {
    window.location.hash = 'plans';
    setShowLanding(false);
    setScreen('plans');
  };

  const openLanding = () => {
    window.location.hash = '';
    setShowLanding(true);
  };

  useEffect(() => {
    const syncFromHash = () => {
      const hash = window.location.hash;
      const inApp = hash === '#studio' || hash === '#plans';
      setShowLanding(!inApp);
      if (hash === '#plans') setScreen('plans');
      else if (hash === '#studio') setScreen('studio');
    };
    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, []);

  useEffect(() => {
    if (showLanding) return;
    void init();
  }, [init, showLanding]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(timer);
  }, [toast, setToast]);

  useEffect(() => {
    if (showLanding) return;
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
  }, [undo, redo, saveNow, showLanding]);

  if (showLanding) return <Landing onEnterStudio={enterStudio} onOpenPricing={openPricing} />;

  const active = NAV.find((item) => item.screen === screen);
  const blocked = active?.requiresProject && !project;

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-[#080a0d] text-ink-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_70%_0%,rgba(200,241,105,.055),transparent_36%),radial-gradient(ellipse_at_5%_100%,rgba(90,209,230,.035),transparent_30%)]" />
      <aside className={screen === 'studio' ? 'hidden' : 'relative z-10 hidden w-[232px] shrink-0 flex-col border-r border-white/[.07] bg-[#0b0e12]/95 lg:flex'}>
        <div className="flex items-center gap-3 border-b border-white/[.07] px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-accent/30 bg-gradient-to-br from-accent/20 to-signal-cyan/10 shadow-[0_0_28px_rgba(200,241,105,.08)]">
            <span className="font-mono text-lg text-accent">≋</span>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-[.16em] text-white">SONORA</div>
            <div className="font-mono text-[9px] uppercase tracking-[.2em] text-ink-500">Reference Studio</div>
          </div>
        </div>

        <div className="px-4 pb-1 pt-4 font-mono text-[9px] uppercase tracking-[.2em] text-ink-600">Workspace</div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {NAV.map((item) => {
            const disabled = item.requiresProject && !project;
            return (
              <button
                key={item.screen}
                type="button"
                disabled={disabled}
                onClick={() => setScreen(item.screen)}
                className={`focus-ring mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs transition-all disabled:cursor-not-allowed disabled:opacity-35 ${
                  screen === item.screen
                    ? 'border border-accent/20 bg-gradient-to-r from-accent/10 to-transparent text-accent shadow-[inset_2px_0_0_rgba(200,241,105,.85)]'
                    : 'border border-transparent text-ink-400 hover:border-white/[.05] hover:bg-white/[.035] hover:text-ink-100'
                }`}
              >
                <span className={`flex h-7 w-7 items-center justify-center rounded-lg border font-mono text-sm ${
                  screen === item.screen ? 'border-accent/20 bg-accent/10 text-accent' : 'border-white/[.06] bg-white/[.025] text-ink-400'
                }`}>{item.glyph}</span>
                <span className="flex-1 truncate font-medium">{item.label}</span>
                {screen === item.screen && <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_10px_rgba(200,241,105,.7)]" />}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-white/[.07] p-3">
          {project ? (
            <div className="mb-3 rounded-xl border border-white/[.07] bg-white/[.025] p-3">
              <div className="truncate text-2xs text-ink-200" title={project.name}>{project.name}</div>
              <div className="mt-0.5 font-mono text-2xs text-ink-500">
                {project.sampleRate} Hz · {project.tracks.length} trk
              </div>
            </div>
          ) : (
            <div className="mb-2 text-2xs leading-relaxed text-ink-500">No project open.</div>
          )}
          <div className="flex rounded-xl border border-white/[.08] bg-black/20 p-1">
            {(['beginner', 'advanced'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMode(option)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-2xs capitalize transition-colors ${mode === option ? 'bg-ink-700 text-white shadow' : 'text-ink-500 hover:text-ink-200'}`}
              >
                {option === 'advanced' ? 'engineer' : option}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between font-mono text-[9px] uppercase tracking-wider text-ink-600">
            <span className="flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${realtimeHost.isReady ? 'bg-accent' : 'bg-ink-600'}`} />{realtimeHost.isReady ? 'Engine ready' : 'Engine idle'}</span>
            <span>v0.1</span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className={screen === 'studio' ? 'hidden' : 'relative z-10 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-white/[.07] bg-[#0b0e12]/85 px-4 backdrop-blur-xl'}>
          <div className="flex min-w-0 items-center gap-2">
            <span className="lg:hidden font-mono text-accent">≋</span>
            <div className="min-w-0">
              <span className="block truncate text-xs font-semibold text-white">{TITLES[screen]}</span>
              <span className="hidden truncate text-[9px] uppercase tracking-[.14em] text-ink-600 sm:block">{screen === 'dashboard' ? 'Your creative workspace' : 'Production environment'}</span>
            </div>
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
            <HelpTip title="Quick guide" steps={['Import your song to create or open a project.', 'Open Reference Match and add a professional release you like.', 'Generate a chain, then edit or bypass every suggested processor.', 'Use the Mixing Studio timeline to arrange clips and the Mastering workspace to verify the final render.']}>
              Sonora is designed to be usable without engineering experience. Start with the guided workflow; advanced controls stay available when you need them.
            </HelpTip>
            <Button size="sm" variant="ghost" onClick={openLanding}>About Sonora</Button>
            <Button size="sm" variant="ghost" onClick={() => setScreen('projects')}>Projects</Button>
            {project && <Button size="sm" variant="primary" onClick={() => setScreen('reference')}>Start matching ↗</Button>}
          </div>
        </header>

        {storageError && (
          <div className="flex items-center justify-between gap-2 border-b border-amber-300/30 bg-amber-300/10 px-3 py-1.5 text-2xs text-amber-200">
            <span>{storageError}</span>
            <button type="button" className="underline" onClick={() => useApp.setState({ storageError: null })}>dismiss</button>
          </div>
        )}

        {engineError && (
          <div className="flex items-center justify-between gap-2 border-b border-signal-red/30 bg-signal-red/10 px-3 py-1.5 text-2xs text-signal-red">
            <span>Audio engine: {engineError}</span>
            <button type="button" className="underline" onClick={() => useApp.setState({ engineError: null })}>dismiss</button>
          </div>
        )}

        <main className="relative z-0 min-h-0 flex-1 overflow-y-auto">
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
          ) : screen === 'plans' ? (
            <Monetization />
          ) : screen === 'learn' ? (
            <Learn />
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
