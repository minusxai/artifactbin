import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startDocument } from './lib/start-doc.mjs';

const base = process.argv[2] ?? 'http://localhost:12001';
const browser = await chromium.launch({ headless: true });
// This browser-test fixture replaces the vendor document only here. It performs
// a real sandboxed cross-origin fetch and popup navigation through the iframe.
async function fixture(context) {
  await context.route('https://buttons.github.io/buttons.js', route => route.fulfill({ contentType: 'application/javascript', body: `const style=document.createElement('style');style.textContent='body{background:rgb(255,255,255)}@media(prefers-color-scheme:dark){body{background:rgb(13,17,23)}}';document.head.append(style);fetch('https://api.github.com/repos/minusxai/artifactbin').then(r=>r.json()).then(d=>{const link=document.querySelector('a');const widget=document.createElement('span');widget.style.cssText='display:inline-block;width:112px;height:28px;font:12px/28px sans-serif';link.replaceWith(widget);widget.append(link);link.textContent='Star '+d.stargazers_count;link.target='_blank';link.setAttribute('aria-label',d.stargazers_count+' stargazers on GitHub')})` }));
  await context.route('https://api.github.com/repos/minusxai/artifactbin', route => route.fulfill({ headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{"stargazers_count":1234}' }));
  await context.route('https://github.com/minusxai/artifactbin', route => route.fulfill({ contentType: 'text/html', body: '<h1>Repository destination</h1>' }));
}
try {
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 } });
  await fixture(noJs);
  const plain = await noJs.newPage();
  await plain.goto(base, { waitUntil: 'domcontentloaded' });
  await plain.locator('h1').waitFor();
  assert.match(await plain.locator('h1').innerText(), /Your agents/);
  assert(await plain.getByRole('link', { name: 'Home', exact: true }).isVisible());
  await noJs.close();
  console.log('ok public heading and shared topbar without JavaScript');

  // Playwright's default forced light emulation overrides embedded inheritance.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: null });
  await fixture(context);
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
  await page.frameLocator('header [data-mx-github-star]:visible iframe').getByRole('link', { name: '1234 stargazers on GitHub' }).waitFor();
  assert.deepEqual(await page.evaluate(() => { window.__watchHome = false; return window.__homeFailures; }), []);
  const appStar = page.locator('header [data-mx-github-star]:visible');
  const appBox = await appStar.boundingBox();
  await page.waitForFunction(() => document.querySelector('header [data-mx-github-star] iframe')?.style.width === '112px');
  assert.equal((await appStar.boundingBox()).width, 112, 'slot hugs the measured vendor width, with no adjacent fallback');
  assert.equal(await page.frameLocator('header [data-mx-github-star]:visible iframe').locator('body > span').evaluate(el => el.getBoundingClientRect().top), 0, 'widget begins at frame top, without inline-body baseline clipping');
  assert(appBox.y < 44 && appBox.x > 640);
  console.log('ok uninterrupted landing through slow JS/session/home; asynchronous count in app topbar');
  await appStar.locator('iframe').evaluate(frame => { window.__starBeforeControls = frame; });
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: i % 2 === 0 ? 'Open page controls' : 'Dismiss page controls', exact: true }).click();
    assert(await appStar.locator('iframe').evaluate(frame => frame === window.__starBeforeControls && frame.style.visibility === 'visible'), 'Page Controls preserves the visible widget without a fallback flash');
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
  const widget = page.frameLocator('[data-mx-reader-rail] [data-mx-github-star]:visible iframe');
  await widget.getByRole('link', { name: '1234 stargazers on GitHub' }).waitFor();
  await star.locator('iframe').evaluate(frame => { window.__readerStar = frame; });
  await widget.locator('body').evaluate(() => { window.__vendorInstance = 'retained'; });
  const titleUpdate = await fetch(`${base}/api/artifacts/${doc.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${doc.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'mxmx_test updated star title', markup: '<h1>Star layout fixture</h1>' }),
  });
  assert(titleUpdate.ok);
  await page.getByText('mxmx_test updated star title', { exact: true }).first().waitFor();
  assert(await star.locator('iframe').evaluate(frame => frame === window.__readerStar && frame.style.visibility === 'visible'), 'live title update preserves the ready frame element');
  assert.equal(await widget.locator('body').evaluate(() => window.__vendorInstance), 'retained', 'live update also preserves the iframe document, not only its DOM element');
  const parentUrl = page.url();
  const popupPromise = page.waitForEvent('popup');
  await widget.getByRole('link').click();
  const popup = await popupPromise;
  await popup.waitForURL('https://github.com/minusxai/artifactbin');
  assert.equal(page.url(), parentUrl, 'vendor popup cannot navigate its parent');
  await popup.close();
  const widgetSrc = await star.locator('iframe').getAttribute('src');
  for (const theme of ['light', 'dark', 'light']) {
    await star.evaluate((el, theme) => el.closest('[data-mx-reader-chrome]').style.setProperty('--mx-reader-scheme', theme), theme);
    const actualScheme = await star.evaluate(el => getComputedStyle(el.closest('[data-mx-reader-chrome]')).getPropertyValue('--mx-reader-scheme').trim());
    assert.equal(await star.locator('iframe').getAttribute('src'), widgetSrc);
    assert(await star.locator('iframe').evaluate(frame => frame === window.__readerStar && frame.style.visibility === 'visible'));
    assert.equal(await star.locator('iframe').evaluate(frame => frame.style.colorScheme), actualScheme);
    const expectedBackground = actualScheme === 'dark' ? 'rgb(13, 17, 23)' : 'rgb(255, 255, 255)';
    assert(await widget.locator('body').evaluate((el, expected) => new Promise(resolve => {
      const deadline = performance.now() + 3000;
      const sample = () => getComputedStyle(el).backgroundColor === expected ? resolve(true)
        : performance.now() > deadline ? resolve(false) : requestAnimationFrame(sample);
      sample();
    }), expectedBackground), `embedded theme repaints to ${actualScheme} without reloading`);
  }
  const starBox = await star.boundingBox();
  const likeBox = await page.locator('[data-mx-reader-action="like"]:visible').boundingBox();
  const commentBox = await page.locator('[data-mx-reader-action="comment"]:visible').boundingBox();
  assert(starBox.y < 44 && starBox.x + starBox.width <= likeBox.x + 1 && likeBox.x < commentBox.x);
  assert.equal(await page.locator('[data-mx-github-star]:visible').count(), 1);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBox = await star.boundingBox();
  assert(mobileBox.y < 30 && mobileBox.x + mobileBox.width <= 390 && mobileBox.x > 200);
  assert.equal((await star.locator('iframe').boundingBox()).height, 28);
  console.log('ok anonymous drafts, Back, desktop Star/Like/Comment geometry, unchanged mobile corner');
  await context.close();

  // A gesture attempted during startup must wait for the working React control,
  // never succeed against the inert server copy and silently disappear.
  const early = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  await fixture(early);
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
  // Exercise the actual wrapper/parent handshake with fractional layout metrics,
  // independently of the host runner's display scaling or browser defaults.
  const fractional = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await fixture(fractional);
  await fractional.addInitScript(() => {
    if (location.pathname !== '/-/github-star') return;
    const measure = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      const rect = measure.call(this);
      if (this.tagName === 'SPAN' && this.parentElement === document.body) {
        return new DOMRect(rect.x, rect.y, rect.width + 0.25, 28.000002);
      }
      return rect;
    };
  });
  const zoomPage = await fractional.newPage();
  await zoomPage.goto(base, { waitUntil: 'domcontentloaded' });
  const zoomFrame = zoomPage.locator('header [data-mx-github-star]:visible iframe');
  await zoomPage.frameLocator('header [data-mx-github-star]:visible iframe').getByRole('link', { name: '1234 stargazers on GitHub' }).waitFor();
  await zoomPage.waitForFunction(() => document.querySelector('header [data-mx-github-star] iframe')?.style.width === '113px');
  assert.equal(await zoomFrame.evaluate(e => e.style.width), '113px');
  assert.equal(await zoomFrame.evaluate(e => e.style.height), '29px');
  assert.equal(await zoomFrame.evaluate(e => e.parentElement.style.height), '29px');
  await zoomPage.setViewportSize({ width: 1100, height: 750 });
  await zoomPage.reload({ waitUntil: 'domcontentloaded' });
  await zoomPage.frameLocator('header [data-mx-github-star]:visible iframe').getByRole('link', { name: '1234 stargazers on GitHub' }).waitFor();
  await zoomPage.waitForFunction(() => document.querySelector('header [data-mx-github-star] iframe')?.style.visibility === 'visible');
  assert.equal(await zoomFrame.evaluate(e => e.style.visibility), 'visible');
  await fractional.close();
  console.log('ok fractional zoom geometry survives initial load, viewport changes and reload without stuck fallback');
  const blocked = await browser.newContext();
  await blocked.route('https://buttons.github.io/buttons.js', route => route.abort());
  const failurePage = await blocked.newPage();
  const vendorFailed = failurePage.waitForEvent('requestfailed', request => request.url() === 'https://buttons.github.io/buttons.js');
  await failurePage.goto(base, { waitUntil: 'domcontentloaded' });
  await vendorFailed;
  const fallback = failurePage.getByRole('link', { name: 'Open artifactbin on GitHub (fallback link)' }).filter({ visible: true });
  await fallback.waitFor();
  assert.equal(await fallback.getAttribute('href'), 'https://github.com/minusxai/artifactbin');
  await blocked.close();
  console.log('ok sandboxed vendor fetch/popup, inherited themes, and available blocked-vendor fallback');
} finally {
  await browser.close();
}
