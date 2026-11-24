import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.SONORA_BASE_URL || 'http://127.0.0.1:3000';
const artifactDir = process.env.SONORA_BROWSER_ARTIFACT_DIR || 'artifacts/browser';
const server = spawn(process.execPath, ['scripts/dev.mjs'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '8787',
    SONORA_AI_HOST: '127.0.0.1',
    SONORA_AI_PORT: '8787',
  },
});

let browser;
const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];
let serverReady = false;

async function waitForServer() {
  const deadline = Date.now() + 45_000;
  let lastError;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Sonora dev server exited with code ${server.exitCode}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        serverReady = true;
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw new Error(`Sonora did not become ready at ${baseUrl}: ${String(lastError || 'timeout')}`);
}

async function checkNoHorizontalOverflow(page, width) {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert.ok(
    metrics.document <= metrics.viewport + 1,
    `Horizontal overflow at ${width}px: document=${metrics.document}px, viewport=${metrics.viewport}px`,
  );
}

try {
  await waitForServer();
  await mkdir(artifactDir, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  page.on('pageerror', (error) => pageErrors.push(error.message));
  const appOrigin = new URL(baseUrl).origin;
  page.on('console', (message) => {
    const sourceUrl = message.location().url;
    if (message.type() === 'error' && (!sourceUrl || sourceUrl.startsWith(appOrigin))) {
      consoleErrors.push(message.text());
    }
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (url.startsWith(appOrigin)) {
      failedRequests.push({ url, error: request.failure()?.errorText || 'request failed' });
    }
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.getByRole('heading', { level: 1 }).waitFor({ state: 'visible', timeout: 15_000 });
  assert.match(await page.title(), /Sonora/i);
  assert.match(await page.getByRole('heading', { level: 1 }).innerText(), /sound you/i);
  await page.locator('header').getByRole('button', { name: /Open the studio/ }).waitFor({ state: 'visible' });
  const landingBodyCopy = page.locator('#capabilities p.text-sm.leading-6').first();
  await landingBodyCopy.waitFor({ state: 'visible' });
  const landingBodyFontSize = await landingBodyCopy.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  assert.ok(landingBodyFontSize >= 14, `Landing explanatory copy is ${landingBodyFontSize}px; expected at least 14px`);
  await checkNoHorizontalOverflow(page, 1440);
  await page.screenshot({ path: `${artifactDir}/landing-desktop.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { level: 1 }).waitFor({ state: 'visible' });
  await checkNoHorizontalOverflow(page, 390);

  await page.setViewportSize({ width: 360, height: 780 });
  await checkNoHorizontalOverflow(page, 360);
  await page.screenshot({ path: `${artifactDir}/landing-mobile-360.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileMenu = page.locator('header details');
  const menuSummary = mobileMenu.locator('summary');
  await menuSummary.waitFor({ state: 'visible' });
  const menuHeight = await menuSummary.evaluate((element) => element.getBoundingClientRect().height);
  assert.ok(menuHeight >= 44, `Mobile menu target is ${menuHeight}px; expected at least 44px`);

  const studioCta = page.locator('header').getByRole('button', { name: 'Studio', exact: true });
  await studioCta.waitFor({ state: 'visible' });
  const ctaHeight = await studioCta.evaluate((element) => element.getBoundingClientRect().height);
  assert.ok(ctaHeight >= 44, `Mobile Studio CTA is ${ctaHeight}px; expected at least 44px`);
  await page.screenshot({ path: `${artifactDir}/landing-mobile-390.png`, fullPage: true });

  await menuSummary.click();
  const mobileNav = page.getByRole('navigation', { name: 'Website navigation' });
  await mobileNav.getByRole('link', { name: 'How it works' }).waitFor({ state: 'visible' });
  await mobileNav.getByRole('link', { name: 'How it works' }).click();
  assert.equal(new URL(page.url()).hash, '#workflow');
  assert.equal(await mobileMenu.getAttribute('open'), null, 'Mobile disclosure should close after in-page navigation');

  await page.evaluate(() => window.scrollTo(0, 0));
  await studioCta.click();
  await page.waitForURL('**/#studio');
  assert.equal(new URL(page.url()).hash, '#studio');

  // The dedicated Studio workspace intentionally owns its own header and hides
  // the global TopNavigation. Verify the Studio route above, then return to the
  // Dashboard at a desktop width before exercising the global "More" menu.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseUrl}#dashboard`, { waitUntil: 'domcontentloaded' });
  const primaryNavigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await primaryNavigation.waitFor({ state: 'visible' });
  const scrollableLinks = primaryNavigation.locator('.sonora-primary-nav');
  const primaryNavBounds = await scrollableLinks.boundingBox();
  const firstPrimaryLink = scrollableLinks.locator('button').first();
  const firstPrimaryLinkBounds = await firstPrimaryLink.boundingBox();
  const moreControl = primaryNavigation.getByRole('button', { name: 'More', exact: true });
  await moreControl.waitFor({ state: 'visible' });
  const moreControlBounds = await moreControl.boundingBox();
  const fullNavigationBounds = await primaryNavigation.boundingBox();
  await page.screenshot({ path: `${artifactDir}/dashboard-desktop.png`, fullPage: true });
  console.log('Primary navigation geometry:', JSON.stringify({
    viewport: await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
    header: await page.locator('header').first().boundingBox(),
    fullNavigation: fullNavigationBounds,
    scrollableLinks: primaryNavBounds,
    firstItem: firstPrimaryLinkBounds,
    moreControl: moreControlBounds,
    scrollLeft: await scrollableLinks.evaluate((element) => element.scrollLeft),
    scrollWidth: await scrollableLinks.evaluate((element) => element.scrollWidth),
    clientWidth: await scrollableLinks.evaluate((element) => element.clientWidth),
  }));
  assert.ok(primaryNavBounds && firstPrimaryLinkBounds &&
    firstPrimaryLinkBounds.x >= primaryNavBounds.x - 1 &&
    firstPrimaryLinkBounds.x + firstPrimaryLinkBounds.width <= primaryNavBounds.x + primaryNavBounds.width + 1,
    'The first primary navigation item should be fully visible inside its scroll viewport');
  assert.ok(fullNavigationBounds && moreControlBounds &&
    moreControlBounds.x >= fullNavigationBounds.x - 1 &&
    moreControlBounds.x + moreControlBounds.width <= fullNavigationBounds.x + fullNavigationBounds.width + 1,
    'The More navigation control should remain fully visible outside the scrollable links');
  await checkNoHorizontalOverflow(page, 1440);

  const moreButton = page.getByRole('button', { name: 'More', exact: true });
  await moreButton.waitFor({ state: 'visible', timeout: 15_000 });
  await moreButton.click();
  const moreMenu = page.getByRole('menu', { name: 'More workspace navigation' });
  await moreMenu.waitFor({ state: 'visible' });
  const menuItems = moreMenu.locator('[role^="menuitem"]:not(:disabled)');
  assert.ok(await menuItems.count() > 1, 'More menu should contain multiple keyboard-accessible items');
  await page.keyboard.press('ArrowDown');
  const focusedRole = await page.evaluate(() => document.activeElement?.getAttribute('role'));
  assert.ok(focusedRole?.startsWith('menuitem'), `Expected a focused menu item after ArrowDown; got ${focusedRole}`);
  await page.keyboard.press('Escape');
  await moreMenu.waitFor({ state: 'detached' });
  assert.equal(await moreButton.evaluate((element) => element === document.activeElement), true, 'Escape should restore focus to the More trigger');

  for (const width of [768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { level: 1 }).waitFor({ state: 'visible' });
    await checkNoHorizontalOverflow(page, width);
  }
  await page.getByRole('link', { name: 'Capabilities' }).waitFor({ state: 'visible' });

  // Exercise the real Studio in an isolated browser profile. The project and
  // test track are local to this CI browser context and are never uploaded.
  await page.goto(`${baseUrl}#projects`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Projects' }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'New project' }).click();
  await page.waitForURL('**/#studio');
  await page.getByRole('button', { name: 'Add audio', exact: true }).waitFor({ state: 'visible' });

  // A new Studio session should prioritize the arrangement, while keeping the assistant one click away.
  const assistantToggle = page.getByRole('button', { name: 'AI Assistant', exact: true });
  await assistantToggle.waitFor({ state: 'visible' });
  assert.equal(await assistantToggle.getAttribute('aria-pressed'), 'false',
    'The AI Assistant should start collapsed in a new Studio session');
  const assistantIntro = page.locator('aside').getByRole('heading', { name: 'What would you like to improve?', exact: true });
  assert.equal(await assistantIntro.count(), 0, 'The assistant panel should not cover the initial workspace');
  await assistantToggle.click();
  await assistantIntro.waitFor({ state: 'visible' });
  assert.equal(await assistantToggle.getAttribute('aria-pressed'), 'true',
    'The AI Assistant should open when explicitly requested');

  const floatingAssistantTitle = page.locator('[data-assistant-drag-handle] .whitespace-nowrap').first();
  await floatingAssistantTitle.waitFor({ state: 'visible' });
  assert.equal(await floatingAssistantTitle.textContent(), 'Sonora AI',
    'The compact floating assistant should retain its full product name');
  assert.equal(
    await floatingAssistantTitle.evaluate((element) => element.scrollWidth > element.clientWidth),
    false,
    'The floating assistant title should not be visually clipped',
  );
  await page.screenshot({ path: `${artifactDir}/studio-assistant-header.png`, fullPage: true });

  await assistantToggle.click();
  await assistantIntro.waitFor({ state: 'detached' });
  assert.equal(await assistantToggle.getAttribute('aria-pressed'), 'false',
    'The AI Assistant should close again on request');
  await page.screenshot({ path: `${artifactDir}/studio-empty-project.png`, fullPage: true });

  // The transport popover must move focus inside on open and restore it on Escape.
  const transportTools = page.getByRole('button', { name: /More tools/ });
  await transportTools.click();
  const transportDialog = page.getByRole('dialog', { name: 'More playback tools' });
  await transportDialog.waitFor({ state: 'visible' });
  assert.equal(
    await transportDialog.evaluate((element) => element.contains(document.activeElement)),
    true,
    'Opening playback tools should move focus inside the popover',
  );
  await page.keyboard.press('Escape');
  await transportDialog.waitFor({ state: 'detached' });
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-controls') === 'transport-more-tools',
    undefined,
    { timeout: 3_000 },
  );
  assert.equal(
    await transportTools.evaluate((element) => element === document.activeElement),
    true,
    'Escape should return focus to the playback-tools trigger',
  );

  // Add a harmless, empty audio track so the contextual track-settings flyout
  // becomes available; no source audio or DSP parameters are changed.
  await page.getByRole('button', { name: 'Add audio', exact: true }).click();
  const addDialog = page.getByRole('dialog', { name: 'Add to session' });
  await addDialog.waitFor({ state: 'visible' });
  await addDialog.getByRole('button', { name: '＋ Track' }).click();
  const tracksDialog = page.getByRole('dialog', { name: 'Session tracks' });
  await tracksDialog.waitFor({ state: 'visible' });
  await tracksDialog.getByRole('button', { name: 'Close' }).click();
  await tracksDialog.waitFor({ state: 'detached' });

  const trackSettingsTrigger = page.locator('[data-tour="studio-tracks"] button[aria-haspopup="dialog"]').first();
  await trackSettingsTrigger.waitFor({ state: 'visible' });
  const trackSettingsSize = await trackSettingsTrigger.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  });
  assert.ok(trackSettingsSize.height >= 40, `Desktop track settings target is ${trackSettingsSize.height}px; expected at least 40px`);
  assert.ok(trackSettingsSize.width >= 40, `Desktop track settings target is ${trackSettingsSize.width}px; expected at least 40px`);

  await trackSettingsTrigger.click();
  const trackSettingsDialog = page.getByRole('dialog', { name: /settings$/ });
  await trackSettingsDialog.waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => {
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
        .find((element) => /settings$/i.test(element.getAttribute('aria-label') ?? ''));
      return Boolean(dialog && dialog.contains(document.activeElement));
    },
    undefined,
    { timeout: 3_000 },
  );
  assert.equal(
    await trackSettingsDialog.evaluate((element) => element.contains(document.activeElement)),
    true,
    'Opening track settings should move focus into the contextual flyout',
  );

  const polaritySwitch = trackSettingsDialog.getByRole('switch', { name: 'Invert polarity' });
  const switchBounds = await polaritySwitch.boundingBox();
  assert.ok(switchBounds && switchBounds.width >= 44 && switchBounds.height >= 44,
    `Track toggle hit area is ${switchBounds?.width ?? 0}×${switchBounds?.height ?? 0}px; expected at least 44×44px`);
  const initialPolarity = await polaritySwitch.getAttribute('aria-checked');
  await polaritySwitch.click();
  assert.notEqual(await polaritySwitch.getAttribute('aria-checked'), initialPolarity,
    'Activating a switch should update its aria-checked state');
  await polaritySwitch.click();
  assert.equal(await polaritySwitch.getAttribute('aria-checked'), initialPolarity,
    'The isolated test track switch should be reversible');

  await page.keyboard.press('Escape');
  await trackSettingsDialog.waitFor({ state: 'detached' });
  assert.equal(
    await trackSettingsTrigger.evaluate((element) => element === document.activeElement),
    true,
    'Escape should return focus to the track settings trigger',
  );

  await page.screenshot({ path: `${artifactDir}/studio-track-settings.png`, fullPage: true });

  // Reference Match uses the shared HelpTip control. Verify the larger target
  // and the non-modal dialog's keyboard focus lifecycle on a real product page.
  await page.goto(`${baseUrl}#reference`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Reference Match', exact: true, level: 1 }).waitFor({ state: 'visible' });
  const referenceHeader = page.locator('main header').filter({
    has: page.getByRole('heading', { name: 'Reference Match', exact: true, level: 1 }),
  });
  const helpTrigger = referenceHeader.getByRole('button', { name: 'Explain this' });
  await helpTrigger.waitFor({ state: 'visible' });
  await page.screenshot({ path: `${artifactDir}/reference-match.png`, fullPage: true });
  const helpBounds = await helpTrigger.boundingBox();
  assert.ok(helpBounds && helpBounds.width >= 36 && helpBounds.height >= 36,
    `Help trigger is ${helpBounds?.width ?? 0}×${helpBounds?.height ?? 0}px; expected at least 36×36px on desktop`);
  const helpControlId = await helpTrigger.getAttribute('aria-controls');
  await helpTrigger.click();
  const helpDialog = page.getByRole('dialog', { name: 'What is reference matching?' });
  await helpDialog.waitFor({ state: 'visible' });
  await page.screenshot({ path: `${artifactDir}/reference-help.png`, fullPage: true });
  await page.waitForFunction(
    () => {
      const dialog = document.querySelector('[role="dialog"][aria-label="What is reference matching?"]');
      return Boolean(dialog && dialog.contains(document.activeElement));
    },
    undefined,
    { timeout: 3_000 },
  );
  assert.equal(await helpDialog.evaluate((element) => element.contains(document.activeElement)), true,
    'Opening a HelpTip should move focus into its explanation');
  await page.keyboard.press('Escape');
  await helpDialog.waitFor({ state: 'detached' });
  await page.waitForFunction(
    (controlId) => document.activeElement?.getAttribute('aria-controls') === controlId,
    helpControlId,
    { timeout: 3_000 },
  );
  assert.equal(await helpTrigger.evaluate((element) => element === document.activeElement), true,
    'Escape should return focus to the HelpTip trigger');

  // Capture the remaining core product screens at a consistent desktop width.
  // These checks catch route-level rendering errors and horizontal overflow.
  const screenAudit = [
    { route: 'mastering', heading: 'Mastering', artifact: 'mastering-desktop.png' },
    { route: 'analysis', heading: 'Audio analysis', artifact: 'analysis-desktop.png' },
    { route: 'export', heading: 'Export', artifact: 'export-desktop.png' },
    { route: 'settings', heading: 'Settings', artifact: 'settings-desktop.png' },
    { route: 'projects', heading: 'Projects', artifact: 'projects-desktop.png' },
  ];
  for (const item of screenAudit) {
    await page.goto(`${baseUrl}#${item.route}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: item.heading, exact: true, level: 1 }).waitFor({ state: 'visible' });
    await checkNoHorizontalOverflow(page, 1440);
    await page.screenshot({ path: `${artifactDir}/${item.artifact}`, fullPage: true });
  }

  // Exercise pointer:coarse sizing at a tablet-width viewport. This catches
  // breakpoint-only sizing that accidentally shrinks controls on touch tablets.
  const touchPage = await browser.newPage({
    viewport: { width: 1024, height: 900 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  assert.equal(
    await touchPage.evaluate(() => window.matchMedia('(pointer: coarse)').matches),
    true,
    'Touch test context should expose a coarse pointer',
  );
  await touchPage.goto(`${baseUrl}#projects`, { waitUntil: 'domcontentloaded' });
  await touchPage.getByRole('heading', { name: 'Projects' }).waitFor({ state: 'visible' });
  await touchPage.getByRole('button', { name: 'New project' }).click();
  await touchPage.waitForURL('**/#studio');
  await touchPage.getByRole('button', { name: 'Add audio', exact: true }).click();
  const touchAddDialog = touchPage.getByRole('dialog', { name: 'Add to session' });
  await touchAddDialog.waitFor({ state: 'visible' });
  await touchAddDialog.getByRole('button', { name: '＋ Track' }).click();
  const touchTracksDialog = touchPage.getByRole('dialog', { name: 'Session tracks' });
  await touchTracksDialog.waitFor({ state: 'visible' });
  await touchTracksDialog.getByRole('button', { name: 'Close' }).click();
  await touchTracksDialog.waitFor({ state: 'detached' });
  const touchTrackSettings = touchPage.locator('[data-tour="studio-tracks"] button[aria-haspopup="dialog"]').first();
  await touchTrackSettings.waitFor({ state: 'visible' });
  const touchTrackSettingsSize = await touchTrackSettings.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  });
  assert.ok(touchTrackSettingsSize.height >= 44,
    `Touch tablet track-settings target is ${touchTrackSettingsSize.height}px; expected at least 44px`);
  assert.ok(touchTrackSettingsSize.width >= 44,
    `Touch tablet track-settings target is ${touchTrackSettingsSize.width}px; expected at least 44px`);
  await touchPage.screenshot({ path: `${artifactDir}/studio-touch-tablet.png`, fullPage: true });
  await touchPage.close();

  assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join('; ')}`);
  assert.deepEqual(consoleErrors, [], `Browser console errors: ${consoleErrors.join('; ')}`);
  assert.deepEqual(failedRequests, [], `Failed browser requests: ${JSON.stringify(failedRequests)}`);

  console.log('Sonora browser smoke checks passed.');
  console.log('Screenshots: landing-desktop.png, landing-mobile-390.png');
} finally {
  if (browser) await browser.close();
  if (serverReady && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      delay(5_000),
    ]);
    if (server.exitCode === null) server.kill('SIGKILL');
  } else if (server.exitCode === null) {
    server.kill('SIGTERM');
  }
}
