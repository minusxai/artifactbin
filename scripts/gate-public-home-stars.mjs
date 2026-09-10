import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startDocument } from './lib/start-doc.mjs';
import { githubWidgetFixture } from './lib/github-widget-fixture.mjs';

const base = process.argv[2] ?? 'http://localhost:12001';
const browser = await chromium.launch({ headless: true });
async function readyStar(star) {
  await star.locator('[data-mx-github-count]').filter({ hasText: '1,234' }).waitFor();
  assert(await star.locator('a svg').isVisible());
  assert.equal(await star.locator('svg').getAttribute('fill'), 'currentColor');
  assert.equal(await star.locator('iframe').count(), 0);
  assert.equal(await star.locator('a').getAttribute('href'), 'https://github.com/minusxai/artifactbin');
}

try {
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 } });
  await githubWidgetFixture(noJs);
  const plain = await noJs.newPage();
  await plain.goto(base, { waitUntil: 'domcontentloaded' });
  await plain.locator('h1').waitFor();
  assert.match(await plain.locator('h1').innerText(), /Your agents/);
  assert(await plain.getByRole('link', { name: 'Home', exact: true }).isVisible());
  const plainStar = plain.locator('header [data-mx-github-star]:visible');
  assert(await plainStar.locator('a svg').isVisible(), 'GitHub icon works without JavaScript');
  assert.equal(await plainStar.locator('a').getAttribute('href'), 'https://github.com/minusxai/artifactbin');
  await noJs.close();
  console.log('ok public heading and shared topbar without JavaScript');

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: null });
  await githubWidgetFixture(context);
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
  assert(await page.getByRole('button', { name: 'Create a live document for my agent', exact: true }).first().isDisabled(), 'server presentation must not accept a Create gesture before JavaScript commits');
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
  assert(await page.getByRole('button', { name: 'Create a live document for my agent', exact: true }).first().isEnabled(), 'interactive Create becomes enabled at handoff');
  assert(await page.locator('h1').isVisible());
  assert.equal(await page.getByLabel('Loading workspace', { exact: true }).count(), 0);
  releaseData();
  await page.waitForResponse(response => response.url().includes('/api/page/home'));
  await readyStar(page.locator('header [data-mx-github-star]:visible'));
  assert.deepEqual(await page.evaluate(() => { window.__watchHome = false; return window.__homeFailures; }), []);
  const appStar = page.locator('header [data-mx-github-star]:visible');
  const appBox = await appStar.boundingBox();
  assert(appBox.width >= 28 && appBox.width < 120, 'custom icon/count fits the topbar');
  assert(appBox.y < 44 && appBox.x > 640);
  console.log('ok uninterrupted landing through slow JS/session/home; asynchronous count in app topbar');
  await appStar.locator('a').evaluate(link => { window.__starBeforeControls = link; });
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: i % 2 === 0 ? 'Open page controls' : 'Dismiss page controls', exact: true }).click();
    assert(await appStar.locator('a').evaluate(link => link === window.__starBeforeControls), 'Page Controls preserves the permanent link');
    await readyStar(appStar);
  }
  await page.goto(`${base}/privacy`, { waitUntil: 'domcontentloaded' });
  await page.locator('header [data-mx-github-star]:visible').waitFor();
  assert.equal(await page.locator('[data-mx-initial-home]').count(), 0);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.locator('h1').filter({ hasText: 'Your agents' }).waitFor();

  const doc = await startDocument(base);
  const published = await fetch(`${base}/api/artifacts/${doc.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${doc.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'mxmx_test public home stars', markup: '<h1>Star layout fixture</h1>' }),
  });
  assert(published.ok, `publish fixture: ${published.status}`);
  const adopted = await page.evaluate(async token => (await fetch('/api/session/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
  })).status, doc.token);
  assert.equal(adopted, 204);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  assert.equal(await page.locator('[data-mx-initial-home]').count(), 0);
  await page.getByText('Drafts held by this browser', { exact: false }).waitFor();
  await page.goto(`${base}/a/${doc.id}`, { waitUntil: 'domcontentloaded' });
  const star = page.locator('[data-mx-reader-rail] [data-mx-github-star]:visible');
  await star.waitFor();
  await readyStar(star);
  await star.locator('a').evaluate(link => { window.__readerStar = link; });
  const titleUpdate = await fetch(`${base}/api/artifacts/${doc.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${doc.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'mxmx_test updated star title', markup: '<h1>Star layout fixture</h1>' }),
  });
  assert(titleUpdate.ok);
  await page.getByText('mxmx_test updated star title', { exact: true }).first().waitFor();
  assert(await star.locator('a').evaluate(link => link === window.__readerStar), 'live title updates preserve the permanent link');
  await readyStar(star);
  const parentUrl = page.url();
  const popupPromise = page.waitForEvent('popup');
  await star.getByRole('link').click();
  const popup = await popupPromise;
  await popup.waitForURL('https://github.com/minusxai/artifactbin');
  assert.equal(page.url(), parentUrl, 'repository link opens a separate tab');
  await popup.close();
  for (const [theme, color] of [['light', 'rgb(17, 24, 39)'], ['dark', 'rgb(229, 231, 235)'], ['light', 'rgb(17, 24, 39)']]) {
    await star.evaluate((el, { theme, color }) => {
      const chrome = el.closest('[data-mx-reader-chrome]');
      chrome.style.setProperty('--mx-reader-scheme', theme);
      chrome.style.setProperty('--mx-reader-fg', color);
    }, { theme, color });
    assert(await star.locator('svg').evaluate((svg, expected) => new Promise(resolve => {
      const deadline = performance.now() + 3_000;
      const sample = () => getComputedStyle(svg).fill === expected ? resolve(true)
        : performance.now() > deadline ? resolve(false) : requestAnimationFrame(sample);
      sample();
    }), color), `GitHub icon inherits the ${theme} reader palette`);
    assert(await star.locator('a').evaluate(link => link === window.__readerStar), 'palette changes preserve the link');
    await readyStar(star);
  }
  const starBox = await star.boundingBox();
  const likeBox = await page.locator('[data-mx-reader-action="like"]:visible').boundingBox();
  const commentBox = await page.locator('[data-mx-reader-action="comment"]:visible').boundingBox();
  assert(starBox.y < 44 && starBox.x + starBox.width <= likeBox.x + 1 && likeBox.x < commentBox.x);
  assert.equal(await page.locator('[data-mx-github-star]:visible').count(), 1);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBox = await star.boundingBox();
  assert(mobileBox.y < 30 && mobileBox.x + mobileBox.width <= 390 && mobileBox.x > 200);
  assert.equal((await star.locator('svg').boundingBox()).height, 20);
  await readyStar(star);
  console.log('ok anonymous drafts, Back, desktop Star/Like/Comment geometry, unchanged mobile corner');
  await context.close();

  // A gesture attempted during startup must wait for the working React control,
  // never succeed against the inert server copy and silently disappear.
  const early = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  await githubWidgetFixture(early);
  const earlyPage = await early.newPage();
  let releaseEarly;
  const earlyScripts = new Promise(resolve => { releaseEarly = resolve; });
  await earlyPage.route('**/assets/*.js', async route => { await earlyScripts; await route.continue(); });
  await earlyPage.goto(base, { waitUntil: 'commit' });
  const earlyCreate = earlyPage.getByRole('button', { name: 'Create a live document for my agent', exact: true }).first();
  await earlyCreate.waitFor();
  const created = earlyPage.waitForResponse(response => response.url().endsWith('/api/start') && response.request().method() === 'POST');
  const click = earlyCreate.click();
  releaseEarly();
  await click;
  assert((await created).ok(), 'the early click reaches the actual create handler');
  await early.close();
  console.log('ok early Create gesture waits for the interactive control and creates a document');
  // A blocked metadata endpoint must not hide or replace the repository link.
  const blocked = await browser.newContext();
  await githubWidgetFixture(blocked);
  await blocked.route('**/api/external/github', route => route.abort());
  const failurePage = await blocked.newPage();
  const countFailed = failurePage.waitForEvent('requestfailed', request => request.url().endsWith('/api/external/github'));
  await failurePage.goto(base, { waitUntil: 'domcontentloaded' });
  await countFailed;
  const permanent = failurePage.locator('header [data-mx-github-star]:visible');
  assert(await permanent.locator('a svg').isVisible());
  assert.equal(await permanent.locator('a').getAttribute('href'), 'https://github.com/minusxai/artifactbin');
  assert.equal(await permanent.locator('iframe').count(), 0);
  assert(await permanent.locator('[data-mx-github-count]').isHidden());
  await blocked.close();
  console.log('ok custom SVG palette changes, permanent repository link and failed-count resilience');

} finally {
  await browser.close();
}
