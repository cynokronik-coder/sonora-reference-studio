# Resource execution log

All records below refer to the working branch `work/sonora-19-repository-transformation`.

| Date | Source repository / resource | Sonora target | Actual action | Evidence / status |
|---|---|---|---|---|
| 2026-11-24 | Existing Sonora plan 005 + UI motion system guidance | Shared Button | Removed duplicate Tailwind press transform from the shared Button class; moved press transform into `.sonora-button-motion`; restricted transitions to colour, background, border and transform, removing shadow/filter transitions | Commits `92520a6`, `f5ee8f4`; initial CI run passed |
| 2026-11-24 | Owl-Listener `accessibility-audit` / `feedback-patterns`; UI UX Pro Max accessibility/interaction rules | TopNavigation More menu | Added initial focus on open, Arrow Up/Down/Home/End navigation, Escape focus return, ARIA controls/expanded/current-state metadata, and radio semantics for interface mode | Commits `756f26b`, `3430877`; CI pending |
| 2026-11-24 | Owl-Listener `icon-system`; Awesome Design Skills `clean`; UI UX Pro Max SVG/no-emoji principle; Waza/UI and Unslop visual-consistency principles | Landing feature cards | Replaced six ad hoc Unicode feature symbols with the existing Sonora SVG `Icon` primitive and semantically matched icons | Commit `920dfe2`; CI pending |
| 2026-11-24 | Sonic Skills `audio-dsp-review`, `audio-numerics-review`, `audio-performance-debug`, `webaudio-review`, signal-flow references | Audio engine | Reviewed realtime-safety and numerical-risk guidance. No DSP changes made because no demonstrated defect or audio test environment justified touching verified paths | Safety review applied as a non-regression constraint; further code audit pending |
| 2026-11-24 | Hallmark, Unslop, Oil UI, Julian design-review, Waza UI, Open 3D site-check, Claude Skills Playwright Pro, Composio webapp-testing | Live visual QA | Inspected requirements and identified screenshot/browser automation requirements. Actual browser session not available in this execution environment | Browser QA explicitly blocked, not claimed complete |
| 2026-11-24 | Skill Seekers | Research inventory | Inspected skill-building workflow and used repository-tree enumeration to preserve provenance and counts | MCP tool itself unavailable; no MCP execution claimed |
| 2026-11-24 | CloudBase UI design skill | Design specification | Used its design-spec-before-code principle alongside Sonora's existing MASTER design system; provider-specific backend changes excluded | Methodology transfer only |
| 2026-11-24 | SwiftUI Agent Skill | React component architecture | Identified state-proximity and localized invalidation as portable ideas; native SwiftUI implementation excluded | Compatibility decision documented |

## Rules for future entries

For every next resource integration, record:
- Repository and exact skill/tool path.
- What was read or invoked.
- What was changed in Sonora.
- Files and commits.
- Tests and browser validation.
- Any incompatibility or remaining blocker.

Do not record a repository as implemented merely because it was inventoried.


| 2026-11-24 | Sonic Skills `audio-performance-debug`, `audio-dsp-review`, `audio-numerics-review` | Shared ProjectRenderer | Reused processor automation parameter maps and volume/pan scratch values; removed temporary bus-as-track objects and per-block audible callback; mutated pre-created channel-peak objects rather than allocating new ones per render block | `322b1b9`; GitHub CI run `45316617378` passed |
| 2026-11-24 | Sonic Skills + existing audio test suite | Bus automation | Added a regression test proving bus Dynamic EQ parameter automation still produces expected gain reduction and release behavior | `d19337d`; CI run `45316754885` passed |
| 2026-11-24 | Hallmark truthfulness floor; Unslop anti-pattern review | Dashboard MiniSpectrum | Changed static decorative spectrum label from `LIVE ANALYSIS` to `SPECTRUM PREVIEW` so illustrative bars are not represented as live measurements | Commit `03105b2`; CI status to be confirmed |
| 2026-11-24 | Owl-Listener `feedback-patterns`; UI UX Pro Max accessibility/feedback guidance | App toast | Added polite live-region status semantics, atomic announcement, and an explicit accessible dismiss name | Commit `f269961`; CI status to be confirmed |
| 2026-11-24 | Owl-Listener `icon-system`; Awesome Design Skills `clean`; UI UX Pro Max SVG guidance; AI Design Components assembly principle | Dashboard production cards | Replaced three Unicode workflow symbols with existing typed Sonora SVG icons | Commit `4f7c24f`; CI status to be confirmed |
| 2026-11-24 | Mercury React patterns / maintainability review | App navigation metadata | Removed unused glyph/label metadata from the route-validation array; navigation's actual presentation remains owned by TopNavigation | Commit `33b09aa`; CI status to be confirmed |


| 2026-11-24 | AI Design Skills `landing-page-design`; UI UX Pro Max touch/accessibility guidance; Awesome Design Skills `clean`; Mercury `responsive-design` | Landing page header and primary actions | Standardized primary CTA labels and raised primary/secondary action touch heights to at least 44px; increased section navigation hit areas; added a compact native disclosure navigation below 1024px that retains in-page links, Pricing, and Account while keeping Studio action visible | Commits `3d0e97a`, `b7d317c`, `45cc410`; Playwright test pending |
| 2026-11-24 | AI Business Skills pricing UX; Awesome Design Skills `clean`; UI UX Pro Max control semantics | Pricing section controls | Increased section-switch target height to 44px and added `aria-pressed` to expose active selection; no prices, plans, billing, or account behavior changed | Commit `c17f7c4`; CI passed |
| 2026-11-24 | Composio Awesome Claude Skills `webapp-testing`; Claude-Skills `playwright-pro`; Open 3D Skills `site-check` | Browser QA infrastructure | Added a separate browser-smoke workflow and Playwright script to launch Sonora using `scripts/dev.mjs`, test desktop/mobile navigation and CTA behavior, check basic overflow/touch sizes, and upload desktop/mobile screenshots | Commits `2601698`, `815fca0`, `ebb5683`, `db563a2`; first run failed before app startup because ubuntu-latest mapped to Ubuntu 26.04 unsupported by pinned Playwright; runner pinned to Ubuntu 24.04, rerun pending |

| 2026-11-24 | Composio `webapp-testing`; Claude-Skills `playwright-pro`; Sonora workspace navigation contract | Playwright smoke navigation | Corrected the smoke flow: after verifying the Studio route, the test returns to Dashboard before checking the global More menu, because the dedicated Studio workspace intentionally hides TopNavigation. Also increased contextual FlyoutMenu trigger targets to 44px on compact/touch layouts and 40px at `sm` and above, improved label/icon legibility, and narrowed its transition to colour-related properties; no audio parameters or flyout behavior changed | Commits `aa06257`, `7004c17`; Playwright rerun pending at time of update |
