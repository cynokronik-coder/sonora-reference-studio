# 005 — Replace broad button transitions with deliberate feedback

- **Status**: TODO
- **Commit**: 4293922
- **Severity**: MEDIUM
- **Category**: Easing & duration
- **Estimated scope**: 2 files, small

## Problem

The shared Button primitive applies transition-all duration-180 to every button and scales to 0.985 while pressed. This is broader and slower than the intended button feedback: it can transition properties that were not meant to animate, and the press response should be a defined transform transition with the recommended 160 ms maximum.

The current base class in **src/ui/Primitives.tsx:57–59** is:

~~~tsx
const base =
  'inline-flex items-center justify-center gap-2 rounded-control border font-semibold tracking-[.005em] transition-all duration-180 focus-ring disabled:cursor-not-allowed disabled:opacity-40 active:scale-[.985]';
~~~

## Target

Replace the broad transition with a named Sonora button-motion class. Reuse the two tokens introduced by plan 003.

The target base class is:

~~~tsx
const base =
  'inline-flex items-center justify-center gap-2 rounded-control border font-semibold tracking-[.005em] sonora-button-motion focus-ring disabled:cursor-not-allowed disabled:opacity-40';
~~~

Add this CSS near the shared motion rules in **src/index.css**, before the reduced-motion media query:

~~~css
.sonora-button-motion {
  transition:
    color 150ms var(--sonora-ease),
    background-color 150ms var(--sonora-ease),
    border-color 150ms var(--sonora-ease),
    transform 160ms var(--sonora-ease-out);
}

.sonora-button-motion:active {
  transform: scale(0.97);
}
~~~

The 150 ms colour transitions follow the hover timing budget. The press transform uses 160 ms and scale 0.97. Do not transition box-shadow, filter, width, height, margin or padding.

Under reduced motion, remove the press transform while leaving the button's colour and state changes available. Add this rule inside the existing reduced-motion media query:

~~~css
.sonora-button-motion:active {
  transform: none !important;
}
~~~

The global reduced-motion rule already collapses transition durations; keep it intact.

## Repo conventions to follow

- **src/ui/Primitives.tsx** owns the shared Button primitive and the existing primary, secondary, ghost and danger variants.
- **src/index.css** owns the Sonora root tokens and shared CSS motion rules.
- Plan 003 introduces --sonora-ease as cubic-bezier(0.2, 0.8, 0.2, 1) and --sonora-ease-out as cubic-bezier(0.23, 1, 0.32, 1). Reuse these exact values; do not define duplicates.
- Keep the current variant classes and focus-ring class. This plan changes feedback mechanics, not visual identity.

## Steps

1. Confirm plan 003 is implemented first and both motion tokens exist in the :root block.
2. Replace transition-all duration-180 active:scale-[.985] in the shared Button base class with sonora-button-motion.
3. Add the .sonora-button-motion rule shown above to **src/index.css**.
4. Add the reduced-motion :active override inside the existing prefers-reduced-motion block.
5. Keep primary/secondary/ghost/danger styles, sizes, disabled state and all button props unchanged.
6. Do not remove focus-ring; focus indication must remain immediate and visible.

## Boundaries

- Do NOT change IconButton, Toggle, Select, ParamSlider, TabBar or other primitives in this plan.
- Do NOT change button copy, dimensions, variants, shadows, gradients or component API.
- Do NOT add transitions to additional controls.
- Do NOT add dependencies.
- If the Button base class or root reduced-motion rule no longer matches the excerpts because the source has changed since commit 4293922, STOP and report the drift.

## Verification

- **Mechanical**: run npm run typecheck, npm test and npm run build. All must pass.
- **Feel check**: test primary, secondary, ghost and danger Button variants with mouse, keyboard and touch emulation.
- Hover should change text, background and border colours over 150 ms without animating size or layout.
- Press should scale to 0.97 and return smoothly within 160 ms, with no bounce or overshoot.
- Confirm disabled buttons do not press or animate.
- Confirm focus rings remain visible and immediate.
- Emulate prefers-reduced-motion: reduce: the button must not scale while pressed, but its state colours must still change.
- In DevTools, inspect computed transition properties. There must be no transition-property: all, and no size, spacing or shadow transition.
- **Done when**: the shared Button has deliberate colour and press feedback, all variants remain visually consistent, reduced motion removes the press movement, and the mechanical checks pass.
