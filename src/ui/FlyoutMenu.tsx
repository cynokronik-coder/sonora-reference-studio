import { useCallback, useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';
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
 * Hover opens for discovery, click pins it while the user adjusts controls.
 * Touch and keyboard users open it through the button.
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const panelId = `sonora-flyout-${useRef(Math.random().toString(36).slice(2, 9)).current}`;

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
    closeTimer.current = window.setTimeout(() => setOpen(false), 180);
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

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) dismiss();
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

  return (
    <div
      ref={rootRef}
      className="relative inline-flex"
      onPointerEnter={scheduleOpen}
      onPointerLeave={scheduleClose}
    >
      <button
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

      <div
        id={panelId}
        role="dialog"
        aria-label={title ?? label}
        aria-hidden={!open}
        onPointerEnter={() => {
          clearTimers();
        }}
        onPointerLeave={scheduleClose}
        className={`absolute top-[calc(100%+9px)] z-[70] origin-top ${placement === 'bottom-end' ? 'right-0' : 'left-0'} ${WIDTHS[width]} rounded-xl border border-white/[.11] bg-[rgba(20,20,37,.92)] p-3 text-left shadow-floating backdrop-blur-glass transition-[opacity,transform,visibility] duration-180 ease-out ${
          open ? 'visible translate-y-0 scale-100 opacity-100' : 'invisible -translate-y-1 scale-[.99] opacity-0'
        }`}
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
      </div>
    </div>
  );
}
