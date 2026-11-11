import { useEffect, useState } from 'react';
import { useApp, type Screen } from './state/store';
import Dashboard from './screens/Dashboard';
import Landing from './screens/Landing';
import Monetization from './screens/Monetization';
import Account from './screens/Account';
import Projects from './screens/Projects';
import Studio from './screens/Studio';
import ReferenceMatch from './screens/ReferenceMatch';
import Mastering from './screens/Mastering';
import Presets from './screens/Presets';
import Analysis from './screens/Analysis';
import Export from './screens/Export';
import Settings from './screens/Settings';
import Learn from './screens/Learn';
import { Button, EmptyState, Panel, ProgressBar } from './ui/Primitives';
import TopNavigation from './ui/TopNavigation';
import { GuidedTour } from './ui/GuidedTour';
import { AssistantPanel } from './ui/Mixer';
import { CommandPalette } from './ui/CommandPalette';
import { realtimeHost } from './audio/engine/realtime';

const NAV: { screen: Screen; label: string; glyph: string; requiresProject?: boolean }[] = [
  { screen: 'dashboard', label: 'Dashboard', glyph: '◫' },
  { screen: 'projects', label: 'Projects', glyph: '▤' },
  { screen: 'plans', label: 'Plans & Add-ons', glyph: '✦' },
  { screen: 'account', label: 'Account', glyph: '◉' },
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
  const [showLanding, setShowLanding] = useState(() => {
    const hash = window.location.hash;
    const route = hash.slice(1) as Screen;
    const knownRoute = NAV.some((item) => item.screen === route);
    return !knownRoute && hash !== '#reset-password' && !hash.includes('access_token=');
  });
  const [tourOpen, setTourOpen] = useState(false);
  const [assistantFullScreen, setAssistantFullScreen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

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

  const openAccount = () => {
    window.location.hash = 'account';
    setShowLanding(false);
    setScreen('account');
  };

  const openLanding = () => {
    window.location.hash = '';
    setShowLanding(true);
  };

  const openAssistantFullScreen = () => {
    window.location.hash = 'studio';
    setShowLanding(false);
    setScreen('studio');
    setAssistantFullScreen(true);
  };

  const navigateToScreen = (destination: Screen) => {
    setCommandPaletteOpen(false);
    if (destination === 'plans') openPricing();
    else if (destination === 'account') openAccount();
    else if (destination === 'studio') enterStudio();
    else {
      setShowLanding(false);
      setScreen(destination);
    }
  };

  useEffect(() => {
    const syncFromHash = () => {
      const hash = window.location.hash;
      const authCallback = hash.includes('access_token=');
      const route = hash.slice(1) as Screen;
      const knownRoute = NAV.some((item) => item.screen === route);

      if (authCallback || hash === '#reset-password') {
        setShowLanding(false);
        setScreen('account');
      } else if (knownRoute) {
        setShowLanding(false);
        setScreen(route);
      } else {
        setShowLanding(true);
      }
    };
    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, []);

  useEffect(() => {
    if (showLanding || window.location.hash.includes('access_token=')) return;
    const nextHash = `#${screen}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nextHash}`);
    }
  }, [screen, showLanding]);

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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }
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

  if (showLanding) return <Landing onEnterStudio={enterStudio} onOpenPricing={openPricing} onOpenAccount={openAccount} />;

  const active = NAV.find((item) => item.screen === screen);
  const blocked = active?.requiresProject && !project;

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-sonora-canvas p-3 text-ink-100 sm:p-5 lg:p-7">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_82%_0%,rgba(117,69,234,.12),transparent_35%),radial-gradient(ellipse_at_50%_100%,rgba(137,87,255,.065),transparent_40%)]" />


      <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[30px] border border-white/[.12] bg-[#0D0D1B]/80 shadow-[0_24px_80px_rgba(0,0,0,.48)]">
        <TopNavigation
          screen={screen}
          projectName={project?.name}
          projectOpen={Boolean(project)}
          mode={mode}
          onModeChange={setMode}
          onOpenAssistant={openAssistantFullScreen}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          onNavigate={navigateToScreen}
          onUndo={undo}
          onRedo={redo}
          onOpenLanding={openLanding}
          onStartTour={() => setTourOpen(true)}
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

        <main className="relative z-0 min-h-0 flex-1 overflow-y-auto rounded-b-[26px]">
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
          ) : screen === 'plans' ? (
            <Monetization onOpenAccount={openAccount} />
          ) : screen === 'account' ? (
            <Account />
          ) : screen === 'studio' ? (
            <Studio onStartTour={() => setTourOpen(true)} onExpandAssistant={openAssistantFullScreen} onOpenAccount={openAccount} />
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

      <GuidedTour open={tourOpen} screen={screen} onClose={() => setTourOpen(false)} />

      <CommandPalette open={commandPaletteOpen} hasProject={Boolean(project)} onClose={() => setCommandPaletteOpen(false)} onNavigate={navigateToScreen} />

      {assistantFullScreen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#070710]/95 p-3 backdrop-blur-xl sm:p-5 lg:p-7">
          <div className="mx-auto flex h-full min-h-0 w-full max-w-[1600px] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/[.12] bg-[#0D0D1B] shadow-[0_28px_100px_rgba(0,0,0,.68)] sm:rounded-[30px]">
            <AssistantPanel onClose={() => setAssistantFullScreen(false)} />
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
