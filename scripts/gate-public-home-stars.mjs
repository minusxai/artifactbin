import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startDocument } from './lib/start-doc.mjs';

const base = process.argv[2] ?? 'http://localhost:12001';
const browser = await chromium.launch({ headless: true });
// This browser-test fixture replaces the vendor document only here. It performs
// a real sandboxed cross-origin fetch and popup navigation through the iframe.
async function fixture(context) {
  await context.route(/^https:\/\/buttons\.github\.io\/buttons\.html(?:\?|$)/, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>body{margin:0}a{color:CanvasText;background:Canvas;display:inline-block;height:28px}</style><a href="https://github.com/minusxai/artifactbin" target="_blank" rel="noopener">Star <span></span></a><script>const scheme=new URLSearchParams(location.hash.slice(1)).get('data-color-scheme');document.documentElement.style.colorScheme=scheme;document.body.style.backgroundColor=scheme==='dark'?'rgb(13,17,23)':'rgb(255,255,255)';fetch('https://api.github.com/repos/minusxai/artifactbin').then(r=>r.json()).then(d=>{document.querySelector('span').textContent=d.stargazers_count;document.querySelector('a').setAttribute('aria-label',d.stargazers_count+' stargazers on GitHub')})</script>` }));
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

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
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
  assert(appBox.y < 44 && appBox.x > 640);
  console.log('ok uninterrupted landing through slow JS/session/home; asynchronous count in app topbar');
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
  const parentUrl = page.url();
  const popupPromise = page.waitForEvent('popup');
  await widget.getByRole('link').click();
  const popup = await popupPromise;
  await popup.waitForURL('https://github.com/minusxai/artifactbin');
  assert.equal(page.url(), parentUrl, 'vendor popup cannot navigate its parent');
  await popup.close();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
    const actualScheme = await star.evaluate(el => getComputedStyle(el.closest('[data-mx-reader-chrome]')).getPropertyValue('--mx-reader-scheme').trim());
    assert.equal(new URLSearchParams(new URL(await star.locator('iframe').getAttribute('src')).hash.slice(1)).get('data-color-scheme'), actualScheme);
    assert.equal(await widget.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), actualScheme === 'dark' ? 'rgb(13, 17, 23)' : 'rgb(255, 255, 255)');
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
  const blocked = await browser.newContext();
  await blocked.route(/^https:\/\/buttons\.github\.io\/buttons\.html(?:\?|$)/, route => route.abort());
  const failurePage = await blocked.newPage();
  await failurePage.goto(base, { waitUntil: 'domcontentloaded' });
  const fallback = failurePage.getByRole('link', { name: 'Open artifactbin on GitHub (fallback link)' }).filter({ visible: true });
  await fallback.waitFor();
  assert.equal(await fallback.getAttribute('href'), 'https://github.com/minusxai/artifactbin');
  await blocked.close();
  console.log('ok sandboxed vendor fetch/popup, inherited themes, and available blocked-vendor fallback');
} finally {
  await browser.close();
}
