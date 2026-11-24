# External repository inventory

Audit date: 2026-11-24. Default branches were discovered from GitHub metadata. Recursive Git trees were enumerated for all 19 repositories; tree responses were not truncated.

Counts below refer to files in the repository tree, `SKILL.md` files, command directories/files identified by path, and script files with common source/script extensions. A `SKILL.md` count is not necessarily identical to the README's marketing count.

| # | Repository | Default branch | Tree files | SKILL.md | Commands | Scripts | GitHub license metadata |
|---:|---|---|---:|---:|---:|---:|---|
| 1 | [ai-design-skills](https://github.com/elayadesign/ai-design-skills) | main | 17 | 2 | 0 | 2 | MIT |
| 2 | [sonic-skills](https://github.com/Gourdja/sonic-skills) | main | 67 | 18 | 0 | 0 | Unlicense |
| 3 | [designer-skills](https://github.com/Owl-Listener/designer-skills) | main | 368 | 111 | 34 | 7 | MIT |
| 4 | [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | main | 883 | 13 | 6 | 183 | MIT |
| 5 | [hallmark](https://github.com/Nutlope/hallmark) | main | 1,012 | 1 | 0 | 50 | MIT |
| 6 | [awesome-design-skills](https://github.com/bergside/awesome-design-skills) | main | 284 | 67 | 0 | 0 | MIT |
| 7 | [unslop](https://github.com/heydamir/unslop) | main | 39 | 1 | 0 | 6 | CC-BY-4.0 |
| 8 | [ai-design-components](https://github.com/ancoleman/ai-design-components) | main | 2,296 | 76 | 0 | 285 | MIT |
| 9 | [ai-business-skills](https://github.com/minhnv0807/ai-business-skills) | master | 730 | 147 | 0 | 3 | MIT |
| 10 | [designer-skills](https://github.com/julianoczkowski/designer-skills) | main | 25 | 8 | 0 | 0 | Apache-2.0 |
| 11 | [Waza](https://github.com/tw93/Waza) | main | 342 | 16 | 0 | 121 | MIT |
| 12 | [Claude-Skills](https://github.com/borghei/Claude-Skills) | main | 6,426 | 404 | 38 | 1,133 | NOASSERTION |
| 13 | [Skill_Seekers](https://github.com/yusufkaraaslan/Skill_Seekers) | development | 3,320 | 26 | 3 | 552 | MIT |
| 14 | [open-3d-skills](https://github.com/Moh4696/open-3d-skills) | main | 105 | 8 | 0 | 22 | MIT |
| 15 | [oil-ui](https://github.com/oil-oil/oil-ui) | main | 66 | 1 | 0 | 18 | MIT |
| 16 | [SwiftUI-Agent-Skill](https://github.com/AvdLee/SwiftUI-Agent-Skill) | main | 96 | 2 | 0 | 16 | MIT |
| 17 | [CloudBase-AI-Toolkit](https://github.com/TencentCloudBase/CloudBase-AI-Toolkit) | main | 3,447 | 221 | 11 | 623 | MIT |
| 18 | [mercury-agent-skills](https://github.com/cosmicstack-labs/mercury-agent-skills) | main | 317 | 137 | 0 | 4 | MIT |
| 19 | [awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | master | 2,048 | 864 | 1 | 65 | Unspecified |

## Repository-by-repository findings

### 01. AI Design Skills
- Skills: `skills/landing-page-design/SKILL.md`, `skills/figma-designer/SKILL.md`.
- The landing-page skill covers intent, audience, offer, page structure, conversion copy, typography, spacing, radius, backgrounds, icons, and motion.
- Figma workflow is useful only if a Figma workflow is available; no Figma account or MCP connection is assumed.
- Sonora use: public-facing page audit and disciplined visual decisions.

### 02. Sonic Skills
- 18 skills cover AudioUnit, CLAP, JUCE, VST3, YUP, WebAudio, DSP algorithms, numerical correctness, realtime safety, performance, signal flow, and artifacts.
- Key WebAudio/DSP resources inspected: `audio-dsp-review`, `audio-numerics-review`, `audio-performance-debug`, `audio-artifacts-debug`, `audio-signal-flow-explainer`, `webaudio-guide`, `webaudio-review`, and supporting reference files.
- WebAudio principles: avoid allocation/object churn inside AudioWorklet `process()`, avoid blocking work and main-thread audio processing, keep data flow explicit, use measured values, and profile worst-case load.
- Native plugin reviews are not direct additions to this browser application; their general realtime-safety principles remain transferable.
- Do not download/run the repository's Windows installer binaries. Markdown skill resources are sufficient for this audit.

### 03. Owl-Listener Designer Skills
- Tree contains 111 `SKILL.md` paths and 34 commands; README advertises a broader pack of 273 skills/76 commands across plugins/collections, so the counts use the enumerated branch tree.
- Focus areas include design critique/debt, design tokens, component specs, design-system governance, icon systems, motion systems, accessibility, onboarding, error handling, information architecture, responsive design, visual hierarchy, and UX writing.
- Skills inspected include `design-token`, `icon-system`, `accessibility-audit`, `onboarding-design`, `feedback-patterns`, and `design-critique`.

### 04. UI UX Pro Max
- 883 files, 13 skill paths (some packaged copies), 183 scripts.
- Main skill: `.claude/skills/ui-ux-pro-max/SKILL.md`.
- Catalogue includes 80 searchable styles, 194 product palettes/reasoning profiles, 74 font pairings, 141 UX guidelines, icon guidance, motion presets, charts, and stack-specific guidance (as stated by its README/skill).
- Priority order puts accessibility and interaction first, then performance, style selection, responsive layout, typography/color, animation, forms/feedback, navigation, and data visualization.
- Apply the existing Sonora design system rather than bringing in a second component framework.

### 05. Hallmark
- One main skill plus extensive design references, theme materials, and scripts.
- README describes hard "Floor" gates for contrast, focus, reduced motion, truthful facts, and broken phone layouts; it also separates default anti-patterns from finish-level craft.
- Use it for evidence-based visual review and avoiding fabricated capabilities.
- Screenshot and browser gates remain pending until browser access is available.

### 06. Awesome Design Skills
- 67 design-system skill files, each intended to be paired with a human-readable DESIGN.md.
- `skills/clean/SKILL.md` was inspected: minimalism, whitespace, readable typography, limited palette, semantic tokens, explicit states, empty/loading/error states, WCAG 2.2 AA, keyboard-first controls, reduced motion, and 44px+ targets.
- Do not import the registry's default blue palette into Sonora; existing Sonora brand tokens remain authoritative.

### 07. Unslop
- One Claude Code/Codex/Antigravity skill with scripts and visual references.
- Its intent is to detect generic AI aesthetics, choose a product-specific direction, and perform iterative design passes.
- License metadata is CC-BY-4.0. Do not copy assets or code without attribution and license review.
- The real screenshot-based pass is blocked by the unavailable browser.

### 08. AI Design Components
- 76 skills and 285 scripts across frontend, backend, DevOps, infrastructure, security, cloud, and AI/ML.
- `skills/assembling-components/SKILL.md` was inspected. It describes validated token integration, import wiring, and coherent React/Next.js/Python/Rust assembly after component/theming/layout stages.
- Sonora use: reuse its existing primitives, tokens, and imports; do not scaffold an alternative app or add the whole skill pack.

### 09. AI Business Skills
- 147 skills across marketing/branding/growth/pricing and business communication.
- `skills/en/17-pricing-strategy-global/SKILL.md` and `skills/en/30-design-master-global/SKILL.md` inspected.
- Pricing knowledge is useful only for assessing presentation and packaging; prices or billing behavior must not be changed without separate validation and permission.
- Image-generation skill is not a reason to add decorative imagery to Sonora.

### 10. Julianoczkowski Designer Skills
- Eight skills: brief-to-tasks, design-brief, design-flow, design-review, design-tokens, frontend-design, grill-me, information-architecture.
- `design-review/SKILL.md` explicitly requires screenshots of the running app and code/token review. It cannot be marked fully complete without rendered evidence.
- Sonora use: use a recorded brief and review criteria; browser screenshot stage remains pending.

### 11. Waza
- 16 skills, 121 scripts; README describes engineering habits such as think, check, health, hunt, learn, read, UI, and write.
- `skills/ui/SKILL.md` inspected. It demands a distinctive design point of view and screenshot-grounded evidence, not code-only claims.
- Sonora use: keep the visual direction product-specific and document the screenshot-verification gap.

### 12. Claude Skills
- 404 `SKILL.md` paths, 38 commands, 1,133 scripts. README advertises 403 skills; branch-tree count is 404.
- `engineering/playwright-pro/SKILL.md` and `product-team/design-system-lead/SKILL.md` inspected.
- Playwright Pro covers resilient locators, test structure, flaky-test diagnosis, visual regression, and accessibility gates.
- README license badge says MIT + Commons Clause while GitHub API metadata returns NOASSERTION. Treat the package as license-sensitive; inspect individual licenses before copying any code/assets.

### 13. Skill Seekers
- 26 skill paths, 552 scripts, 3 command paths.
- README describes a documentation/repository-to-skill ingestion tool with MCP integration, Python 3.10+, and a CLI.
- `skills/skill-seekers/SKILL.md` inspected; the ingestion workflow is relevant to resource provenance and building reusable knowledge packs.
- No Skill Seekers MCP server is currently connected in this execution context; do not claim its MCP tools were executed.

### 14. Open 3D Skills
- Eight skills and 22 scripts for three.js, scroll films, motion assets, alpha cutouts, frame capture, and browser checks.
- `motion-assets/SKILL.md` and `site-check/SKILL.md` inspected.
- Site-check can exercise Chromium and WebKit across desktop/tablet/mobile and capture a report; it requires a local browser/runtime.
- Sonora has no confirmed need for an immersive 3D UI, so avoid gratuitous 3D and use relevant testing principles only.

### 15. Oil UI
- One UI/UX skill, 18 helper scripts and references.
- README describes real-site/component research and a clear visual direction; it requires real screenshots for visual polish.
- `SKILL.md` inspected; it says to check the existing DESIGN.md and use concise, task-appropriate references rather than loading the entire resource tree.
- Browser verification remains pending.

### 16. SwiftUI Agent Skill
- Two skills focused on SwiftUI and SwiftUI API updates.
- `skills/swiftui-expert-skill/SKILL.md` inspected.
- SwiftUI-specific frameworks and APIs are incompatible with Sonora's React web stack. Only portable heuristics such as keeping frequently changing state close to the smallest affected subtree may be adopted.
- Do not introduce SwiftUI or Liquid Glass.

### 17. CloudBase AI Toolkit
- 221 skill paths, 11 commands, 623 scripts. It is provider-specific and integrates cloud functions, auth, databases, storage, deployment, and MCP.
- `config/.claude/skills/ui-design/SKILL.md` inspected; it requires an explicit design specification before UI implementation.
- Sonora use: produce/maintain a design specification; do not migrate Supabase/Render infrastructure to CloudBase.

### 18. Mercury Agent Skills
- 137 skill paths in the current branch tree; README advertises 132 skills/23 categories.
- `categories/frontend/react-patterns/SKILL.md` and `categories/frontend/responsive-design/SKILL.md` inspected.
- Relevant principles: component composition, state proximity, derived state instead of duplication, effects for synchronization, mobile-first layouts, intrinsic sizing, and 44px touch targets.

### 19. Composio Awesome Claude Skills
- 864 `SKILL.md` paths and 65 script paths in the enumerated tree; README describes 1,000+ production-ready skills/plugins.
- `webapp-testing/SKILL.md` and `skill-creator/SKILL.md` inspected.
- Webapp-testing describes a Playwright-based local-app workflow, server lifecycle helper, DOM reconnaissance, screenshots and browser logs.
- The collection contains many third-party SaaS automation skills unrelated to Sonora; do not install or authenticate them wholesale.
- Repository API metadata does not declare a license, while the README contains an Apache-2.0 badge. Verify each source before reuse.

## Scope and exhaustiveness note

All 19 recursive GitHub repository trees were enumerated. Skill, command, and script file counts were computed. The Sonora-relevant skill files listed above were opened and inspected. Several catalogues contain hundreds of domain-specific or third-party integration skills; unrelated integration skills were screened by path/category rather than executed or copied. No third-party binary installers were run. This is a transparent resource inventory, not a claim that every unrelated skill's entire body was read.
