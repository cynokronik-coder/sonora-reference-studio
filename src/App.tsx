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
import Learn from './screens/Learn';
import { EmptyState, Panel, ProgressBar } from './ui/Primitives';
import TopNavigation from './ui/TopNavigation';
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
  { screen: 'learn', label: 'Learn & Help', glyph: '✳' },
  { screen: 'settings', label: 'Settings', glyph: '⚙' },
];



export default function App() {
  const { screen, setScreen, project, init, mode, setMode, busy, toast, setToast, undo, redo, saveNow, engineError, storageError } = useApp();
  const [showLanding, setShowLanding] = useState(() => window.location.hash !== '#studio');

  const enterStudio = () => {
    window.location.hash = 'studio';
    setShowLanding(false);
    setScreen('studio');
  };

  const openLanding = () => {
    window.location.hash = '';
    setShowLanding(true);
  };

  useEffect(() => {
    const syncFromHash = () => {
      const inStudio = window.location.hash === '#studio';
      setShowLanding(!inStudio);
      if (inStudio) setScreen('studio');
    };
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

  if (showLanding) return <Landing onEnterStudio={enterStudio} />;

  const active = NAV.find((item) => item.screen === screen);
  const blocked = active?.requiresProject && !project;

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-sonora-canvas text-ink-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_82%_0%,rgba(117,69,234,.12),transparent_35%),radial-gradient(ellipse_at_50%_100%,rgba(137,87,255,.065),transparent_40%)]" />


      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <TopNavigation
          screen={screen}
          projectName={project?.name}
          projectOpen={Boolean(project)}
          mode={mode}
          onModeChange={setMode}
          onNavigate={setScreen}
          onUndo={undo}
          onRedo={redo}
          onOpenLanding={openLanding}
        />


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
          ) : screen === 'learn' ? (
            <Learn />
          ) : (
            <Settings />
          )}
        </main>
      </div>

      {busy && (
        <div className="fixed bottom-4 right-4 z-40 w-72 rounded-xl border border-white/[.10] bg-[#151426]/95 p-3 shadow-floating backdrop-blur-xl">
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
        <div className="fixed bottom-4 left-1/2 z-50 max-w-xl -translate-x-1/2 rounded-xl border border-white/[.10] bg-[#151426]/95 px-4 py-2.5 text-xs text-ink-100 shadow-floating backdrop-blur-xl">
          {toast}
          <button type="button" className="ml-3 text-ink-500 hover:text-ink-100" onClick={() => setToast(null)}>×</button>
        </div>
      )}
    </div>
  );
}
