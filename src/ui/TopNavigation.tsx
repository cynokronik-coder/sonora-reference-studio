import { useEffect, useRef, useState } from 'react';
import type { Screen, Mode } from '../state/store';
import { Icon } from './Icon';
import { HelpTip } from './Primitives';

interface TopNavigationProps {
  screen: Screen;
  projectName?: string;
  projectOpen: boolean;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  onNavigate: (screen: Screen) => void;
  onOpenAssistant: () => void;
  onOpenCommandPalette: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenLanding: () => void;
  onStartTour: () => void;
}

const PRIMARY_LINKS: { label: string; screen: Screen; disabledWithoutProject?: boolean }[] = [
  { label: 'Studio', screen: 'studio', disabledWithoutProject: true },
  { label: 'Mastering', screen: 'mastering', disabledWithoutProject: true },
  { label: 'Reference', screen: 'reference', disabledWithoutProject: true },
  { label: 'AI Assistant', screen: 'studio', disabledWithoutProject: true },
];

const SECONDARY_LINKS: { label: string; screen: Screen; disabledWithoutProject?: boolean }[] = [
  { label: 'Dashboard', screen: 'dashboard' },
  { label: 'Projects', screen: 'projects' },
  { label: 'Plans & Add-ons', screen: 'plans' },
  { label: 'Account', screen: 'account' },
  { label: 'Preset Library', screen: 'presets', disabledWithoutProject: true },
  { label: 'Audio Analysis', screen: 'analysis', disabledWithoutProject: true },
  { label: 'Export Center', screen: 'export', disabledWithoutProject: true },
  { label: 'Learn & Help', screen: 'learn' },
  { label: 'Settings', screen: 'settings' },
];

export default function TopNavigation({
  screen,
  projectName,
  projectOpen,
  mode,
  onModeChange,
  onNavigate,
  onOpenAssistant,
  onOpenCommandPalette,
  onUndo,
  onRedo,
  onOpenLanding,
  onStartTour,
}: TopNavigationProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (moreRef.current && event.target instanceof Node && !moreRef.current.contains(event.target)) {
        setMoreOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [moreOpen]);

  // Studio has its own full-height workspace header and navigation treatment.
  if (screen === 'studio') return null;

  const navigate = (destination: Screen) => {
    onNavigate(destination);
    setMoreOpen(false);
  };

  return (
    <header className="relative z-30 flex h-[88px] shrink-0 items-center justify-between gap-4 border-b border-white/[.07] bg-[#0D0D1B]/88 px-6 shadow-[0_8px_30px_rgba(0,0,0,.14)] backdrop-blur-xl sm:px-8 lg:px-10">
      <div className="flex min-w-0 shrink-0 items-center gap-2.5">
        <button
          type="button"
          onClick={() => navigate('dashboard')}
          aria-label="Sonora home"
          className="group flex items-center gap-2.5 rounded-lg text-left focus-ring"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#A77AFF]/30 bg-gradient-to-br from-[#8957FF]/25 to-[#7545EA]/10 text-[#C4A2FF] shadow-violet-soft">
            <Icon name="audio-lines" size={24} />
          </span>
          <span className="hidden min-w-0 sm:block">
            <span className="block text-base font-semibold tracking-[-.025em] text-white">Sonora</span>
            <span className="block text-[10px] font-medium uppercase tracking-[.18em] text-ink-500">Reference Studio</span>
          </span>
        </button>
      </div>

      <nav aria-label="Primary navigation" className="no-scrollbar flex min-w-0 flex-1 items-center justify-center gap-0.5 overflow-x-auto px-1">
        {PRIMARY_LINKS.map((item, index) => {
          const disabled = Boolean(item.disabledWithoutProject && !projectOpen);
          const selected = item.label !== 'AI Assistant' && item.screen === screen;
          return (
            <button
              key={item.label}
              type="button"
              disabled={disabled}
              onClick={() => { if (item.label === 'AI Assistant') { onOpenAssistant(); setMoreOpen(false); } else navigate(item.screen); }}
              aria-current={selected ? 'page' : undefined}
              className={`relative flex h-12 shrink-0 items-center gap-2.5 rounded-xl px-5 text-sm font-semibold transition-all duration-180 disabled:cursor-not-allowed disabled:opacity-35 sm:px-6 sm:text-base ${
                selected
                  ? 'bg-[#8957FF]/15 text-white shadow-[0_4px_18px_rgba(117,69,234,.12)]'
                  : 'text-ink-400 hover:bg-white/[.04] hover:text-ink-100'
              }`}
            >
              {index === 0 && <Icon name="waveform" size={17} className={selected ? 'text-[#C4A2FF]' : 'text-ink-500'} />}
              {index === 1 && <Icon name="equalizer" size={15} className={selected ? 'text-[#C4A2FF]' : 'text-ink-500'} />}
              {index === 2 && <Icon name="audio-lines" size={15} className={selected ? 'text-[#C4A2FF]' : 'text-ink-500'} />}
              {index === 3 && <Icon name="sparkles" size={15} className={selected ? 'text-[#C4A2FF]' : 'text-ink-500'} />}
              <span>{item.label}</span>
              {selected && <span className="absolute inset-x-4 -bottom-[1px] h-[2px] rounded-full bg-gradient-to-r from-[#8957FF] to-[#C4A2FF]" />}
            </button>
          );
        })}

        <div className="relative shrink-0" ref={moreRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
            className={`flex h-12 items-center gap-2 rounded-xl px-5 text-base font-semibold transition-colors ${
              moreOpen ? 'bg-white/[.06] text-white' : 'text-ink-400 hover:bg-white/[.04] hover:text-ink-100'
            }`}
          >
            More <Icon name="chevron-down" size={14} />
          </button>
          {moreOpen && (
            <div role="menu" className="absolute right-0 top-[calc(100%+12px)] z-50 w-72 rounded-2xl border border-white/[.10] bg-[#151426]/95 p-3 shadow-floating backdrop-blur-xl">
              <div className="px-3 pb-2 pt-2.5 text-[10px] font-semibold uppercase tracking-[.16em] text-ink-500">Workspace</div>
              {SECONDARY_LINKS.map((item) => {
                const disabled = Boolean(item.disabledWithoutProject && !projectOpen);
                return (
                  <button
                    key={item.screen}
                    type="button"
                    role="menuitem"
                    disabled={disabled}
                    onClick={() => navigate(item.screen)}
                    className={`flex w-full items-center rounded-xl px-4 py-4 text-left text-base font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                      screen === item.screen ? 'bg-[#8957FF]/15 text-[#C4A2FF]' : 'text-ink-300 hover:bg-white/[.05] hover:text-white'
                    }`}
                  >
                    {item.label}
                    {screen === item.screen && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#A77AFF]" />}
                  </button>
                );
              })}
              <div className="mt-1 border-t border-white/[.07] px-2.5 pb-1 pt-2">
                <div className="mb-2 text-[9px] font-semibold uppercase tracking-[.16em] text-ink-500">Interface mode</div>
                <div className="flex rounded-lg border border-white/[.08] bg-black/20 p-1">
                  {(['beginner', 'advanced'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => onModeChange(option)}
                      className={`flex-1 rounded-md px-3 py-2 text-xs capitalize transition-colors ${
                        mode === option ? 'bg-[#8957FF]/20 text-[#C4A2FF]' : 'text-ink-500 hover:text-ink-200'
                      }`}
                    >
                      {option === 'advanced' ? 'Engineer' : option}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" role="menuitem" onClick={() => { onOpenLanding(); setMoreOpen(false); }} className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-xs text-ink-400 transition-colors hover:bg-white/[.05] hover:text-ink-100">
                About Sonora
              </button>
            </div>
          )}
        </div>
      </nav>

      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" onClick={onOpenCommandPalette} title="Search Sonora (⌘K / Ctrl+K)" aria-label="Search Sonora" className="focus-ring inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-xl border border-white/[.08] bg-white/[.025] px-2.5 text-ink-300 transition-colors hover:border-[#A77AFF]/35 hover:bg-[#8957FF]/[.08] hover:text-[#C4A2FF] sm:px-3">
          <Icon name="search" size={17} />
          <span className="hidden text-xs font-medium xl:inline">Search</span>
          <kbd className="hidden rounded border border-white/[.1] px-1.5 py-0.5 font-mono text-[9px] text-ink-500 xl:inline">⌘K</kbd>
        </button>
        {projectName && (
          <div className="hidden max-w-[170px] items-center gap-2 rounded-lg border border-white/[.07] bg-white/[.025] px-2.5 py-1.5 xl:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[#8EDB75]" />
            <span className="truncate text-[10px] text-ink-300" title={projectName}>{projectName}</span>
          </div>
        )}
        <button type="button" onClick={onUndo} title="Undo" aria-label="Undo" className="focus-ring hidden h-10 w-10 items-center justify-center rounded-lg border border-white/[.07] text-ink-400 transition-colors hover:bg-white/[.05] hover:text-ink-100 sm:inline-flex">
          <span className="text-base">↶</span>
        </button>
        <button type="button" onClick={onRedo} title="Redo" aria-label="Redo" className="focus-ring hidden h-10 w-10 items-center justify-center rounded-lg border border-white/[.07] text-ink-400 transition-colors hover:bg-white/[.05] hover:text-ink-100 sm:inline-flex">
          <span className="text-base">↷</span>
        </button>
        <button
          type="button"
          onClick={onStartTour}
          title="Start guided tour"
          aria-label="Start guided tour"
          className="focus-ring inline-flex h-10 items-center gap-2 rounded-xl border border-[#A77AFF]/25 bg-[#8957FF]/[.08] px-3.5 text-xs font-semibold text-[#C4A2FF] transition-colors hover:border-[#A77AFF]/45 hover:bg-[#8957FF]/15"
        >
          <Icon name="sparkles" size={16} /> <span className="hidden sm:inline">Tour</span>
        </button>
        <HelpTip title="Quick guide" steps={['Import your song to create or open a project.', 'Open Reference Match and add a professional release you like.', 'Generate a chain, then edit or bypass every suggested processor.', 'Use the Mixing Studio timeline to arrange clips and the Mastering workspace to verify the final render.']}>
          <span className="sr-only">Sonora quick guide</span>
          Sonora keeps primary actions visible and advanced controls available when needed.
        </HelpTip>
        <button type="button" onClick={() => navigate('settings')} title="Settings" aria-label="Settings" className={`focus-ring flex h-10 w-10 items-center justify-center rounded-full border transition-all ${
          screen === 'settings' ? 'border-[#A77AFF]/60 bg-[#8957FF]/20 text-[#C4A2FF]' : 'border-white/[.10] bg-[#1D1D30] text-ink-300 hover:border-white/[.2] hover:text-white'
        }`}>
          <Icon name="settings" size={18} />
        </button>
        <button type="button" onClick={() => navigate('account')} aria-label="Open Sonora account" title="Account" className="focus-ring hidden h-10 w-10 items-center justify-center rounded-full border border-[#A77AFF]/40 bg-gradient-to-br from-[#8957FF]/35 to-[#7545EA]/15 text-[11px] font-semibold text-white transition hover:border-[#A77AFF]/70 hover:brightness-110 sm:flex">S</button>
      </div>
    </header>
  );
}
