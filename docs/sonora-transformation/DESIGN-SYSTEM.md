# Sonora transformation design-system notes

This document supplements, not replaces, the active source of truth at `design-system/sonora/MASTER.md`.

## Product direction

Sonora should remain a focused, premium audio workstation. The default experience should communicate the next useful step without displaying every advanced parameter. Expert controls remain reachable through contextual disclosure.

## Current foundations to preserve

- Dark Sonora canvas and raised surfaces.
- Violet as the primary interactive accent, not as decoration on every surface.
- Inter for UI text and JetBrains Mono for technical values.
- Existing shared primitives in `src/ui/Primitives.tsx`.
- Existing SVG icon primitive in `src/ui/Icon.tsx`.
- Existing motion tokens and reduced-motion rules in `src/index.css`.
- Existing screen composition and navigation model.
- Existing AudioWorklet, DSP processor, realtime meter, and offline render behavior.

## Added implementation contracts

### Buttons
- Shared Button feedback is defined by `.sonora-button-motion`.
- Transitions should affect colour, background, border, and press transform only.
- Do not animate shadow, filter, width, height, margins, padding, or other layout-affecting properties without measured justification.
- Respect reduced-motion behavior.

### Menus
- More navigation uses `aria-haspopup="menu"`, `aria-expanded`, and `aria-controls`.
- Focus enters the first available menu item when opened.
- Arrow Up/Down cycles through enabled menu entries.
- Home/End move to first/last enabled entries.
- Escape closes the menu and returns focus to its trigger.
- Interface modes expose radio semantics and `aria-checked`.
- Current destination exposes `aria-current="page"`.

### Icons
- Prefer the existing typed `SonoraIconName` + `Icon` primitive.
- Keep a consistent 24-unit SVG viewBox, stroke family, semantic naming, and visual sizing.
- Do not use Unicode symbols or emoji as substitutes for interface icons.
- Do not add another icon library solely for decorative variety.

## Visual quality gates

- One coherent direction per page.
- Purposeful rather than decorative gradients.
- No unsupported feature claims or fabricated metrics.
- Clear labels and legible supporting copy.
- Empty/loading/error/success states must be designed as part of the experience.
- Small-screen behavior must be intentional, not a compressed desktop layout.
- Hover must never be the only way to reveal or operate an essential function.
- Live screenshots must be inspected before claiming visual QA is complete.
