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

  const moreButton = page.getByRole('button', { name: 'More' });
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
