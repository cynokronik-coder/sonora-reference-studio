import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Screen } from '../state/store';
import { Icon } from './Icon';
import { Button, ProgressBar } from './Primitives';

interface TourStep {
  target: string;
  title: string;
  description: string;
}

const TOUR_STEPS: Partial<Record<Screen, TourStep[]>> = {
  dashboard: [
    { target: 'dashboard-import', title: 'Start with your mix', description: 'Import the stereo mix you want to improve, or create a blank project and bring in stems.' },
    { target: 'dashboard-workflow', title: 'Follow the workflow', description: 'Measure your mix, compare it with a reference, then create an editable processing plan.' },
    { target: 'dashboard-workspaces', title: 'Open a workspace', description: 'Move between Studio, Reference Match and Mastering as your session develops.' },
  ],
  projects: [
    { target: 'projects-create', title: 'Create a project', description: 'Projects keep your tracks, processor chains, measurements and renders together.' },
    { target: 'projects-list', title: 'Manage sessions', description: 'Open, duplicate or delete a local project. Its source audio stays in this browser profile.' },
  ],
  studio: [
    { target: 'studio-tracks', title: 'Manage your tracks', description: 'Select a channel, adjust its level, and use Solo or Mute. Secondary channel settings live in the contextual controls.' },
    { target: 'studio-transport', title: 'Control playback', description: 'Play, pause, seek and adjust the session tempo from the transport bar.' },
    { target: 'studio-timeline', title: 'Edit the arrangement', description: 'Move, trim, split and shape clips directly on the timeline. Waveforms are drawn from your imported audio.' },
    { target: 'studio-processing', title: 'Open processing tools', description: 'Switch between Mix, Effects, EQ, Dynamics and Export without leaving the Studio layout.' },
    { target: 'studio-assistant', title: 'Work with Sonora AI', description: 'Ask for analysis or processing suggestions. Proposed changes stay in preview until you accept them.' },
  ],
  mastering: [
    { target: 'mastering-upload', title: 'Choose your mix', description: 'Upload or replace the master source. Sonora keeps the original audio unchanged.' },
    { target: 'mastering-styles', title: 'Choose a starting point', description: 'Balanced, Warm and Bright load real editable processor chains; they are starting points, not one-click guarantees.' },
    { target: 'mastering-metering', title: 'Read the measurements', description: 'Live peak and gain-reduction meters are shown alongside loudness and true-peak values from an actual render.' },
    { target: 'mastering-chain', title: 'Refine the master chain', description: 'Edit, bypass and reorder every processor before you render and verify the result.' },
  ],
  reference: [
    { target: 'reference-target', title: 'Your track', description: 'This is the mix you want to improve. Run analysis to measure its loudness, dynamics and stereo characteristics.' },
    { target: 'reference-source', title: 'Reference track', description: 'Add a professionally released track whose tonal balance or production character you want to study.' },
    { target: 'reference-readiness', title: 'Check analysis readiness', description: 'The ring shows whether both required analysis reports are ready. It is not a subjective match score.' },
    { target: 'reference-controls', title: 'Set matching priorities', description: 'Choose global intensity and decide which measured characteristics should influence the suggestions.' },
    { target: 'reference-proposals', title: 'Review suggested processing', description: 'Inspect the measured reasons and expected changes. You can exclude individual proposals before applying the chain.' },
  ],
  export: [
    { target: 'export-format', title: 'Choose your format', description: 'Set the file format, bit depth, sample rate and whether to render the full master or one track.' },
    { target: 'export-advanced', title: 'Open advanced options', description: 'Dither, final peak normalization and metadata are available here when you need them.' },
    { target: 'export-render', title: 'Render and download', description: 'Sonora renders offline using the same processing graph, then provides the encoded file.' },
    { target: 'export-history', title: 'Verify past exports', description: 'Review previous renders and re-decode a stored file to verify its measured loudness and true peak.' },
  ],
  settings: [
    { target: 'settings-categories', title: 'Find a setting', description: 'Settings are grouped by AI, Interface, Audio, Project, Storage and About.' },
    { target: 'settings-content', title: 'Configure your workspace', description: 'Review connection status, engine information and project preferences without leaving the current session.' },
  ],
  presets: [
    { target: 'presets-filters', title: 'Browse presets', description: 'Filter by category or search by name to find a starting point.' },
    { target: 'presets-list', title: 'Apply an editable chain', description: 'Presets load real processor settings. You can adjust or remove each processor afterward.' },
  ],
  analysis: [
    { target: 'analysis-select', title: 'Choose an audio asset', description: 'Select the target or reference file you want to measure.' },
    { target: 'analysis-report', title: 'Read measured results', description: 'Explore loudness, spectral balance, stereo behaviour, rhythm and detected sections from the decoded audio.' },
  ],
  learn: [
    { target: 'learn-content', title: 'Learn at your pace', description: 'Use the guides and references to understand the workflows and audio measurements in Sonora.' },
  ],
};

interface GuidedTourProps {
  open: boolean;
  screen: Screen;
  onClose: () => void;
}

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const STORAGE_PREFIX = 'sonora:onboarding:v1:';

function rememberTour(screen: Screen, state: 'completed' | 'skipped') {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${screen}`, state);
  } catch {
    // Private browsing/storage policies must not prevent the tour from working.
  }
}

export function GuidedTour({ open, screen, onClose }: GuidedTourProps) {
  const steps = useMemo(() => TOUR_STEPS[screen] ?? [], [screen]);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const [tooltip, setTooltip] = useState({ top: 100, left: 24 });
  const step = steps[index];

  useEffect(() => {
    if (open) setIndex(0);
  }, [open, screen]);

  useLayoutEffect(() => {
    if (!open || !step) {
      setRect(null);
      return;
    }

    let frame = 0;
    const update = () => {
      const target = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (!target) {
        setRect(null);
        setTooltip({ top: Math.max(24, window.innerHeight * 0.32), left: Math.max(16, (window.innerWidth - 340) / 2) });
        return;
      }

      const bounds = target.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) {
        setRect(null);
        return;
      }

      const padding = 7;
      const nextRect = {
        top: Math.max(8, bounds.top - padding),
        left: Math.max(8, bounds.left - padding),
        width: Math.min(window.innerWidth - 16, bounds.width + padding * 2),
        height: Math.min(window.innerHeight - 16, bounds.height + padding * 2),
      };
      setRect(nextRect);

      const tooltipWidth = Math.min(360, window.innerWidth - 32);
      const estimatedHeight = 190;
      const below = bounds.bottom + 20 + estimatedHeight <= window.innerHeight - 16;
      const top = below
        ? Math.min(window.innerHeight - estimatedHeight - 16, bounds.bottom + 18)
        : Math.max(16, bounds.top - estimatedHeight - 18);
      const left = Math.max(16, Math.min(bounds.left, window.innerWidth - tooltipWidth - 16));
      setTooltip({ top, left });
    };

    const target = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (target) {
      const bounds = target.getBoundingClientRect();
      const outsideViewport = bounds.top < 12 || bounds.bottom > window.innerHeight - 12 || bounds.left < 8 || bounds.right > window.innerWidth - 8;
      if (outsideViewport) target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }

    frame = window.requestAnimationFrame(update);
    const onScroll = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, screen, step]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        rememberTour(screen, 'skipped');
        onClose();
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setIndex((current) => Math.min(steps.length - 1, current + 1));
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setIndex((current) => Math.max(0, current - 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, steps.length]);

  if (!open || !step || typeof document === 'undefined') return null;

  const skip = () => {
    rememberTour(screen, 'skipped');
    onClose();
  };

  const finish = () => {
    rememberTour(screen, 'completed');
    onClose();
  };

  const next = () => {
    if (index >= steps.length - 1) finish();
    else setIndex((current) => current + 1);
  };

  const right = rect ? rect.left + rect.width : 0;
  const bottom = rect ? rect.top + rect.height : 0;
  const spotlightStyle = {
    background: 'rgba(3, 4, 13, 0.64)',
    backdropFilter: 'blur(1.5px)',
    WebkitBackdropFilter: 'blur(1.5px)',
  };

  return createPortal(
    <div className="fixed inset-0 z-[1200]" aria-label="Guided tour">
      {rect ? (
        <>
          <div className="fixed left-0 top-0 w-full" style={{ ...spotlightStyle, height: rect.top }} />
          <div className="fixed left-0 w-full" style={{ ...spotlightStyle, top: bottom, height: Math.max(0, window.innerHeight - bottom) }} />
          <div className="fixed left-0" style={{ ...spotlightStyle, top: rect.top, width: rect.left, height: rect.height }} />
          <div className="fixed right-0" style={{ ...spotlightStyle, top: rect.top, left: right, height: rect.height }} />
          <div
            className="pointer-events-none fixed rounded-xl border-2 border-[#A77AFF] shadow-[0_0_0_1px_rgba(137,87,255,.35),0_0_28px_rgba(137,87,255,.38)]"
            style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          />
        </>
      ) : (
        <div className="fixed inset-0 bg-[#03040d]/65 backdrop-blur-sm" />
      )}

      <section
        role="dialog"
        aria-modal="false"
        aria-labelledby="sonora-tour-title"
        className="fixed w-[min(360px,calc(100vw-32px))] rounded-xl border border-white/[.11] bg-[rgba(20,20,37,.96)] p-4 text-left shadow-floating backdrop-blur-xl animate-[sonora-tour-pop_180ms_ease-out]"
        style={{ top: tooltip.top, left: tooltip.left }}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="rounded-full border border-[#A77AFF]/25 bg-[#8957FF]/10 px-2 py-1 font-mono text-[9px] font-medium uppercase tracking-[.12em] text-[#C4A2FF]">
            Step {index + 1} / {steps.length}
          </span>
          <button type="button" aria-label="Close tour" onClick={skip} className="rounded-md px-1.5 py-1 text-ink-500 transition-colors hover:bg-white/[.05] hover:text-white">
            <Icon name="x" size={15} />
          </button>
        </div>
        <h2 id="sonora-tour-title" className="text-sm font-semibold text-white">{step.title}</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-300">{step.description}</p>
        <div className="mt-4">
          <ProgressBar value={(index + 1) / steps.length} />
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button type="button" onClick={skip} className="rounded-md px-2 py-1.5 text-[10px] font-medium text-ink-500 transition-colors hover:bg-white/[.04] hover:text-ink-200">
            Skip
          </button>
          <div className="flex items-center gap-1.5">
            {index > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setIndex((current) => Math.max(0, current - 1))}>
                Previous
              </Button>
            )}
            <Button size="sm" variant="primary" onClick={next}>
              {index === steps.length - 1 ? 'Finish' : 'Next'} <Icon name="chevron-right" size={13} />
            </Button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
