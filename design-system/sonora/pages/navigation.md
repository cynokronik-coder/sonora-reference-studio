# Navigation — Page Rules

Use `../MASTER.md` as the global source of truth. This file defines navigation-specific behavior.

## App header

- Keep the Sonora mark and the core production destinations visually distinct from utility actions.
- The “More” menu is for secondary destinations and interface preferences, not for core production steps.
- Keep Undo / Redo controls identical in size and alignment.
- Keep account, settings, guided tour and global search reachable from the header.
- At narrow widths, preserve icon affordances and allow labels to collapse; do not let the header force the entire page wider than the viewport.

## Studio header

- Preserve the project identity and sample-rate context.
- Keep Studio, Mastering, Reference and AI Assistant one action away.
- Project actions (Tracks, Add Audio, Guided Tour, Settings, Account and Search) should remain in a predictable right-side group.
- Do not allow global page navigation to disappear when the Studio layout is active.

## Command palette

- Shortcut: `⌘K` on macOS and `Ctrl+K` on Windows/Linux.
- Search destinations by their name, task and common producer vocabulary.
- Group entries into Workspace, Production and Support.
- Use Arrow Up / Arrow Down to move and Enter to open. Escape closes.
- Project-dependent destinations should remain visible but disabled when no project is open, with the reason shown.
- Focus the search input on open, contain keyboard focus while visible, and return focus when closed.
- Clicking the backdrop or close control dismisses the palette.

## Menus and popovers

- Use a concise title and clear labels for each control.
- Outside click and Escape close the surface.
- Keep the popover anchored to its trigger and within the viewport.
- Menus must not be the only way to reach an essential action.
