import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent } from 'react';
import type { Screen } from '../state/store';
import { Icon, type SonoraIconName } from './Icon';

type CommandGroup = 'Workspace' | 'Production' | 'Support';

interface Command {
  id: string;
  label: string;
  description: string;
  screen: Screen;
  group: CommandGroup;
  icon: SonoraIconName;
  keywords: string;
  requiresProject?: boolean;
}

const COMMANDS: Command[] = [
  { id: 'dashboard', label: 'Dashboard', description: 'Your project overview and next steps', screen: 'dashboard', group: 'Workspace', icon: 'activity', keywords: 'home overview start' },
  { id: 'projects', label: 'Projects', description: 'Open, create and manage sessions', screen: 'projects', group: 'Workspace', icon: 'folder', keywords: 'sessions files recent' },
  { id: 'plans', label: 'Plans & Add-ons', description: 'Compare plans and available features', screen: 'plans', group: 'Workspace', icon: 'sparkles', keywords: 'pricing subscription credits billing' },
  { id: 'account', label: 'Account', description: 'Profile, sign-in and subscription details', screen: 'account', group: 'Workspace', icon: 'settings', keywords: 'profile login password user' },
  { id: 'studio', label: 'Mixing Studio', description: 'Arrange tracks, balance channels and edit your mix', screen: 'studio', group: 'Production', icon: 'waveform', keywords: 'daw mixer arrangement tracks timeline', requiresProject: true },
  { id: 'reference', label: 'Reference Match', description: 'Compare your mix with a reference release', screen: 'reference', group: 'Production', icon: 'headphones', keywords: 'matching compare target tonal balance', requiresProject: true },
  { id: 'mastering', label: 'Mastering', description: 'Refine loudness, dynamics and final peaks', screen: 'mastering', group: 'Production', icon: 'equalizer', keywords: 'master limiter loudness true peak', requiresProject: true },
  { id: 'presets', label: 'Preset Library', description: 'Browse editable starting points for your sound', screen: 'presets', group: 'Production', icon: 'music', keywords: 'chains effects eq dynamics', requiresProject: true },
  { id: 'analysis', label: 'Audio Analysis', description: 'Inspect loudness, spectrum and stereo behaviour', screen: 'analysis', group: 'Production', icon: 'activity', keywords: 'measure spectrum lufs stereo waveform', requiresProject: true },
  { id: 'export', label: 'Export Center', description: 'Render and download your finished audio', screen: 'export', group: 'Production', icon: 'download', keywords: 'render bounce wav mp3 download', requiresProject: true },
  { id: 'learn', label: 'Learn & Help', description: 'Guides, explanations and workflow help', screen: 'learn', group: 'Support', icon: 'sparkles', keywords: 'help tutorial guide documentation' },
  { id: 'settings', label: 'Settings', description: 'Configure your Sonora workspace', screen: 'settings', group: 'Support', icon: 'settings', keywords: 'preferences interface audio storage' },
];

const GROUP_ORDER: CommandGroup[] = ['Workspace', 'Production', 'Support'];

interface CommandPaletteProps {
  open: boolean;
  hasProject: boolean;
  onClose: () => void;
  onNavigate: (screen: Screen) => void;
}

export function CommandPalette({ open, hasProject, onClose, onNavigate }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const onCloseRef = useRef(onClose);
  const onNavigateRef = useRef(onNavigate);

  useEffect(() => {
    onCloseRef.current = onClose;
    onNavigateRef.current = onNavigate;
  }, [onClose, onNavigate]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return COMMANDS;
    return COMMANDS.filter((command) =>
      `${command.label} ${command.description} ${command.keywords}`.toLowerCase().includes(normalized),
    );
  }, [query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleEscape);
      previousFocus?.focus();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const choose = (command: Command) => {
    if (command.requiresProject && !hasProject) return;
    onNavigateRef.current(command.screen);
    onCloseRef.current();
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => Math.min(filtered.length - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => Math.max(0, current - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const selected = filtered[activeIndex];
      if (selected) choose(selected);
    }
  };

  const activeCommand = filtered[activeIndex];

  return createPortal(
    <div
      className="fixed inset-0 z-[1300] flex items-start justify-center overflow-y-auto bg-[#05050D]/75 px-4 pb-8 pt-[min(18vh,150px)] backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="sonora-command-title"
        className="w-full max-w-[620px] overflow-hidden rounded-[24px] border border-white/[.13] bg-[#11111F]/[.98] shadow-[0_32px_110px_rgba(0,0,0,.7)]"
      >
        <div className="flex items-center gap-3 border-b border-white/[.08] px-5 py-4 sm:px-6">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#A77AFF]/25 bg-[#8957FF]/[.12] text-[#C4A2FF]">
            <Icon name="search" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="sonora-command-title" className="sr-only">Search Sonora</h2>
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="Find a workspace or tool…"
              aria-label="Search Sonora navigation"
              aria-controls="sonora-command-results"
              aria-activedescendant={activeCommand ? `sonora-command-${activeCommand.id}` : undefined}
              role="combobox"
              aria-expanded="true"
              aria-autocomplete="list"
              className="h-10 w-full border-0 bg-transparent text-base text-white outline-none placeholder:text-ink-500"
            />
          </div>
          <kbd className="hidden rounded-md border border-white/[.1] bg-white/[.04] px-2 py-1 font-mono text-[10px] text-ink-400 sm:inline">ESC</kbd>
          <button type="button" onClick={onClose} aria-label="Close search" className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-white/[.06] hover:text-white">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div id="sonora-command-results" role="listbox" aria-label="Sonora destinations" className="max-h-[min(56vh,520px)] overflow-y-auto p-3 sm:p-4">
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-white/[.04] text-ink-400"><Icon name="search" size={20} /></div>
              <p className="mt-3 text-sm font-medium text-ink-200">No matching tools</p>
              <p className="mt-1 text-xs text-ink-500">Try “mix”, “reference”, “export” or “settings”.</p>
            </div>
          ) : (
            GROUP_ORDER.map((group) => {
              const items = filtered.filter((command) => command.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group} className="mb-3 last:mb-0">
                  <p className="px-3 pb-2 pt-2 text-[10px] font-semibold uppercase tracking-[.16em] text-ink-500">{group}</p>
                  <div className="space-y-1">
                    {items.map((command) => {
                      const index = filtered.findIndex((item) => item.id === command.id);
                      const selected = index === activeIndex;
                      const disabled = Boolean(command.requiresProject && !hasProject);
                      return (
                        <button
                          key={command.id}
                          id={`sonora-command-${command.id}`}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          disabled={disabled}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => choose(command)}
                          className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
                            selected
                              ? 'border-[#A77AFF]/25 bg-[#8957FF]/[.13] shadow-[0_0_0_1px_rgba(137,87,255,.06)]'
                              : 'border-transparent hover:border-white/[.06] hover:bg-white/[.035]'
                          }`}
                        >
                          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                            selected ? 'bg-[#8957FF]/20 text-[#C4A2FF]' : 'bg-white/[.045] text-ink-400'
                          }`}>
                            <Icon name={command.icon} size={18} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-ink-100">{command.label}</span>
                            <span className="mt-0.5 block text-xs leading-5 text-ink-400">{disabled ? 'Open a project first to use this workspace' : command.description}</span>
                          </span>
                          {selected && !disabled && <Icon name="chevron-right" size={17} className="shrink-0 text-[#C4A2FF]" />}
                          {disabled && <span className="shrink-0 text-[10px] text-ink-500">Locked</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[.08] bg-black/15 px-5 py-3 text-[10px] text-ink-500 sm:px-6">
          <span>Navigate anywhere in Sonora</span>
          <span className="flex items-center gap-3 font-mono">
            <span><kbd className="rounded border border-white/[.1] px-1.5 py-0.5">↑</kbd> <kbd className="rounded border border-white/[.1] px-1.5 py-0.5">↓</kbd> move</span>
            <span><kbd className="rounded border border-white/[.1] px-1.5 py-0.5">↵</kbd> open</span>
          </span>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
