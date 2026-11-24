# Browser and visual QA report

Date: 2026-11-24

## Required target

Preferred existing preview URL: https://sonora-preview-pr8.onrender.com

The Render service is currently configured to track `main`. The main service is https://sonora-vpwo.onrender.com. No service settings were changed.

## Browser tool availability

- No connected browser tabs were returned by the available browser integration.
- No Playwright MCP server or browser execution surface was available to this session.
- The preview URL was not accessible through the available web/browser context.
- The repository could be inspected through GitHub, but it could not be cloned into a local runtime for direct Playwright installation/execution.

## What was and was not tested

| Check | Result |
|---|---|
| GitHub source tree inspection | Complete for main branch paths used in the audit |
| Existing CI workflow | Inspected |
| Initial button-motion unit tests/build | Passed via GitHub Actions |
| Latest More-menu commits | CI pending at report creation |
| Latest landing icon commit | CI pending at report creation |
| Live desktop screenshot | Not performed |
| Live tablet/mobile screenshots | Not performed |
| Playwright interaction tests | Not performed |
| Browser console/network inspection | Not performed |
| Safari/WebKit visual check | Not performed |

## Access required to complete the visual phase

Provide one of:
1. A connected browser session with Sonora's preview already open and accessible to the assistant, or
2. A locally running Codespace/Claude Code environment with the repository checked out and Playwright installed/available, or
3. Authorization to enable an appropriate non-production branch preview in Render or another existing preview provider.

Do not change Render settings or deploy from this branch without approval.

When access is available, capture screenshots at 1440, 1280, 1024, 768, 390, and 360 CSS pixels, then test:
- More menu open/focus, arrow keys, Home/End, Escape, outside click, and touch.
- Command palette search, keyboard selection, disabled destinations, Escape, and focus restoration.
- Flyout positioning, click pinning, viewport clamping, outside-click, and Escape.
- Guided tour, reduced-motion behavior, and small screens.
- Landing header/navigation/CTA, feature cards, FAQ, and responsive layout.
- Project import, Reference Match, Studio playback, Mastering, Render, and Export without modifying audio processing behavior.

Save screenshots and update this report with actual results; do not infer browser results from CI.


## Additional implementation awaiting browser validation

Since the report was first created, the working branch also includes:
- More-menu keyboard/focus handling.
- Dashboard/landing SVG icon normalization.
- Toast polite live-region semantics and a named dismiss button.
- Dashboard static-spectrum truthfulness label.
- Shared button motion refinement.

These changes have passed GitHub CI except for the newest small App/Dashboard commits, whose runs were still in progress when this report was updated. They have not been visually inspected in a browser. Keep the rendered screenshot and keyboard/touch checks open.


## Automated Playwright smoke harness added

- `scripts/browser-smoke.mjs` starts the actual development entrypoint `scripts/dev.mjs`, then checks the landing page at desktop/mobile widths, title and hero content, no horizontal overflow, mobile target heights, disclosure navigation, in-page anchor navigation, and the Studio route action.
- `.github/workflows/browser-smoke.yml` installs Playwright in the CI runner only (not in Sonora's production dependencies), installs Chromium, executes the smoke script, and uploads desktop/mobile screenshots as a short-lived artifact.
- The first attempt failed during Playwright browser installation because `ubuntu-latest` was resolved to Ubuntu 26.04, which Playwright 1.56.1 did not support. The workflow has been pinned to `ubuntu-24.04`; this rerun is pending. No application assertion ran in the first attempt.
- The harness initially tests only the public landing route and responsive header interactions. It does not yet represent full audio Studio/Reference/Master/Export e2e coverage.


## Follow-up: Studio/global navigation test-flow correction

The initial Playwright run on `9ce54db` failed because the script expected the global `More` navigation button after navigating to `#studio`. This is not a missing control: `TopNavigation` intentionally returns `null` in the dedicated Studio workspace, which has its own workspace header. The test now returns to `#dashboard` at 1440px, confirms primary navigation is visible, captures a dashboard screenshot, and then exercises More-menu keyboard behavior. The corrected script returns to Dashboard before exercising the global More menu. Tablet smoke uses a touch-enabled browser context and enters `#dashboard` before opening More → Projects. The Dashboard heading is not hard-coded in the test; the accessible primary-navigation landmark is used as the route-ready assertion. The tablet run passed (`45435177872`). The latest full browser smoke including the Projects empty-state actions passed (`45435569837`), and the corresponding production build/unit-test CI passed (`45435569990`). Screenshots are captured by CI, but this does not equal a manual visual review of the Render preview. No production deployment or merge was performed.
