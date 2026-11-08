# Studio — Page Rules

Use `../MASTER.md` as the global source of truth. Studio is the precision workspace, so prioritize fast access, clarity and stable geometry.

## Header and workspace structure

- Preserve the project identity and session metadata at the top.
- Primary Studio areas are Arrangement, Mixer and Processing.
- Mastering, Reference and AI Assistant stay reachable from the Studio header.
- Add Audio, Tracks, Search, Guided Tour, Settings and Account should use consistent control sizing and accessible names.
- Do not change audio transport, project-store or processor behavior as part of a visual refactor.

## Transport and secondary tools

- Play / Stop and the time display remain prominent.
- Undo and Redo controls have matching hit areas.
- “More tools” is the secondary playback popover for loop enablement and in/out points.
- Its trigger exposes expanded state; the popover closes on outside click and Escape.
- Advanced options should remain grouped and named; do not surface every low-level value at once.

## Arrangement and mixer

- Keep track identity, mute, solo and level readable at the point of use.
- Use the current compact track surfaces for the dense timeline context, but make all primary controls keyboard-focusable.
- Keep meters and waveform content visually quiet so signal changes are easy to read.
- Avoid animated backgrounds or high-intensity gradients behind waveform and metering surfaces.

## Processing

- Clearly identify the selected target (track, bus or master).
- Show processor state and bypass status without relying on color alone.
- Put less common parameters in contextual flyouts. Preserve direct access to the main parameter and its current value.
- AI proposals are previews until the user explicitly accepts them.
