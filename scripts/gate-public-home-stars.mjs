import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startDocument, becomeOwner } from './lib/start-doc.mjs';

const base = process.argv[2] ?? 'http://localhost:12001';
const browser = await chromium.launch({ headless: true });
try {
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 } });
  const plain = await noJs.newPage();
  await plain.goto(base);
  assert.match(await plain.locator('h1').innerText(), /Your agents/);
  assert(await plain.getByRole('link', { name: 'Home', exact: true }).isVisible());
  await noJs.close();
  console.log('ok public heading and shared topbar without JavaScript');

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  let releaseScripts;
  const scripts = new Promise(resolve => { releaseScripts = resolve; });
  let releaseData;
  const data = new Promise(resolve => { releaseData = resolve; });
  await page.route('**/assets/*.js', async route => { await scripts; await route.continue(); });
  await page.route('**/api/page/**', async route => { await data; await route.continue(); });
  await page.goto(base, { waitUntil: 'commit' });
  await page.locator('[data-mx-initial-home] h1').waitFor();
  assert(await page.locator('[data-mx-initial-home] h1').isVisible());
  // Observe rendered frames across both the JS and data release boundaries.
  await page.evaluate(() => {
    window.__homeFailures = [];
    window.__watchHome = true;
    const sample = () => {
      if (!window.__watchHome) return;
      const visible = [...document.querySelectorAll('h1')].some(el => el.textContent.includes('Your agents') && el.getBoundingClientRect().height > 0);
      if (!visible) window.__homeFailures.push('heading disappeared');
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  releaseScripts();
  await page.locator('[data-mx-initial-home]').waitFor({ state: 'detached' });
  assert(await page.locator('h1').isVisible());
  assert.equal(await page.getByLabel('Loading workspace', { exact: true }).count(), 0);
  releaseData();
  await page.waitForResponse(response => response.url().includes('/api/page/home'));
  await page.getByRole('link', { name: /1,234 stars/ }).filter({ visible: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => { window.__watchHome = false; return window.__homeFailures; }), []);
  const appStar = page.locator('header [data-mx-github-star]:visible');
  const appBox = await appStar.boundingBox();
  assert(appBox.y < 44 && appBox.x > 640);
  console.log('ok uninterrupted landing through slow JS/session/home; asynchronous count in app topbar');
  await page.goto(`${base}/privacy`);
  await page.locator('header [data-mx-github-star]:visible').waitFor();
  assert.equal(await page.locator('[data-mx-initial-home]').count(), 0);
  await page.goBack();
  await page.locator('h1').filter({ hasText: 'Your agents' }).waitFor();

  const doc = await startDocument(base);
  const published = await fetch(`${base}/api/artifacts/${doc.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${doc.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'mxmx_test public home stars', markup: '<h1>Star layout fixture</h1>' }),
  });
  assert(published.ok, `publish fixture: ${published.status}`);
  await becomeOwner(page, base, doc.token);
  await page.goto(base);
  assert.equal(await page.locator('[data-mx-initial-home]').count(), 0);
  await page.getByText('Drafts held by this browser', { exact: false }).waitFor();
  await page.goto(`${base}/a/${doc.id}`);
  const star = page.locator('[data-mx-reader-rail] [data-mx-github-star]:visible');
  await star.waitFor();
  await page.getByRole('link', { name: /1,234 stars/ }).filter({ visible: true }).waitFor();
  const starBox = await star.boundingBox();
  const likeBox = await page.locator('[data-mx-reader-action="like"]:visible').boundingBox();
  const commentBox = await page.locator('[data-mx-reader-action="comment"]:visible').boundingBox();
  assert(starBox.y < 44 && starBox.x + starBox.width <= likeBox.x + 1 && likeBox.x < commentBox.x);
  assert.equal(await page.locator('[data-mx-github-star]:visible').count(), 1);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBox = await star.boundingBox();
  assert(mobileBox.y < 30 && mobileBox.x + mobileBox.width <= 390 && mobileBox.x > 200);
  assert.equal(await star.locator('[data-mx-github-count]').isVisible(), false);
  console.log('ok anonymous drafts, Back, desktop Star/Like/Comment geometry, unchanged mobile corner');
  await context.close();
} finally {
  await browser.close();
}
