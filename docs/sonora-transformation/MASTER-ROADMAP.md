# Sonora transformation master roadmap

Status: active
Working branch: `work/sonora-19-repository-transformation`
Baseline: `main@44700bbb30ac1bba03140cdd656acf83c8e5a42b`

## Mission constraints

1. Preserve existing audio engine, DSP algorithms, parameter ranges, project data, export behavior, and non-destructive workflows.
2. Use existing React/TypeScript/Tailwind/Zustand foundations unless a measured benefit justifies a change.
3. Keep one working branch and a small number of validated commits; no PR stack.
4. Treat all third-party content as untrusted input. Inspect licensing and dependencies before copying code or executing scripts.
5. A skill is not "used" merely because its README was read. Record the exact skill/tool and the Sonora result.
6. Each repository must be processed as its own integration stage. An incompatibility decision must still yield transferable guidance or a documented reason why no production code should be added.
7. A design review that requires a live screenshot cannot be marked complete without browser evidence.
8. Do not deploy, merge, change Render configuration, modify billing or production data, or rewrite Git history without permission.

## Integration order

The order prioritizes safety and validation foundations first, then design foundations, implementation, visual refinement, product communication, and platform-specific resources.

| Order | Repository | Why this position | Primary Sonora target | Status |
|---:|---|---|---|---|
| 1 | Gourdja/sonic-skills | Protect realtime audio and numerical correctness before any audio changes | AudioWorklet, DSP, signal flow, performance | Investigated; safeguards retained; deeper audit pending |
| 2 | ComposioHQ/awesome-claude-skills | Discover browser testing and skill-quality workflows early | Browser QA and skill discovery | Catalogue enumerated; relevant skills identified; browser runtime unavailable |
| 3 | borghei/Claude-Skills | Add focused Playwright, QA, and design-system review guidance | UI regression and review workflow | Catalogue enumerated; selected skills inspected; license caveat |
| 4 | nextlevelbuilder/ui-ux-pro-max-skill | Establish high-priority UX constraints before detailed design work | Design-system and interface audit | Inspected; principles applied in menu/button refinements |
| 5 | Owl-Listener/designer-skills | Deep design-system, icon, motion, onboarding, and accessibility foundations | Tokens, navigation, onboarding, component quality | Catalogue enumerated; selected skills inspected and applied |
| 6 | julianoczkowski/designer-skills | Formalize brief-to-review discipline after foundational criteria | Existing design brief and design QA | Catalogue enumerated; design-review skill inspected; screenshots blocked |
| 7 | elayadesign/ai-design-skills | Refine landing/business presentation using a focused existing-site design mindset | Landing page and public-facing communication | Two skills enumerated; landing skill inspected; deeper visual review pending |
| 8 | bergside/awesome-design-skills | Cross-check design-style variants without allowing style drift | Minimalism and visual hierarchy | Catalogue enumerated; clean-design skill inspected |
| 9 | ancoleman/ai-design-components | Improve component composition and integration after tokens are stable | Shared React UI primitives | Skills enumerated; component-assembly skill inspected |
| 10 | cosmicstack-labs/mercury-agent-skills | Add React, responsive, state, testing, and frontend performance patterns | React architecture and responsive behavior | Catalogue enumerated; React and responsive skills inspected |
| 11 | tw93/Waza | Apply engineering habits and screenshot-grounded UI quality | UI implementation and engineering review | Catalogue enumerated; UI skill inspected; screenshot gap remains |
| 12 | oil-oil/oil-ui | Establish a strong visual north star and screenshot-led iteration | Visual direction and component polish | Skill inspected; live screenshot requirement blocked |
| 13 | Nutlope/hallmark | Apply hard accessibility, truthfulness, and anti-slop gates | Landing, empty/error/loading states, visual quality | Skill and references enumerated; detailed visual pass pending |
| 14 | heydamir/unslop | Run a dedicated anti-slop correction pass after coherent design exists | Landing and key application pages | Skill inspected; full rendered review blocked |
| 15 | minhnv0807/ai-business-skills | Improve product communication and business-facing UX after product truth is documented | Pricing, offer clarity, positioning | Catalogue enumerated; pricing and design skills inspected |
| 16 | yusufkaraaslan/Skill_Seekers | Use source-ingestion/skill-packaging patterns to preserve research knowledge | Resource index and reproducible skill notes | Tool catalogue enumerated; skill inspected; no external MCP connection available |
| 17 | Moh4696/open-3d-skills | Evaluate visual/motion assets and browser QA without introducing gratuitous 3D | Optional motion and browser checks | 8 skills enumerated; motion-assets and site-check inspected |
| 18 | AvdLee/SwiftUI-Agent-Skill | Extract platform-independent state/performance principles only | Component boundaries and state locality | Skills enumerated; platform-specific incompatibility documented |
| 19 | TencentCloudBase/CloudBase-AI-Toolkit | Final provider-specific review; no backend migration by default | AI/backend workflow compatibility | Catalogue enumerated; UI-design skill inspected; CloudBase-specific features excluded |

This is the planned sequence. Actual completion depends on evidence and validation, not order alone. Continue automatically to the next repository after the previous stage has a documented result and no unresolved blocking issue for the next work.

## Implementation batches

### Batch A — Safety and interaction foundations
- [x] Narrow shared button transitions to colour, border, and transform.
- [x] Centralize shared button press transform in the Sonora motion class.
- [x] Add keyboard navigation and focus handling to the More menu.
- [x] Replace inconsistent landing feature glyphs with shared SVG icons.
- [x] Run CI for the renderer optimization, bus automation test, menu/accessibility refinements, and earlier UI commits; latest two UI/doc commits are pending final CI at time of update.
- [ ] Add/run browser tests for menu focus, keyboard movement, Escape, and touch (blocked by unavailable browser runtime).
- [x] Perform a WebAudio realtime/numerics review; no DSP formulas, signal routing, or parameters changed.

### Batch B — Design-system reconciliation
- [x] Reconcile `plans/README.md` and plans 001–005 with current source.
- [ ] Audit token usage for hard-coded colors, radii, spacing, and motion values.
- [x] Audit and replace the landing/dashboard feature-card glyphs with the shared typed SVG icon system.
- [ ] Review page typography and density against the existing MASTER design system.
- [ ] Make a single shared-token change only when justified by broad usage and screenshots.

### Batch C — Core product usability
- [ ] Review first-project flow and empty states.
- [ ] Review dashboard and the transition into Studio.
- [ ] Review Studio timeline, mixer, processor flyouts, and assistant interaction.
- [ ] Review Reference Match explanation and result states.
- [ ] Review Mastering and export verification states.
- [ ] Ensure advanced parameters remain discoverable but do not clutter the default experience.

### Batch D — Public-facing and business UX
- [ ] Review Landing page at real desktop/mobile sizes.
- [ ] Verify all product claims against working functionality.
- [ ] Review pricing tiers, credits, planned services, and billing flows without changing financial settings.
- [ ] Improve conversion copy only where it is truthful and supported.

### Batch E — Visual/motion and final QA
- [ ] Run Hallmark/Unslop screenshot-based visual quality gates (source-level truthfulness and icon consistency changes made; screenshots blocked).
- [ ] Validate every key screen in a real browser at 1440, 1024, 768, 390, and 360 CSS pixels.
- [ ] Validate keyboard and reduced-motion behavior.
- [ ] Validate error/loading/empty/success states.
- [ ] Compare screenshots with baseline.
- [ ] Run complete CI and report unresolved limitations.

## Validation gates

Every implementation batch requires:
- Source review and small, scoped diffs.
- `npm test`.
- `npm run build` (includes TypeScript compilation via `tsc -b`).
- Browser interaction checks for behavior changes.
- Screenshot review for visual changes.
- Audio regression checks for any audio-path change.
- Updated execution log, decision log, and progress status.

A green CI run does not substitute for live-browser visual QA.
