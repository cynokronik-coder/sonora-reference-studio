# Sonora baseline audit

Audit date: 2026-11-24
Baseline branch: `main`
Baseline commit: `44700bbb30ac1bba03140cdd656acf83c8e5a42b`
Working branch: `work/sonora-19-repository-transformation`

## Product and architecture

Sonora is an existing React 18 + TypeScript + Vite + Tailwind application. It includes a browser-based audio production workflow, reference matching, an audio analysis pipeline, an AudioWorklet engine, offline rendering, processor chains, project persistence, and export.

Architecture observations from `README.md`, `ARCHITECTURE.md`, `AUDIO_ENGINE.md`, `DEVELOPMENT.md`, `TESTING.md`, and the current source tree:

- React 18.3, TypeScript 5.7, Vite 6, Tailwind CSS 3, Zustand 5.
- Shared DSP implementation is used for realtime playback and offline rendering.
- AudioWorklet is used for realtime processing; workers handle analysis and related background tasks.
- Zustand and IndexedDB hold application/project state.
- Existing primary experiences include Landing, Dashboard, Projects, Studio, Reference Match, Mastering, Presets, Analysis, Export, Account, Plans, Learn, and Settings.
- Existing shared UI primitives live in `src/ui/Primitives.tsx`; the icon primitive lives in `src/ui/Icon.tsx`.
- Existing interaction components include `CommandPalette`, `FlyoutMenu`, `GuidedTour`, and `TopNavigation`.
- Existing design-system documentation is in `design-system/sonora/MASTER.md` and page-specific design notes.

## Existing strengths retained

- The application already has a coherent dark audio-workstation direction, semantic color tokens, Inter and JetBrains Mono typography, shared UI primitives, and a custom SVG icon system.
- The Studio and Mastering experiences contain real audio controls and processing paths; UI work must not replace them with static representations.
- The command palette already supports searchable navigation and keyboard selection.
- Contextual flyouts already support hover discovery, click pinning, portals, viewport positioning, outside-click dismissal, and Escape.
- The guided tour already contains workspace-specific steps and reduced-motion-aware scrolling.
- Audio meters already use transform-based fills for the primary level and gain-reduction meters.
- The existing design system explicitly requires progressive disclosure, non-destructive source audio handling, truthful analysis labels, visible focus, reduced-motion support, and accessible controls.

## Initial issues and opportunities

1. Shared button motion still transitioned `box-shadow` and `filter`, despite the existing motion plan calling for deliberate colour and transform feedback only.
2. The shared Button primitive duplicated press scaling in a Tailwind utility instead of keeping all shared button motion in one CSS contract.
3. The global More navigation menu exposed basic menu roles but did not implement expected Up/Down/Home/End keyboard movement, initial focus, or predictable focus return after Escape.
4. Landing feature cards used six unrelated Unicode symbols despite an existing SVG icon system.
5. The five existing motion plans under `plans/` were marked TODO even though plans 001–004 are already reflected in current source, and plan 005 was partially implemented. The status record needs reconciliation with evidence.
6. Browser-level visual QA is required before meaningful layout or aesthetic decisions can be considered complete.

## Git and pull-request state

- Default branch is `main`.
- Open PR #79 is titled "preview: combine latest DSP upgrades with floating assistant UI". GitHub reported it as not mergeable at inspection time. It is not being merged or modified in this mission.
- Several historical feature/integration branches exist. This mission uses one new working branch and avoids creating a PR stack.
- Current working branch: `work/sonora-19-repository-transformation`.
- The working branch was created from the baseline `main` commit above.

## Render and browser access

Discovered Render services:

- Preview service: `https://sonora-preview-pr8.onrender.com`, currently configured to follow `main`.
- Main service: `https://sonora-vpwo.onrender.com`, configured to follow `main`.

The preview service does not currently provide a branch-specific preview for this working branch. Pull-request previews are disabled in the Render configuration observed during this audit. No Render setting or production service has been changed.

A connected browser session was not available to this execution environment, and the preview URL could not be opened through the available browser/web context. Therefore:

- No live-browser screenshot is claimed.
- No Playwright run against the live preview is claimed.
- No visual regression result is claimed.
- Browser QA remains an explicit blocker requiring an attached browser/Playwright session or an authorized branch preview.

## First implementation checkpoints

- Button motion was centralized and narrowed to purposeful colour/border/transform transitions. Commit: `f5ee8f4108dd177f716f1f81b63dabdec3a2083a`.
- The More menu gained keyboard navigation and focus handling. Commits: `756f26be6d03c7bc40dac8b36343d6cf09ab4fe7`, `343087751628eeb444322ec6c9adb6148b2f1e58`.
- Landing feature badges now use Sonora's shared SVG icon component. Commit: `920dfe2822322e4fc9784ffc4718628bb6b4f617`.

Automated CI passed for the initial button-motion change. Later commits are awaiting their own CI results as of the latest progress update.
