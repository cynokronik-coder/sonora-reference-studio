# Design Review: Projects First-Run Onboarding

**Reviewed against:** [`DESIGN_BRIEF.md`](./DESIGN_BRIEF.md) and the active product design system at `design-system/sonora/MASTER.md`  
**Philosophy:** Dark studio minimalism — restrained surfaces, clear actions, violet primary emphasis  
**Date:** 2026-11-24  
**Scope:** Projects empty state, mobile navigation entry, and first-run guided tour

## Screenshots Captured

| Screenshot | Breakpoint | Description |
|---|---|---|
| `screenshots/review-projects-empty-mobile-375.png` | Mobile (375×812) | Empty Projects state with the two primary actions |
| `screenshots/review-projects-tour-mobile-375.png` | Mobile (375×812) | One-step tour positioned above the highlighted actions |
| `screenshots/review-projects-empty-tablet-768.png` | Tablet (768×1024) | Empty state with horizontally arranged actions |
| `screenshots/review-projects-tour-tablet-768.png` | Tablet (768×1024) | Tour below the target with clear separation |
| `screenshots/review-projects-empty-desktop-1280.png` | Desktop (1280×800) | Empty state with two choices and no redundant header controls |
| `screenshots/review-projects-tour-desktop-1280.png` | Desktop (1280×800) | Desktop guided-tour spotlight and dialog |

> Captured from the running app by the project-local Playwright runner in [GitHub Actions run 45443330839](https://github.com/cynokronik-coder/sonora-reference-studio/actions/runs/45443330839). [Download/view the screenshot artifact](https://github.com/cynokronik-coder/sonora-reference-studio/actions/runs/45443330839/artifacts/14944997220). The artifact retains the six files for 90 days; screenshots are not committed as binary files.

## Summary

The Projects empty state now presents one clear first decision: import a song or create a blank project. The tour remains focused and non-blocking, and its target and dialog adapt to mobile, tablet, and desktop. The review found and fixed mobile overlap, duplicate empty-state actions, and undersized dismissal controls.

## Must Fix

1. **Mobile tour dialog overlapped the highlighted actions — fixed.** The old fixed 190px height estimate placed the dialog over the CTA on a 375px viewport. Positioning now uses the rendered dialog height. See `screenshots/review-projects-tour-mobile-375.png`.
2. **Mobile Tour trigger was intercepted by More navigation — fixed.** The standalone trigger is hidden below the small breakpoint; a `Start guided tour` menu item is provided inside More, with focus restored to the More trigger when the tour closes.
3. **Empty Projects header duplicated the first-project actions — fixed.** Search and the header `New project` button are hidden until a project exists. The empty state exposes only `Import a song` and `Create blank project`.

## Should Fix

1. **Dismissal controls were too small and visually faint — fixed.** Close is now at least 40×40px; Skip is at least 44px high. Both have visible focus treatment and stronger text contrast. Playwright checks the dimensions and mobile focus restoration.

## Could Improve

1. Keep the one-step first-run tour concise. Do not add more steps unless they explain a new first-value action; the existing returning-user management tour should remain separate.
2. Revisit the overall Projects screen only when the dashboard-to-Studio review is performed; this review does not claim that the entire application has passed responsive QA.

## What Works Well

- The empty state presents two distinct, understandable choices.
- The primary import action has clear visual priority.
- The action layout stacks on mobile and sits side-by-side on tablet/desktop.
- The tour spotlight keeps both actions visible and operable at all three reviewed widths.
- The mobile More-menu entry avoids header overlap and preserves keyboard focus.
- Existing Sonora colors, typography, rounded surfaces, shared Button component, and icon system are retained.
- No horizontal overflow was detected at 375px, 768px, or 1280px.

## Validation

- Sonora CI: [PASS — run 45443330760](https://github.com/cynokronik-coder/sonora-reference-studio/actions/runs/45443330760) (unit tests, API syntax checks, production build/TypeScript).
- Playwright browser smoke: [PASS — run 45443330839](https://github.com/cynokronik-coder/sonora-reference-studio/actions/runs/45443330839).
- Responsive screenshot matrix: six captures at 375×812, 768×1024, and 1280×800; all six inspected.
- Interaction checks: mobile tour opens from More; Finish closes it; focus returns to More; Close/Skip targets meet minimum sizes; empty state does not expose search or duplicate New project.
- Audio engine, DSP, project data model, import implementation, and export behavior were not changed.

## Limitations

This is a feature-scoped design review, not a full-product browser audit. The connected interactive browser and branch-specific Render preview are still unavailable. The screenshot images are retained in the linked GitHub Actions artifact for 90 days rather than committed to Git.
