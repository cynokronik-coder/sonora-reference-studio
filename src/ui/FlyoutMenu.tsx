import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon, type SonoraIconName } from './Icon';

export interface FlyoutMenuProps {
  label?: string;
  icon?: SonoraIconName;
  title?: string;
  description?: string;
  children: ReactNode;
  placement?: 'bottom-start' | 'bottom-end';
  width?: 'sm' | 'md' | 'lg';
  triggerClassName?: string;
  disabled?: boolean;
}

const WIDTHS = {
  sm: 'w-[min(260px,calc(100vw-24px))]',
  md: 'w-[min(320px,calc(100vw-24px))]',
  lg: 'w-[min(420px,calc(100vw-24px))]',
} as const;

/**
 * Contextual settings flyout.
 * Hover opens for discovery; click pins it during adjustment.
 * The floating surface is portalled to the document body so scrollable panels
 * and track lists cannot clip it.
 */
export function FlyoutMenu({
  label = 'Settings',
  icon = 'sliders',
  title,
  description,
  children,
  placement = 'bottom-start',
  width = 'md',
  triggerClassName = '',
  disabled = false,
}: FlyoutMenuProps) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const panelId = `sonora-flyout-${useId().replace(/:/g, '')}`;

  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  const dismiss = useCallback(() => {
    clearTimers();
    setOpen(false);
    setPinned(false);
  }, [clearTimers]);

  const scheduleOpen = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.pointerType !== 'mouse' || pinned) return;
    clearTimers();
    openTimer.current = window.setTimeout(() => setOpen(true), 110);
  };

  const scheduleClose = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || pinned) return;
    clearTimers();
    closeTimer.current = window.setTimeout(() => setOpen(false), 190);
  };

  const handleTriggerClick = () => {
    clearTimers();
    if (pinned) {
      dismiss();
      return;
    }
    setPinned(true);
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      if (!anchor || !panel) return;
      const margin = 12;
      const gap = 8;
      let left = placement === 'bottom-end' ? anchor.right - panel.width : anchor.left;
      left = Math.max(margin, Math.min(left, window.innerWidth - panel.width - margin));
      let top = anchor.bottom + gap;
      if (top + panel.height > window.innerHeight - margin) top = anchor.top - panel.height - gap;
      top = Math.max(margin, Math.min(top, window.innerHeight - panel.height - margin));
      setPosition({ top, left });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, placement, width, title, description]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      dismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, dismiss]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const flyout = open ? createPortal(
    <div
      ref={panelRef}
      id={panelId}
      role="dialog"
      aria-label={title ?? label}
      onPointerEnter={clearTimers}
      onPointerLeave={scheduleClose}
      style={{ position: 'fixed', top: position.top, left: position.left }}
      className={`z-[1000] ${WIDTHS[width]} rounded-xl border border-white/[.11] bg-[rgba(20,20,37,.94)] p-3 text-left shadow-floating backdrop-blur-glass animate-[sonora-flyout-in_180ms_ease-out]`}
    >
      {(title || description) && (
        <div className="mb-3 border-b border-white/[.07] pb-2.5">
          {title && <p className="text-xs font-semibold text-ink-100">{title}</p>}
          {description && <p className="mt-1 text-2xs leading-relaxed text-ink-400">{description}</p>}
        </div>
      )}
      <div className="max-h-[min(60vh,480px)] space-y-3 overflow-y-auto pr-0.5">
        {children}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div ref={rootRef} className="relative inline-flex" onPointerEnter={scheduleOpen} onPointerLeave={scheduleClose}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={handleTriggerClick}
        className={`focus-ring inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-white/[.08] bg-[#171727]/90 px-2.5 py-1.5 text-[10px] font-medium text-ink-300 shadow-[0_1px_0_rgba(255,255,255,.025)_inset] transition-all duration-180 hover:border-[#A77AFF]/40 hover:bg-[#8957FF]/10 hover:text-[#C4A2FF] disabled:cursor-not-allowed disabled:opacity-40 ${open ? 'border-[#A77AFF]/45 bg-[#8957FF]/[.12] text-[#C4A2FF]' : ''} ${triggerClassName}`}
      >
        <Icon name={icon} size={14} />
        {label && <span>{label}</span>}
      </button>
      {flyout}
    </div>
  );
}
