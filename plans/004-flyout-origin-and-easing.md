# 004 — Make contextual flyouts grow from their trigger

- **Status**: TODO
- **Commit**: 4293922
- **Severity**: MEDIUM
- **Category**: Physicality & origin
- **Estimated scope**: 2 files, small to medium

## Problem

The contextual flyout uses a subtle fade, downward translation and scale, but no transform origin is defined. Its scale therefore uses the browser's default center origin instead of visually connecting the panel to the control that opened it.

The current entrance in **src/index.css:238–247** is:

~~~css
@keyframes sonora-flyout-in {
  from {
    opacity: 0;
    transform: translateY(5px) scale(0.99);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
~~~

The current position state in **src/ui/FlyoutMenu.tsx:49–52** is:

~~~tsx
const [position, setPosition] = useState({ top: 0, left: 0 });
~~~

The current placement calculation in **src/ui/FlyoutMenu.tsx:103–114** computes top and left but does not compute an origin:

~~~tsx
const margin = 12;
const gap = 8;
let left = placement === 'bottom-end' ? anchor.right - panel.width : anchor.left;
left = Math.max(margin, Math.min(left, window.innerWidth - panel.width - margin));
let top = anchor.bottom + gap;
if (top + panel.height > window.innerHeight - margin) top = anchor.top - panel.height - gap;
top = Math.max(margin, Math.min(top, window.innerHeight - panel.height - margin));
setPosition({ top, left });
~~~

The floating panel is positioned in **src/ui/FlyoutMenu.tsx:155–160**:

~~~tsx
style={{ position: 'fixed', top: position.top, left: position.left }}
className={`z-[1000] ${WIDTHS[width]} rounded-2xl border border-white/[.11] bg-[rgba(20,20,37,.96)] p-4 text-left shadow-floating backdrop-blur-glass animate-[sonora-flyout-in_180ms_ease-out]`}
~~~

## Target

Keep the existing 180 ms duration and the flyout's 5 px vertical entrance distance. Use the shared --sonora-ease-out token introduced by plan 003. Make the start scale 0.97, within the 0.90–0.97 range for a restrained popover entrance.

The target keyframe is:

~~~css
@keyframes sonora-flyout-in {
  from {
    opacity: 0;
    transform: translateY(5px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
~~~

Add the normal-motion class near the existing keyframes, before the reduced-motion media override:

~~~css
.sonora-flyout-motion {
  animation: sonora-flyout-in 180ms var(--sonora-ease-out) both;
}
~~~

Track whether the panel opens below or above the trigger. Calculate a transform origin at the horizontal center of the trigger, relative to the final clamped panel position. The vertical origin is the panel's top edge when it opens below, or bottom edge when it opens above.

Use this position state shape:

~~~tsx
const [position, setPosition] = useState({
  top: 0,
  left: 0,
  transformOrigin: '0px 0px',
});
~~~

Replace the vertical placement calculation with the equivalent of:

~~~tsx
const opensBelow = anchor.bottom + gap + panel.height <= window.innerHeight - margin;
let top = opensBelow ? anchor.bottom + gap : anchor.top - panel.height - gap;
top = Math.max(margin, Math.min(top, window.innerHeight - panel.height - margin));

const originX = Math.max(0, Math.min(panel.width, anchor.left + anchor.width / 2 - left));
const originY = opensBelow ? 0 : panel.height;

setPosition({
  top,
  left,
  transformOrigin: \`\${originX}px \${originY}px\`,
});
~~~

Keep the existing horizontal placement calculation and clamping. The transform origin must be computed after left has been clamped.

The target panel style is:

~~~tsx
style={{
  position: 'fixed',
  top: position.top,
  left: position.left,
  transformOrigin: position.transformOrigin,
}}
~~~

Replace the Tailwind arbitrary animation class with sonora-flyout-motion, while retaining the sonora-flyout-surface class added by plan 003. The normal-motion class must be defined before the reduced-motion media override so the reduced-motion opacity-only animation continues to win in the cascade.

## Repo conventions to follow

- The floating panel is portalled to document.body; position and origin must be derived from the actual trigger and panel rectangles.
- placement supports bottom-start and bottom-end. Preserve both.
- The panel can flip above the trigger when there is insufficient space below it.
- Plan 003 adds the --sonora-ease-out token and reduced-motion class. Reuse that exact token; do not introduce another curve.
- Keep the existing React and CSS animation implementation. Do not add Motion, Framer Motion, GSAP or another dependency.

## Steps

1. Confirm plan 003 is implemented first, including the --sonora-ease-out token and sonora-flyout-surface class.
2. Extend the FlyoutMenu position state with transformOrigin.
3. In updatePosition, determine whether the panel fits below before clamping its final top coordinate.
4. Calculate the horizontal origin from the trigger's center relative to the clamped panel left edge. Calculate the vertical origin from the edge facing the trigger.
5. Apply the calculated origin through the panel's inline transformOrigin style.
6. Change the keyframe start scale from 0.99 to 0.97. Keep its 5 px translation and final scale of 1.
7. Define sonora-flyout-motion with a 180 ms animation using var(--sonora-ease-out) before the reduced-motion override.
8. Replace the existing arbitrary Tailwind animation class with sonora-flyout-motion; preserve sonora-flyout-surface.
9. Do not change hover-open delay, close delay, click pinning, outside-click dismissal, Escape handling or viewport clamping.

## Boundaries

- Do NOT change the GuidedTour animation in this plan.
- Do NOT change flyout contents, width variants, placement prop values or trigger behavior.
- Do NOT change the 180 ms duration or invent an overshoot/bounce.
- Do NOT add permanent will-change.
- Do NOT add dependencies.
- If the current position calculation or keyframes no longer match the excerpts because the source has changed since commit 4293922, STOP and report the drift.

## Verification

- **Mechanical**: run npm run typecheck, npm test and npm run build. All must pass.
- **Feel check**: open the Studio track-settings flyout, which uses bottom-start, and the Reference Match Advanced matching flyout, which uses bottom-end.
- Confirm the panel appears to grow from the horizontal center of its trigger, not from the center of the panel.
- Resize the viewport so the panel flips above the trigger. Confirm the origin moves to the panel's bottom edge and remains horizontally aligned to the trigger.
- Test near the left and right viewport edges to confirm clamping does not move the origin outside the panel.
- In DevTools, set animation playback to 10%. Confirm the panel starts at 0.97 scale, translates 5 px, and settles without overshoot.
- Emulate reduced motion and confirm plan 003's opacity-only animation wins.
- **Done when**: both placements use a trigger-facing origin, the menu remains within the viewport, the entrance remains restrained and the mechanical checks pass.
