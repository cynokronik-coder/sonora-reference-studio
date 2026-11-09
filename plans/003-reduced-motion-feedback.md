# 003 — Preserve feedback while reducing motion

- **Status**: TODO
- **Commit**: 4293922
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 3 files, small to medium

## Problem

Sonora has a global reduced-motion rule that collapses all animations and transitions to 0.01 ms. That removes useful fade feedback from floating menus and onboarding, rather than replacing positional movement with a gentler opacity-only change.

The current rule in **src/index.css:276–283** is:

~~~css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
~~~

The guided tour also explicitly requests smooth scrolling in **src/ui/GuidedTour.tsx:159**:

~~~tsx
if (outsideViewport) target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
~~~

An explicit JavaScript behavior: smooth request must be branched in JavaScript; the global CSS scroll-behavior declaration is not a reliable override for that explicit request.

## Target

Keep the global rule that makes non-essential transitions immediate, but preserve a short opacity-only entrance for the two floating surfaces that already have a clear purpose: the contextual flyout and the guided-tour tooltip.

Add these two motion tokens to the existing :root block in **src/index.css**:

~~~css
--sonora-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
--sonora-ease-out: cubic-bezier(0.23, 1, 0.32, 1);
~~~

Add an opacity-only reduced-motion keyframe:

~~~css
@keyframes sonora-reduced-motion-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
~~~

Add a reduced-motion override after the existing global reduced-motion rule:

~~~css
@media (prefers-reduced-motion: reduce) {
  .sonora-flyout-surface,
  .sonora-tour-surface {
    animation-name: sonora-reduced-motion-fade !important;
    animation-duration: 120ms !important;
    animation-timing-function: var(--sonora-ease-out) !important;
    animation-iteration-count: 1 !important;
  }
}
~~~

Add the class sonora-flyout-surface to the existing floating panel element in **src/ui/FlyoutMenu.tsx** and sonora-tour-surface to the existing tooltip section in **src/ui/GuidedTour.tsx**. Do not change their normal-motion keyframes in this plan; the separate flyout-origin plan handles the normal entrance.

Change the guided-tour scroll behavior to:

~~~tsx
if (outsideViewport) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
    behavior: reduceMotion ? 'auto' : 'smooth',
  });
}
~~~

The normal-motion tour may continue to scroll smoothly. Under reduced motion it must use the browser's non-smooth behavior.

## Repo conventions to follow

- The global reduced-motion rule lives in **src/index.css**.
- The flyout is rendered by **src/ui/FlyoutMenu.tsx**; its floating panel is portalled to the document body.
- The guided tour is rendered by **src/ui/GuidedTour.tsx**; its tooltip is also portalled.
- The current design system uses purposeful, restrained movement. Preserve existing normal-motion behavior and only add reduced-motion alternatives.
- The UI Skills motion-performance guidance says to use the existing animation system, not migrate libraries. The frontend-design and taste-skill references emphasize restraint, readable-at-rest content and user-triggered motion rather than decorative page-wide reveals.

## Steps

1. Add --sonora-ease and --sonora-ease-out to the existing :root token block in **src/index.css**.
2. Add sonora-reduced-motion-fade with opacity only; do not include transform, scale, blur or positional properties.
3. Add the two-surface reduced-motion override after the current global reduced-motion block, so the class-specific 120 ms fade wins over the universal 0.01 ms animation duration.
4. Add sonora-flyout-surface to the floating panel element in **src/ui/FlyoutMenu.tsx**.
5. Add sonora-tour-surface to the tooltip section in **src/ui/GuidedTour.tsx**.
6. Branch the guided-tour scrollIntoView behavior using window.matchMedia as shown above.
7. Leave all other global transition behavior unchanged in this plan.

## Boundaries

- Do NOT remove the global reduced-motion rule.
- Do NOT add page-load reveals, scroll reveals, staggered card entrances, parallax or additional motion.
- Do NOT change normal-motion flyout or tour durations, curves, geometry or state behavior.
- Do NOT change command-palette, timeline, audio transport, meter or DSP behavior.
- Do NOT use a smooth-scroll library.
- Do NOT add dependencies.
- If the current reduced-motion rule or tour scroll call no longer matches the excerpts because the source has changed since commit 4293922, STOP and report the drift.

## Verification

- **Mechanical**: run npm run typecheck, npm test and npm run build. All must pass.
- **Feel check**: in Chrome DevTools Rendering, emulate prefers-reduced-motion: reduce. Open the Studio track flyout and start the guided tour.
- Confirm both floating surfaces fade in over 120 ms without translating or scaling.
- Navigate the guided tour to a target outside the viewport. Under reduced motion it must not smoothly scroll; with reduced motion disabled it may retain the current smooth scroll.
- Confirm buttons, toggles and selected states still update and remain understandable. They should not depend on movement to communicate state.
- Confirm the rest of the app does not gain new animations under either preference.
- Test at desktop and narrow viewport sizes.
- **Done when**: reduced-motion mode has no positional entrance or smooth programmatic scrolling for these surfaces, the two surfaces retain an opacity-only fade, normal-motion behavior remains unchanged, and mechanical checks pass.
