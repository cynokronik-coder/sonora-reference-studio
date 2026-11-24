# Decision log

## 2026-11-24 — Use one working branch

Decision: create and use `work/sonora-19-repository-transformation` from the current `main` baseline.

Reason: the repository has many old feature branches and an open PR #79 reported as not mergeable. A single working branch avoids creating more branch/PR complexity.

Boundary: no push to main, merge, production deploy, force push, or history rewrite.

## 2026-11-24 — Do not merge PR #79

Decision: leave PR #79 untouched.

Reason: GitHub reported it as non-mergeable during inspection; its intended base/head chain is historical and is not the current main baseline. The current main already contains the merged DSP and floating-assistant consolidation required for this transformation.

## 2026-11-24 — Treat Render preview as read-only

Decision: do not change the preview service configuration.

Reason: the preview Render service currently follows main and PR previews are disabled in the inspected configuration. Changing service branch or enabling previews is an infrastructure modification and requires authorization.

## 2026-11-24 — Keep audio processing code out of the first UI passes

Decision: no DSP/audio-engine modifications.

Reason: the project uses a shared realtime/offline processing graph; no measured defect or audio test harness justified changing verified processing paths. Sonic Skills review reinforces realtime allocation, blocking, numerical correctness, worst-case performance, and signal-flow discipline.

## 2026-11-24 — Centralize shared Button motion

Decision: the shared Button's press transform belongs in `.sonora-button-motion`; only colour/background/border/transform properties are transitioned.

Reason: avoid a broad `transition: all`-style effect and avoid animating shadow/filter. Keep button dimensions, variants, semantics, and visual identity unchanged.

## 2026-11-24 — Implement expected menu keyboard behavior

Decision: the More menu supports Up/Down/Home/End, initial item focus, Escape close and focus return, plus menuitemradio semantics for interface mode.

Reason: a visible menu should work beyond mouse hover/click and should communicate the selected interface mode to assistive technology.

## 2026-11-24 — Reuse Sonora's SVG icon system

Decision: Landing feature cards use the existing `Icon` component rather than Unicode pictographs.

Reason: this preserves one icon family, known line weight, scalable SVG rendering, and consistent alignment. No new icon dependency or arbitrary external assets.

## 2026-11-24 — Do not force third-party frameworks into Sonora

Decision: external skills are used as workflows and design references; do not install entire catalogues, introduce CloudBase, introduce SwiftUI, or add 3D to the core audio UI without a demonstrated product need.

Reason: preserve maintainability, product coherence, and existing service boundaries. Large catalogues contain many unrelated SaaS integrations and some licensing differences.

## 2026-11-24 — Use responsive Playwright evidence for feature-scoped design reviews

Decision: use Sonora's project-local Playwright runner in GitHub Actions when no connected Playwright MCP or interactive browser tab is available; retain the screenshots as workflow artifacts and inspect them before recording a review as complete.

Reason: this provides real rendered browser evidence and repeatable viewport checks without adding a new runtime dependency. It is sufficient for a scoped feature review, but does not replace full product QA in a connected browser or a branch-specific Render preview.

Evidence: Projects onboarding review at 375×812, 768×1024, and 1280×800; CI `45443330760` PASS; Playwright `45443330839` PASS; artifact `14944997220`.

## 2026-11-24 — Keep first-run Projects actions to two clear choices

Decision: when no projects exist, hide the project search field and header `New project` button; show only `Import a song` and `Create blank project`. Keep search and `New project` when a project list exists.

Reason: the empty state has nothing to search, and a duplicate header creation action makes the first step less clear. The two remaining actions represent the actual supported first-project paths.

## 2026-11-24 — Place the mobile guided tour inside More navigation

Decision: hide the standalone Tour button below the `sm` breakpoint and expose `Start guided tour` as a More-menu item. Restore focus to the More trigger before opening the dialog.

Reason: at 375px the desktop header controls overlapped and the More button intercepted the Tour button. The mobile menu provides a reachable, non-overlapping entry while preserving focus restoration.
