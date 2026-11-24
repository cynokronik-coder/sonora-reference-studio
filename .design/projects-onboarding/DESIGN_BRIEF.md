# Design Brief — Projects First-Run Onboarding

**Status:** Derived review brief  
**Source of truth:** `design-system/sonora/MASTER.md`  
**Review scope:** Projects empty state and its guided first-run tour

## Product goal

Help a self-producing artist take the first meaningful step in Sonora without learning the full workstation first. From an empty Projects workspace, the user should immediately understand that they can either import a song to improve or create a blank project and add audio later.

## Audience and context

- First-time Sonora users who may not know the app's full mixing/mastering workflow.
- Returning users who already have one or more local projects.
- Audio files and projects remain local to the current browser profile unless the product explicitly says otherwise.

## Experience requirements

1. Keep the first-run tour to one focused step while no projects exist.
2. Spotlight the two real first actions: `Import a song` and `Create blank project`.
3. Do not show session-management guidance until a project exists.
4. Preserve the existing returning-user project tour.
5. Keep the tour dismissible and keyboard operable; restore focus after closing.
6. Avoid obscuring the highlighted actions or making the overlay itself the primary visual focus.
7. Verify the empty state and tour at 375×812, 768×1024, and 1280×800.

## Visual direction

Use the active Sonora design system: dark studio minimalism, restrained glass surfaces, crisp technical detail, Inter for UI text, and violet for primary interaction emphasis. Preserve the existing application shell, shared primitives, colors, typography, and spacing system. Do not add a second UI framework or decorative visual language.

## Constraints and non-goals

- Do not change audio-engine behavior, DSP parameters, project persistence, import behavior, or export behavior.
- Do not introduce new dependencies.
- Do not add automatic tour popups or block access to the workspace.
- Do not claim that importing, analysis, matching, or mastering has occurred before the corresponding operation succeeds.

## Review acceptance criteria

- The first-run step is visible and understandable at all three required widths.
- Both first-project actions are within the spotlight and remain operable.
- No horizontal overflow or clipped dialog at the required widths.
- The tour can be finished or skipped without trapping focus.
- The existing project-management tour remains intact for returning users.
