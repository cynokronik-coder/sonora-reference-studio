# 001 — Make command palette result selection instantaneous

- **Status**: TODO
- **Commit**: 4293922
- **Severity**: HIGH
- **Category**: Purpose & frequency
- **Estimated scope**: 1 file, small

## Problem

The command palette result rows transition every time the keyboard-selected result changes. The command palette is a high-frequency keyboard navigation surface: arrow-key selection should communicate the current result immediately, not leave a 150 ms visual trail.

The current class in **src/ui/CommandPalette.tsx:208–212** is:

~~~tsx
className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
  selected
    ? 'border-[#A77AFF]/25 bg-[#8957FF]/[.13] shadow-[0_0_0_1px_rgba(137,87,255,.06)]'
    : 'border-transparent hover:border-white/[.06] hover:bg-white/[.035]'
}`}
~~~

The selected state changes when Arrow Up / Arrow Down updates activeIndex. The same transition also animates hover and selected-state paint properties.

## Target

Remove the transition from command result rows. Keep all existing selected, hover, disabled and focus visuals, but let them update immediately.

~~~tsx
className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left disabled:cursor-not-allowed disabled:opacity-40 ${
  selected
    ? 'border-[#A77AFF]/25 bg-[#8957FF]/[.13] shadow-[0_0_0_1px_rgba(137,87,255,.06)]'
    : 'border-transparent hover:border-white/[.06] hover:bg-white/[.035]'
}`}
~~~

Do not add a replacement transition, keyframe, spring or delayed state update. The command palette's existing instantaneous open and close behavior must remain instantaneous.

## Repo conventions to follow

- The command palette owns its result-row presentation in **src/ui/CommandPalette.tsx**.
- Continue using the existing selected, hover, disabled and focus classes; do not create another result-row component.
- The Sonora design system requires keyboard navigation to be direct and menus to remain usable without hover.
- The animation audit rule for frequent keyboard navigation is to remove motion rather than add another easing.

## Steps

1. Open **src/ui/CommandPalette.tsx** at the result button around line 208.
2. Remove **transition-all duration-150** from the result-row class.
3. Preserve the selected and unselected class strings exactly.
4. Do not change activeIndex, arrow-key handling, scrollIntoView, focus management, dialog markup or palette open/close behavior.

## Boundaries

- Do NOT touch audio-engine or meter code.
- Do NOT change the command list, filtering, keyboard handlers or navigation destinations.
- Do NOT animate the palette opening or closing.
- Do NOT add dependencies.
- If the current class no longer matches the excerpt because the source has changed since commit 4293922, STOP and report the drift instead of improvising.

## Verification

- **Mechanical**: run npm run typecheck, npm test and npm run build from the repository root. All must pass.
- **Feel check**: open the palette with ⌘K on macOS or Ctrl+K on Windows/Linux. Press Arrow Down and Arrow Up rapidly at least ten times. The selected row must change immediately without a visible trailing transition.
- Hover several result rows with a mouse. Their hover state must still appear, but immediately.
- Confirm disabled project-dependent destinations remain visibly disabled.
- Confirm Enter, Escape, click selection, focus trapping and focus restoration still work.
- In DevTools' Animations panel, confirm result-row selection creates no animation.
- **Done when**: result-row visual state changes are immediate, all command-palette behavior remains intact, and the mechanical checks pass.
