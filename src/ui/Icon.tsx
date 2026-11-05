import type { SVGProps } from 'react';

export type SonoraIconName =
  | 'activity'
  | 'audio-lines'
  | 'check'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'clock'
  | 'download'
  | 'equalizer'
  | 'folder'
  | 'guitar'
  | 'headphones'
  | 'microphone'
  | 'music'
  | 'pause'
  | 'play'
  | 'plus'
  | 'repeat'
  | 'search'
  | 'settings'
  | 'skip-back'
  | 'skip-forward'
  | 'sliders'
  | 'sparkles'
  | 'upload'
  | 'volume'
  | 'waveform'
  | 'x';

const ICON_PATHS: Record<SonoraIconName, string[]> = {
  activity: ['M3 12h4l3-8 4 16 3-8h4'],
  'audio-lines': [
    'M2 10v4',
    'M6 6v12',
    'M10 3v18',
    'M14 8v8',
    'M18 5v14',
    'M22 10v4',
  ],
  check: ['m5 12 4 4L19 6'],
  'chevron-down': ['m6 9 6 6 6-6'],
  'chevron-left': ['m15 18-6-6 6-6'],
  'chevron-right': ['m9 18 6-6-6-6'],
  clock: ['M12 8v4l3 2', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3'],
  equalizer: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M2 14h4', 'M10 8h4', 'M18 16h4'],
  folder: ['M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'],
  guitar: ['m11 3 2 2-3 3-2-2 3-3Z', 'm8 8-5 5a2 2 0 0 0 3 3l5-5', 'm13 5 6 6', 'M16 8l2-2 3 3-2 2'],
  headphones: ['M3 14v-3a9 9 0 0 1 18 0v3', 'M3 14h4v7H5a2 2 0 0 1-2-2Z', 'M21 14h-4v7h2a2 2 0 0 0 2-2Z'],
  microphone: ['M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z', 'M19 10v2a7 7 0 0 1-14 0v-2', 'M12 19v3', 'M8 22h8'],
  music: ['M9 18V5l12-2v13', 'M9 9l12-2', 'M5 18a4 3 0 1 0 8 0 4 3 0 1 0-8 0Z', 'M17 16a4 3 0 1 0 8 0 4 3 0 1 0-8 0Z'],
  pause: ['M9 5v14', 'M15 5v14'],
  play: ['m8 5 12 7-12 7Z'],
  plus: ['M12 5v14', 'M5 12h14'],
  repeat: ['m17 2 4 4-4 4', 'M3 11V9a3 3 0 0 1 3-3h15', 'm7 22-4-4 4-4', 'M21 13v2a3 3 0 0 1-3 3H3'],
  search: ['m20 20-4.5-4.5', 'M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z'],
  settings: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 2.9-.2-.1a1.7 1.7 0 0 0-1.8.4l-.1.1h-3.4l-.1-.2a1.7 1.7 0 0 0-1.6-1l-.2.1-3-1.7.1-.2a1.7 1.7 0 0 0-.4-1.8l-.1-.1v-3.4l.2-.1a1.7 1.7 0 0 0 1-1.6l-.1-.2 1.7-3 .2.1a1.7 1.7 0 0 0 1.8-.4l.1-.1h3.4l.1.2a1.7 1.7 0 0 0 1.6 1l.2-.1 3 1.7-.1.2a1.7 1.7 0 0 0 .4 1.8l.1.1v3.4Z'],
  'skip-back': ['M19 5 9 12l10 7Z', 'M5 5v14'],
  'skip-forward': ['m5 5 10 7-10 7Z', 'M19 5v14'],
  sliders: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M2 14h4', 'M10 8h4', 'M18 16h4'],
  sparkles: ['m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z', 'm19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z', 'm5 3 .7 1.8L7.5 5.5l-1.8.7L5 8l-.7-1.8-1.8-.7 1.8-.7L5 3Z'],
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm17 8-5-5-5 5', 'M12 3v12'],
  volume: ['M11 5 6 9H3v6h3l5 4Z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M19 5a10 10 0 0 1 0 14'],
  waveform: ['M2 10v4', 'M5 6v12', 'M8 3v18', 'M11 8v8', 'M14 5v14', 'M17 9v6', 'M20 7v10', 'M23 10v4'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
};

export interface SonoraIconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: SonoraIconName;
  size?: number;
  title?: string;
}

/** Compact, consistent outline icon primitive for Sonora's interface. */
export function Icon({ name, size = 18, title, className = '', ...props }: SonoraIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      className={className}
      {...props}
    >
      {title && <title>{title}</title>}
      {ICON_PATHS[name].map((d, index) => <path key={index} d={d} />)}
    </svg>
  );
}
