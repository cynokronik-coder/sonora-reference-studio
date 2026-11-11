# Sonora Reference Studio — Design System

**Status:** Active product UI source of truth  
**Product type:** Reference-matched audio production workspace  
**Implementation:** React 18, TypeScript, Tailwind CSS 3, existing Sonora primitives

## Product experience

Sonora should feel like a focused professional audio workstation: calm, precise, premium and reassuring. A new artist should understand the next useful action without having to learn the entire signal chain. An experienced producer should be able to reach detailed controls quickly without the default workspace becoming crowded.

The interface must support this sequence:

1. Import a mix or stems.
2. Add and analyze a sonic reference.
3. Review and edit the proposed processing.
4. Mix and master while monitoring the actual audio.
5. Render, verify and export.

The UI must never imply that a reference recording is copied, that AI changes have been applied before acceptance, or that a render was verified before the audio pipeline has completed it.

## Existing stack and architecture rules

- Keep React + TypeScript + Tailwind CSS as the UI foundation.
- Reuse `src/ui/Primitives.tsx`, `src/ui/Icon.tsx`, the existing store and current screen components.
- Prefer small, typed, reusable components over adding a second component framework.
- Do not add a UI dependency simply to reproduce a visual effect.
- Keep application state and audio-engine behavior in their existing modules; presentation components must not bypass the store or audio model.
- Reuse semantic Tailwind colors and CSS variables before introducing new raw color values.
- Keep screen-specific exceptions in `pages/`; the rules here are global.

## Visual direction

**Style:** Dark studio minimalism with restrained glass surfaces and crisp technical detail. Use violet as the primary interaction accent, not as a decorative gradient on every surface.

| Role | Token | Value |
|---|---|---|
| Canvas | `sonora.canvas` | `#090914` |
| App background | `sonora.background` | `#0D0D1B` |
| Surface | `sonora.surface` | `#11111F` |
| Raised surface | `sonora.raised` | `#171727` |
| Interactive surface | `sonora.interactive` | `#252538` |
| Border | `sonora.border` | `#303047` |
| Primary violet | `sonora.violet` | `#8957FF` |
| Deep violet | `sonora.purple` | `#7545EA` |
| Bright violet | `sonora.lavender` | `#A77AFF` |
| Highlight | `sonora.pale` | `#C4A2FF` |
| Success | `sonora.lime` | `#8EDB75` |
| Warning | `sonora.amber` | `#E6AD3D` |
| Danger | `signal.red` | `#EF686D` |

Use white text for primary labels, `ink-300` for secondary copy and `ink-400/500` for supporting metadata. Muted text must remain readable at normal display brightness; do not use low-contrast grey for essential instructions.

## Typography and density

- Primary font: Inter. Technical values: JetBrains Mono.
- Page titles: 24–32 px, with a clear hierarchy and restrained tracking.
- Section titles: 16–20 px.
- Body copy: 14–16 px, line-height 1.5–1.7.
- Form labels and tool descriptions: normally 12–14 px; never use tiny labels for critical controls.
- dB, LUFS, sample-rate, timecode and parameter values should use tabular or monospaced numerals.
- Dashboard and account surfaces use comfortable spacing. Mixer, timeline and rack surfaces may be denser, but controls still need clear names, focus states and adequate hit targets.

## Layout, shape and surfaces

- Outer application frame: retain the rounded, inset application shell and generous screen margins.
- Main panels: 22 px radius. Cards: 17–20 px. Controls: 12–14 px.
- Prefer subtle one-pixel borders, restrained inset highlights and one consistent elevation shadow.
- Use translucent surfaces only for floating menus, search palettes and overlays where separation from the workspace is useful.
- Avoid heavy blur or large translucent panels over waveforms, meters, transport controls or other precision work areas.
- Keep the primary workflow visible; move secondary/advanced parameters into contextual flyouts or expandable sections.

## Interaction standards

- Primary buttons: obvious hierarchy, clear verb, minimum 44 px touch height.
- Icon-only buttons: minimum 40 × 40 px, an accessible name and a useful tooltip.
- Every interactive control needs visible hover, focus-visible, active and disabled states.
- Disabled destinations must explain what prerequisite is missing (for example, “Open a project first”).
- Menus and popovers close on outside click and Escape. Their triggers expose `aria-expanded` and the appropriate `aria-haspopup`.
- Dialogs must move focus inside when opened, contain Tab navigation, close on Escape and return focus to the invoking control.
- Every action must have a real handler; never ship a decorative button that looks actionable.
- Use short transitions around 150–220 ms. Respect `prefers-reduced-motion`.
- Avoid hover-only essential actions; all tools must remain usable by keyboard and touch.

## Navigation model

- Global app navigation: Dashboard, Projects, Studio, Reference, Mastering and the secondary “More” menu.
- Studio navigation: Arrangement, Mixer, Processing and the project-level actions.
- A global command palette is the fast route finder. It must work from both the main app and Studio, be searchable, keyboard navigable and announce disabled project-dependent destinations.
- Preserve clear active-screen states. Keep account, settings and help reachable without burying them inside nested menus.
- Do not create a second competing sidebar or duplicate all primary links in every screen.

## Audio-product UX rules

- Separate beginner-friendly defaults from advanced parameters; do not remove access to expert controls.
- Label units on every technical control and show current values beside sliders.
- Explain what a control changes when the label is not self-evident.
- Keep destructive actions explicit and reversible where possible.
- Distinguish analysis results, AI suggestions, applied settings and rendered output.
- Preserve original source audio and communicate when a process is non-destructive.
- Never invent quality scores, readiness or verification statuses.

## Accessibility and responsive QA

- Keyboard: Tab/Shift+Tab, Enter/Space, Escape, arrow-key navigation where applicable.
- Contrast: normal text should meet WCAG AA targets; focus rings must be visible on dark surfaces.
- Screen sizes: inspect approximately 375 px, 768 px, 1024 px and 1440 px widths.
- Check that menus stay within the viewport and do not obscure the only path to close them.
- Confirm that reduced-motion preferences are respected and no action depends only on color.

## Inspiration sources and adaptation

- UI UX Pro Max: use its design-system-first workflow, UX guidelines and anti-pattern checks. Apply those principles to this existing React/Tailwind system rather than installing a separate runtime UI framework.
- 21st.dev Community Components: use its React component collection as an interaction and composition reference, especially for navigation menus, search, popovers, dashboards, onboarding, dialogs, sliders, toasts and timelines.
- Sonora components must be adapted to the app's existing state model, audio workflows, accessibility requirements and performance needs. Do not copy a community component's branding, assets or implementation wholesale.

## Release checklist

- [ ] Existing workflow and audio-engine behavior remain unchanged.
- [ ] Navigation destinations all resolve to the intended screens.
- [ ] Primary actions work by mouse, keyboard and touch.
- [ ] Popovers and dialogs dismiss correctly and manage focus.
- [ ] Disabled states explain their prerequisite.
- [ ] No horizontal overflow at 375 px / 768 px / 1024 px / 1440 px.
- [ ] Text and control contrast remain legible.
- [ ] Reduced-motion mode is respected.
- [ ] Build, typecheck and tests pass.
- [ ] Browser QA is performed separately from automated CI.
