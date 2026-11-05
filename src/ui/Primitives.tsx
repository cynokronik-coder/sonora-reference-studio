import type { ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { clamp } from '../audio/dsp/util';

export function Panel({
  children,
  className = '',
  title,
  subtitle,
  right,
  dense,
  dataTour,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  dense?: boolean;
  dataTour?: string;
}) {
  return (
    <section data-tour={dataTour} className={`panel shadow-panel ${className}`}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 border-b border-white/[.06] px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-[13px] font-semibold tracking-wide text-ink-100">{title}</h2>}
            {subtitle && <p className="mt-0.5 truncate text-2xs text-ink-400">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      <div className={dense ? '' : 'p-4'}>{children}</div>
    </section>
  );
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  disabled,
  title,
  className = '',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  title?: string;
  className?: string;
  type?: 'button' | 'submit';
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-control border font-medium transition-all duration-180 focus-ring disabled:cursor-not-allowed disabled:opacity-40 active:scale-[.985]';
  const sizes = size === 'sm' ? 'min-h-8 px-3 py-1.5 text-2xs' : 'min-h-9 px-3.5 py-2 text-xs';
  const variants: Record<string, string> = {
    primary: 'border-[#A77AFF]/55 bg-gradient-to-br from-[#8957FF] to-[#7545EA] text-white shadow-violet hover:brightness-110 hover:shadow-violet-soft',
    secondary: 'border-white/[.09] bg-[#1D1D30]/90 text-ink-100 shadow-[0_1px_0_rgba(255,255,255,.035)_inset] hover:border-white/[.16] hover:bg-[#252538]',
    ghost: 'border-transparent bg-transparent text-ink-300 hover:border-white/[.07] hover:bg-white/[.045] hover:text-ink-100',
    danger: 'border-signal-red/35 bg-signal-red/10 text-signal-red hover:border-signal-red/55 hover:bg-signal-red/15',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${sizes} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function IconButton({
  children,
  onClick,
  active,
  title,
  disabled,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  title?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`focus-ring inline-flex h-8 min-w-8 items-center justify-center rounded-lg border px-1.5 text-2xs font-medium transition-all duration-180 disabled:opacity-40 ${
        active
          ? 'border-[#A77AFF]/55 bg-[#8957FF]/15 text-[#C4A2FF] shadow-violet-soft'
          : 'border-white/[.08] bg-[#171727] text-ink-300 hover:border-white/[.16] hover:bg-[#252538] hover:text-ink-100'
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex cursor-pointer items-start gap-2.5 ${disabled ? 'opacity-50' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`focus-ring relative mt-0.5 h-[18px] w-8 shrink-0 rounded-full border transition-colors duration-180 ${
          checked ? 'border-[#A77AFF]/65 bg-[#8957FF]' : 'border-white/[.12] bg-[#303047]'
        }`}
      >
        <span
          className={`absolute top-[2px] h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-180 ${
            checked ? 'translate-x-[15px]' : 'translate-x-[2px]'
          }`}
        />
      </button>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-xs font-medium text-ink-100">{label}</span>}
          {description && <span className="mt-0.5 block text-2xs leading-relaxed text-ink-400">{description}</span>}
        </span>
      )}
    </label>
  );
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className = '',
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="mb-1.5 block text-2xs font-medium text-ink-400">{label}</span>}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          const match = options.find((o) => String(o.value) === raw);
          if (match) onChange(match.value);
        }}
        className="focus-ring w-full rounded-control border border-white/[.09] bg-[#171727] px-3 py-2 text-xs text-ink-100 shadow-[0_1px_0_rgba(255,255,255,.025)_inset] transition-colors hover:border-white/[.15] disabled:opacity-40"
      >
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function NumberField({
  value,
  onChange,
  label,
  min,
  max,
  step = 0.1,
  unit,
  className = '',
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) {
      onChange(clamp(parsed, min ?? -Infinity, max ?? Infinity));
    } else {
      setDraft(String(value));
    }
  };
  return (
    <label className={`block ${className}`}>
      {label && <span className="mb-1.5 block text-2xs font-medium text-ink-400">{label}</span>}
      <span className="flex items-center rounded-control border border-white/[.09] bg-[#0D0D1B] px-2 focus-within:border-[#A77AFF]/60 focus-within:ring-2 focus-within:ring-[#8957FF]/10">
        <input
          className="num-input w-full bg-transparent py-2 text-right font-mono text-xs text-ink-100 outline-none disabled:opacity-40"
          type="number"
          value={draft}
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          onFocus={() => (focused.current = true)}
          onBlur={() => {
            focused.current = false;
            commit();
          }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit();
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {unit && <span className="pl-2 text-2xs text-ink-500">{unit}</span>}
      </span>
    </label>
  );
}

/**
 * Parameter slider with a live numeric readout. Frequency controls can use
 * logarithmic scaling so the low end receives useful adjustment resolution.
 */
export function ParamSlider({
  label,
  value,
  min,
  max,
  step = 0.01,
  unit = '',
  onChange,
  logarithmic,
  format,
  compact,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
  logarithmic?: boolean;
  format?: (value: number) => string;
  compact?: boolean;
}) {
  const toSlider = (v: number) =>
    logarithmic ? Math.log(Math.max(1e-6, v) / Math.max(1e-6, min)) / Math.log(max / min) : (v - min) / (max - min);
  const fromSlider = (t: number) =>
    logarithmic ? min * Math.pow(max / min, t) : min + t * (max - min);
  const sliderValue = clamp(toSlider(value), 0, 1) * 1000;
  return (
    <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-2xs font-medium text-ink-400">{label}</span>
        <span className="shrink-0 font-mono text-2xs tabular-nums text-ink-200">
          {format ? format(value) : `${Number(value.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0))}${unit ? ` ${unit}` : ''}`}
        </span>
      </div>
      <input
        type="range"
        className="w-full"
        min={0}
        max={1000}
        step={1}
        value={sliderValue}
        onChange={(e) => {
          const t = Number(e.target.value) / 1000;
          const raw = fromSlider(t);
          const snapped = Math.round(raw / step) * step;
          onChange(clamp(snapped, min, max));
        }}
      />
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'warn' | 'danger' | 'info';
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'border-white/[.10] bg-white/[.035] text-ink-300',
    accent: 'border-[#A77AFF]/30 bg-[#8957FF]/10 text-[#C4A2FF]',
    warn: 'border-signal-amber/30 bg-signal-amber/10 text-signal-amber',
    danger: 'border-signal-red/30 bg-signal-red/10 text-signal-red',
    info: 'border-signal-cyan/30 bg-signal-cyan/10 text-signal-cyan',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium tracking-wide ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function ProgressBar({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'danger' }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-[#303047]">
      <div
        className={`h-full rounded-full transition-[width] duration-180 ${tone === 'accent' ? 'bg-gradient-to-r from-[#7545EA] to-[#A77AFF]' : 'bg-signal-red'}`}
        style={{ width: `${Math.round(clamp(value, 0, 1) * 100)}%` }}
      />
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#05050c]/75 p-4 backdrop-blur-md" onClick={onClose}>
      <div
        className={`max-h-[85vh] w-full overflow-auto rounded-panel border border-white/[.10] bg-[#151426]/95 p-4 shadow-floating backdrop-blur-xl ${wide ? 'max-w-3xl' : 'max-w-md'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-ink-100">{title}</h3>
          <IconButton onClick={onClose} title="Close">
            ×
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink-200">{title}</p>
      <p className="max-w-md text-xs leading-relaxed text-ink-400">{description}</p>
      {action}
    </div>
  );
}

export function InfoRow({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/[.055] py-2 last:border-0">
      <span className="text-2xs text-ink-400">{label}</span>
      <span className={`font-mono text-2xs tabular-nums text-ink-100 ${tone ?? ''}`}>{value}</span>
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (value: T) => void;
  tabs: { value: T; label: string; badge?: string }[];
}) {
  return (
    <div className="inline-flex max-w-full gap-1 rounded-xl border border-white/[.07] bg-black/20 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          aria-pressed={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={`focus-ring whitespace-nowrap rounded-lg px-3 py-1.5 text-2xs font-medium transition-all duration-180 ${
            value === tab.value
              ? 'border border-[#A77AFF]/25 bg-[#8957FF]/15 text-[#C4A2FF] shadow-violet-soft'
              : 'border border-transparent text-ink-400 hover:bg-white/[.04] hover:text-ink-200'
          }`}
        >
          {tab.label}
          {tab.badge && <span className="ml-1 opacity-60">{tab.badge}</span>}
        </button>
      ))}
    </div>
  );
}

export function useFilePicker(): { open: (accept: string, multiple: boolean, onFiles: (files: File[]) => void) => void } {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const callbackRef = useRef<((files: File[]) => void) | null>(null);
  if (!inputRef.current && typeof document !== 'undefined') {
    const input = document.createElement('input');
    input.type = 'file';
    input.style.display = 'none';
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      if (files.length && callbackRef.current) callbackRef.current(files);
      input.value = '';
    };
    document.body.appendChild(input);
    inputRef.current = input;
  }
  return {
    open: (accept, multiple, onFiles) => {
      callbackRef.current = onFiles;
      const input = inputRef.current!;
      input.accept = accept;
      input.multiple = multiple;
      input.click();
    },
  };
}

/** Contextual help foundation. Dedicated tours and advanced flyouts are introduced in later batches. */
export function HelpTip({
  title,
  children,
  steps,
  label = 'Explain this',
}: {
  title: string;
  children: ReactNode;
  steps?: string[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    <span ref={rootRef} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="focus-ring inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/[.12] bg-[#171727] text-[10px] font-semibold text-ink-300 transition-all duration-180 hover:border-[#A77AFF]/55 hover:bg-[#8957FF]/10 hover:text-[#C4A2FF]"
      >
        ?
      </button>
      {open && (
        <span
          id={id}
          role="dialog"
          aria-label={title}
          className="absolute right-0 top-7 z-50 block w-[min(300px,85vw)] rounded-xl border border-white/[.10] bg-[#151426]/95 p-3 text-left shadow-floating backdrop-blur-xl"
        >
          <span className="flex items-start justify-between gap-3">
            <span className="text-xs font-semibold text-ink-100">{title}</span>
            <button
              type="button"
              aria-label="Close explanation"
              onClick={() => setOpen(false)}
              className="rounded-md px-1 text-ink-500 transition-colors hover:bg-white/[.05] hover:text-ink-100"
            >
              ×
            </button>
          </span>
          <span className="mt-2 block text-2xs leading-relaxed text-ink-300">{children}</span>
          {steps && steps.length > 0 && (
            <span className="mt-2 block space-y-1.5 border-t border-white/[.07] pt-2">
              {steps.map((step, index) => (
                <span key={step} className="flex gap-2 text-2xs leading-relaxed text-ink-400">
                  <span className="font-mono tabular-nums text-[#A77AFF]">{String(index + 1).padStart(2, '0')}</span>
                  <span>{step}</span>
                </span>
              ))}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

export const AUDIO_ACCEPT = '.wav,.aif,.aiff,.flac,.mp3,.m4a,.aac,.ogg,.oga,audio/*';
