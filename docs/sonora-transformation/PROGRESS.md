# Sonora transformation progress

Last updated: 2026-11-24

## Current state

- [x] Phase 0: repository and project baseline inspected.
- [ ] Phase 1: live application baseline and browser access. **Partially advanced:** the project-local Playwright CI runner now starts the app and captures screenshots, but the first interaction run exposed a test navigation-state error. The test was corrected to return to Dashboard before testing the global More menu; successful rerun is pending. No connected interactive browser tab is available in this chat.
- [x] Phase 2: all 19 recursive GitHub repository trees enumerated; file/skill/command/script counts recorded; Sonora-relevant resources inspected.
- [x] Phase 3: implementation sequence, dependencies, and validation gates documented.
- [ ] Phase 4: sequential implementation. **In progress:** implemented and tested the first-project flow (direct audio import or blank project), accessible project search, responsive landing navigation, shared touch targets, and Studio/workspace navigation. Continue through Dashboard → Studio → Reference Match → Mastering/Export screen audits.

Latest validation: Sonora CI PASS (`45435569990`); Playwright browser smoke PASS (`45435569837`). Earlier tablet-navigation run also passed (`45435177872`).
- [ ] Phase 5: final design polish. Not complete; requires rendered application review.
- [ ] Phase 6: full browser QA and regression. **Blocked** pending browser/preview access.
- [ ] Phase 7: final report. Not ready.

## Current branch

`work/sonora-19-repository-transformation`

Created from `main@44700bbb30ac1bba03140cdd656acf83c8e5a42b`.

Latest known transformation commits:
- `2807ada7264df1e9a8f230d1e3862d7589887716` — first-run Projects tour adapts to whether any project exists.
- `590c8dab1abfa135037b7685d52aabe5dcfc9478` — spotlight the import/blank-project actions in the empty state.
- `ccb85444c63dff7a52f349c2d89e2f7dce1960a1` — Playwright coverage for the first-run tour and touch target.
- `fa7a5e6f5ec0931581afa127fb23f0bd9fb13fde` — normalize the tour progress assertion; final browser smoke passes.
- `322b1b97b16ef4182f139e86861886bc1102363a` — renderer allocation reduction.
- `d19337d5966af99e84bcaa96bdfcbb475c505e99` — bus processor automation regression test.
- `03105b2312388d4534ed0256a1fc1ff4e68727dd` — truthfully label static dashboard spectrum.
- `f2699612e0699fafd89def599fdee1d5c5c1fcab` — accessible toast status and dismiss name.
- `4f7c24fa451e351d6694721b8b35cfab3756aec6` — Dashboard shared SVG icons.
- `33b09aa0d2e4d785a4df5c92f322734da9b182dc` — remove unused route glyph metadata.

## Implemented and validated

- Shared Button motion transitions only colour/background/border/transform, with press feedback centralized in CSS.
- More menu supports initial focus, Arrow Up/Down, Home/End, Escape and focus return, ARIA current destination and radio semantics for interface mode.
- Landing and Dashboard feature cards reuse the existing typed SVG icon system.
- Dashboard sample spectrum uses an honest preview label.
- Toast status is announced politely to assistive technology; dismiss control has an accessible name.
- Route-validation metadata no longer contains unused glyph/label presentation data.
- Renderer reduces avoidable per-block allocations by reusing automation parameter/value scratch and channel-peak objects, eliminating a temporary bus-as-track object and per-block audible callback.
- Added bus Dynamic EQ automation regression coverage.
- Applied Owl-Listener `onboarding-design` to the Projects first-run tour: one first-value step for empty accounts, a spotlight on Import/Create actions, and the existing management tour for returning users. Playwright verifies the step count, spotlight target, and successful finish.

CI:
- Renderer optimization `322b1b9`: PASS, run https://github.com/cynokronik-coder/sonora-reference-studio/actions/runs/45316617378
- Bus automation test `d19337d`: PASS, run https://github.com/cynokronik-coder/sonora-reference-studio/actions/runs/45316754885
- Earlier Button/navigation/landing/motion-document commits also passed CI.
- Latest project onboarding and Playwright test changes passed both CI and browser smoke; see `45435569990` and `45435569837`. No production deployment or merge was performed.
- Owl first-run tour integration: CI PASS `45439773596`; Playwright PASS `45439773410`; screenshot artifact `14942458232` (includes `projects-first-run-tour.png`).

## Additional implementation since the previous update

- Landing header now switches to a native mobile disclosure below 1024px; Pricing and Account remain available, and the Studio CTA stays visible.
- Landing primary/secondary controls and navigation hit areas meet the 44px target.
- Pricing section switches have 44px hit areas and expose selected state with `aria-pressed`.
- A project-local Playwright smoke script and separate GitHub Actions workflow have been added. First attempt failed before browser installation because the runner image was Ubuntu 26.04; workflow now pins Ubuntu 24.04 and needs a successful rerun.

## Active blockers

1. No connected browser tab / Playwright MCP session in this execution environment.
2. Render preview service `sonora-preview-pr8` follows `main`; pull-request previews are disabled in the inspected configuration.
3. No local clone/runtime is available in this session, so local npm commands and local Playwright cannot be run.
4. Open PR #79 remains untouched; it was reported as not mergeable.
5. Do not merge, deploy, or change Render settings without authorization.

## Next actions

1. Confirm CI for the latest Dashboard/App commits.
2. Continue with repository 6: `julianoczkowski/designer-skills`; use one repository at a time and record exact skill/file/test evidence.
3. Continue the source-level UI/accessibility/design audit in the absence of browser access.
4. Request a connected browser/Playwright session or authorization for a non-production preview once visual validation is the next required gate.


## Work performed in this session

- Corrected `scripts/browser-smoke.mjs` so it tests the global navigation from Dashboard rather than the dedicated Studio route, which intentionally hides the global header (`aa06257`).
- Increased `FlyoutMenu` trigger hit areas to 44px on compact/touch layouts and 40px at `sm` and above; improved trigger label/icon sizing and limited transitions to colour properties (`7004c17`).
- The regular Sonora CI passed on the earlier test-fix commit `aa06257`; the latest code/Playwright reruns must be checked before treating this batch as fully validated.
