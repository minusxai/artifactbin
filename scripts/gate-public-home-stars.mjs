import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startDocument } from './lib/start-doc.mjs';
import { githubWidgetFixture } from './lib/github-widget-fixture.mjs';

const base = process.argv[2] ?? 'http://localhost:12001';
const browser = await chromium.launch({ headless: true });
const workshop = page => page.getByRole('region', { name: 'The artifactbin workshop', exact: true });
const createAction = page => workshop(page).getByRole('button', { name: 'Create Artifact — copy agent instructions', exact: true });
async function readyStar(star) {
  await star.locator('[data-mx-github-count]').filter({ hasText: '1,234' }).waitFor();
  assert(await star.locator('a svg').isVisible());
  assert(await star.getByText('Star', { exact: true }).isVisible());
  assert.equal(await star.locator('svg').getAttribute('fill'), 'light-dark(#eac54f, #e3b341)');
  assert.equal(await star.locator('iframe').count(), 0);
  assert.equal(await star.locator('a').getAttribute('href'), 'https://github.com/minusxai/artifactbin');
}

try {
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 } });
  await githubWidgetFixture(noJs);
  const plain = await noJs.newPage();
  await plain.goto(base, { waitUntil: 'domcontentloaded' });
  const heading = workshop(plain).getByRole('heading', { level: 1 });
  await heading.waitFor();
  assert((await heading.innerText()).trim().length > 0, 'public hero has a readable heading');
  const firstPaint = await plain.locator('.workshop-page').evaluate(el => ({
    background: getComputedStyle(el).backgroundColor,
    headingSize: parseFloat(getComputedStyle(el.querySelector('h1')).fontSize),
    stylesheets: document.head.querySelectorAll('link[rel="stylesheet"]').length,
  }));
  assert(firstPaint.stylesheets > 0, 'initial HTML discovers render-blocking CSS without JavaScript');
  assert.equal(firstPaint.background, 'rgb(250, 247, 240)', 'landing has its paper background before JavaScript');
  assert(firstPaint.headingSize > 40, 'hero typography is applied before JavaScript');
  assert(await plain.locator('header').getByRole('link', { name: 'artifactbin home', exact: true }).isVisible());
  const plainStar = plain.locator('header [data-mx-github-star]:visible');
  assert(await plainStar.locator('a svg').isVisible(), 'GitHub icon works without JavaScript');
  assert.equal(await plainStar.locator('a').getAttribute('href'), 'https://github.com/minusxai/artifactbin');
  await noJs.close();
  console.log('ok public heading and shared topbar without JavaScript');

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: null });
  await githubWidgetFixture(context);
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on('pageerror', error => console.error('public home page error:', error.message));
  // One deliberately slow poster must not delay ready robots or the live canvas.
  let releasePoster;
  const poster = new Promise(resolve => { releasePoster = resolve; });
  const posterPixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4GQAAAAASUVORK5CYII=', 'base64');
  await page.route('**/landing/posters/*.webp', async route => {
    if (route.request().url().endsWith('/YPLu0U.webp')) await poster;
    await route.fulfill({ contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: posterPixel });
  });
  let releaseScripts;
  const scripts = new Promise(resolve => { releaseScripts = resolve; });
  let releaseData;
  const data = new Promise(resolve => { releaseData = resolve; });
  await page.route('**/assets/*.js', async route => { await scripts; await route.continue(); });
  await page.route('**/api/page/**', async route => { await data; await route.continue(); });
  await page.goto(base, { waitUntil: 'commit' });
  await page.locator('[data-mx-initial-home] h1').waitFor();
  assert(await page.locator('[data-mx-initial-home] h1').isVisible());
  assert(await createAction(page).isDisabled(), 'server presentation must not accept a Create gesture before JavaScript commits');
  // Observe rendered frames across both the JS and data release boundaries.
  await page.evaluate(() => {
    const heading = document.querySelector('[aria-label="The artifactbin workshop"] h1').textContent;
    window.__homeFailures = [];
    window.__watchHome = true;
    const sample = () => {
      if (!window.__watchHome) return;
      const visible = [...document.querySelectorAll('[aria-label="The artifactbin workshop"] h1')].some(el => el.textContent === heading && el.getBoundingClientRect().height > 0);
      if (!visible) window.__homeFailures.push('heading disappeared');
      const landing = document.querySelector('.workshop-page');
      if (landing && getComputedStyle(landing).backgroundColor !== 'rgb(250, 247, 240)') window.__homeFailures.push('landing lost its styles');
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  releaseScripts();
  await page.locator('[data-mx-initial-home]').waitFor({ state: 'detached' });
  try {
    assert(await createAction(page).isEnabled(), 'interactive Create becomes enabled at handoff');
  } catch (error) {
    console.error('handoff state:', await page.evaluate(() => ({
      url: location.pathname,
      text: document.body.innerText.slice(0, 1200),
      initial: !!document.querySelector('[data-mx-initial-home]'),
      roots: document.querySelectorAll('#root').length,
      regions: [...document.querySelectorAll('[aria-label="The artifactbin workshop"]')].map(el => ({
        text: el.textContent.slice(0, 200), display: getComputedStyle(el).display,
        hidden: el.closest('[aria-hidden="true"], [hidden], [inert]')?.outerHTML.slice(0, 300),
      })),
    })));
    throw error;
  }
  await page.locator('.workshop-canvas[data-ready="true"]').waitFor();
  releasePoster();
  console.log('ok live scene appears while a poster request is still held');
  assert(await page.locator('h1').isVisible());
  assert.equal(await page.getByLabel('Loading workspace', { exact: true }).count(), 0);
  releaseData();
  await page.waitForResponse(response => response.url().includes('/api/page/home'));
  await readyStar(page.locator('header [data-mx-github-star]:visible'));
  assert.deepEqual(await page.evaluate(() => { window.__watchHome = false; return window.__homeFailures; }), []);
  const appStar = page.locator('header [data-mx-github-star]:visible');
  const appBox = await appStar.boundingBox();
  assert(appBox.width >= 28 && appBox.width < 140, `Star button/count fits the topbar (${appBox.width}px)`);
  const controlsBox = await page.getByRole('button', { name: 'Open page controls', exact: true }).boundingBox();
  assert(appBox.x + appBox.width <= controlsBox.x, 'Star button leaves page controls unobstructed');
  assert(appBox.y < 44 && appBox.x > 640);
  const galleryBox = await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'Gallery', exact: true }).boundingBox();
  assert(appBox.x + appBox.width <= galleryBox.x, 'desktop Star precedes Gallery and Docs');
  for (const width of [320, 390, 640, 800]) {
    await page.setViewportSize({ width, height: 844 });
    const mobileStar = page.locator('header [data-mx-github-star]:visible');
    assert.equal(await mobileStar.count(), 1, 'mobile navigation retains one Star link');
    const box = await mobileStar.boundingBox();
    const menu = await page.getByRole('button', { name: 'Open navigation menu', exact: true }).boundingBox();
    const brand = await page.locator('header').getByRole('link', { name: 'artifactbin home', exact: true }).boundingBox();
    assert(brand.x + brand.width <= box.x && box.x + box.width <= menu.x && menu.x + menu.width <= width, `mobile Star fits between brand and menu at ${width}px`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  console.log('ok uninterrupted landing through slow JS/session/home; asynchronous count in app topbar');
  await appStar.locator('a').evaluate(link => { window.__starBeforeControls = link; });
  for (let i = 0; i < 4; i++) {
    const action = i % 2 === 0 ? 'Open page controls' : 'Dismiss page controls';
    console.log(`page controls: ${action}`);
    await page.getByRole('button', { name: action, exact: true }).click();
    assert(await appStar.locator('a').evaluate(link => link === window.__starBeforeControls), 'Page Controls preserves the permanent link');
    await readyStar(appStar);
  }
  console.log('ok repeated page controls preserve the Star link');
  await page.goto(`${base}/privacy`, { waitUntil: 'domcontentloaded' });
  await page.locator('header [data-mx-github-star]:visible').waitFor();
  assert.equal(await page.locator('[data-mx-initial-home]').count(), 0);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await workshop(page).getByRole('heading', { level: 1 }).waitFor();

  console.log('ok privacy navigation and Back');
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
  console.log('ok anonymous drafts after adopting a connection');
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
  console.log('ok live reader title update preserves the Star link');
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
    assert(await star.locator('svg').evaluate((svg, { color, theme }) => new Promise(resolve => {
      const deadline = performance.now() + 3_000;
      const sample = () => getComputedStyle(svg).fill === (theme === 'dark' ? 'rgb(227, 179, 65)' : 'rgb(234, 197, 79)') && getComputedStyle(svg.closest('a')).color === color ? resolve(true)
        : performance.now() > deadline ? resolve(false) : requestAnimationFrame(sample);
      sample();
    }), { color, theme }), `GitHub star stays yellow while its label inherits the ${theme} reader palette`);
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
  const earlyCreate = createAction(earlyPage);
  await earlyCreate.waitFor();
  let starts = 0;
  earlyPage.on('request', request => { if (new URL(request.url()).pathname === '/api/start' && request.method() === 'POST') starts++; });
  const click = earlyCreate.click();
  releaseEarly();
  await click;
  await earlyPage.waitForFunction(origin => navigator.clipboard.readText().then(text => text.includes(`${origin}/docs-human`)), new URL(base).origin);
  assert.equal(starts, 0, 'the workshop copies setup instructions without creating a document');
  await early.close();
  console.log('ok early Create gesture waits for the interactive control and copies setup instructions');
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
