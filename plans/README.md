# Sonora Motion Implementation Plans

**Origin audit:** PR #8 branch, `feat/sonora-command-navigation-system`  
**Origin commit:** `4293922fba50a8a8e82d62c99cf71b73097eecbe`  
**Reconciled against:** `main@44700bbb30ac1bba03140cdd656acf83c8e5a42b` and current transformation branch.

These plans were originally written from a read-only audit. Their original TODO labels were not updated when the source changes were later integrated. The current status below is based on the actual source inspected in the current repository, not on the old plan metadata.

## Plan index

| # | Plan | Severity | Source status | Validation status |
|---|---|---|---|---|
| 001 | Make command palette result selection instantaneous | HIGH | Implemented in main | CI passed; browser feel check pending |
| 002 | Render audio meter levels with transforms | MEDIUM | Implemented in main | CI passed; live audio/browser profiling pending |
| 003 | Preserve feedback while reducing motion | MEDIUM | Implemented in main | CI passed; reduced-motion browser check pending |
| 004 | Make contextual flyouts grow from their trigger | MEDIUM | Implemented in main | CI passed; viewport/interaction browser check pending |
| 005 | Replace broad button transitions with deliberate feedback | MEDIUM | Refined on transformation branch | CI passed; browser feel check pending |

## Reconciliation details

- **001:** `src/ui/CommandPalette.tsx` result rows no longer apply the old `transition-all duration-150` transition. Keyboard selection remains immediate. No palette navigation behavior was changed in this reconciliation.
- **002:** `LevelMeter` and `GainReductionMeter` use fixed-height fills with `scaleY` transforms and the shared transform transition. The AudioWorklet data path and measured values remain untouched. `MiniMeter` was left unchanged because no live call site was found in the current source search.
- **003:** Shared motion tokens, flyout/tour entrance classes, reduced-motion CSS, and reduced-motion-aware guided-tour scrolling are present in source.
- **004:** `FlyoutMenu` calculates a trigger-relative transform origin and uses the shared flyout motion class.
- **005:** On the transformation branch, shared Button press scaling is centralized in `.sonora-button-motion`; transitions are limited to colour, background, border, and transform. Shadow and filter are no longer animated by this shared class.

## Recommended next steps

1. Complete browser validation at the live/branch preview.
2. Profile level-meter animation while audio is active; do not change meter cadence or measured values.
3. Test reduced-motion behavior with the operating-system preference enabled.
4. Test flyout positioning near viewport edges and inside scroll containers.
5. Test button feedback with mouse, keyboard, and touch.

The initial button-motion CI run and later current-branch CI runs passed. CI/build success does not establish perceived motion quality or browser rendering correctness.

## Guardrails

- Keep Sonora's existing React, TypeScript, Tailwind and CSS motion system.
- Do not add an animation library to implement these plans.
- Do not modify DSP values, AudioWorklet cadence or meter data to make animation smoother.
- Respect reduced-motion preferences without removing useful state feedback.
- Do not mark browser validation as complete without actual browser screenshots and interactions.
