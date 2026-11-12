# Sonora Motion Implementation Plans

**Audited source:** PR #8 branch, feat/sonora-command-navigation-system  
**Source commit:** 4293922fba50a8a8e82d62c99cf71b73097eecbe  
**Status:** Plans written; product source not modified.

These plans were created from the read-only motion audit and use the original improve-animations plan format. They are implementation instructions, not evidence that any fix has been applied or browser-verified.

## Plan index

| # | Plan | Severity | Status |
|---|---|---|---|
| 001 | Make command palette result selection instantaneous | HIGH | TODO |
| 002 | Render audio meter levels with transforms | MEDIUM | TODO |
| 003 | Preserve feedback while reducing motion | MEDIUM | TODO |
| 004 | Make contextual flyouts grow from their trigger | MEDIUM | TODO |
| 005 | Replace broad button transitions with deliberate feedback | MEDIUM | TODO |

## Recommended execution order

1. **001 — Command Palette**: remove the 150 ms result-row transition so keyboard navigation responds immediately.
2. **002 — Audio meters**: replace dimension animation on the live meter fills with transform scaling; verify the result in browser profiling with active audio.
3. **003 — Reduced motion**: add the shared motion tokens, retain a short opacity-only fade for the flyout and guided tour, and remove smooth scrolling when reduced motion is requested.
4. **004 — Flyout origin**: use the shared ease-out token and calculate a transform origin from the actual trigger and the panel's final position.
5. **005 — Button feedback**: reuse the tokens from plan 003 and replace the shared Button's broad transition with targeted colour and press feedback.

## Dependencies

- Plans 001 and 002 are independent.
- Plan 003 must be completed before plans 004 and 005 because it introduces the shared motion tokens and reduced-motion surface classes.
- Plans 004 and 005 are otherwise independent.
- Do not run the plans against a different source revision without first checking the cited excerpts. If a cited source has drifted, stop and reconcile the plan.

## Design and implementation guardrails

- Keep Sonora's existing React, TypeScript, Tailwind and CSS motion system. Do not migrate animation libraries.
- Use motion to explain a user action or communicate a state change. Do not add decorative scroll reveals, page-wide entrances or animation on high-frequency keyboard navigation.
- Preserve the professional dark audio-workstation visual identity and the existing component contracts.
- Keep real audio measurements authoritative. Never change DSP values, AudioWorklet cadence or meter data to make an animation look smoother.
- Respect reduced-motion preferences without making controls or state changes unclear.
- Verify performance and feel in a real browser. CI/build success alone does not establish motion quality.

## Source references

- Emil Kowalski's improve-animations audit rubric and plan template.
- UI Skills: fixing-motion-performance guidance for transform/opacity, measurement and compositor validation.
- Anthropic frontend-design guidance for purposeful, restrained, product-specific interaction.
- taste-skill motion and performance references for motion purpose, no unnecessary scroll reveals, and readable-at-rest reduced-motion behavior.

The frontend-design and taste-skill references are used as design guidance, not copied as a new visual system or landing-page template. Their page-specific constraints are not applied wholesale to Sonora's precision audio workspace.
