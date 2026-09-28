/** Compiled reader handover: served story survives adoption and yields to editing. */
import { createChecker } from './lib/assert.mjs';
import { fixtureFetch as fetch } from './lib/fixture-http.mjs';
import { chromium } from 'playwright';
import { becomeAccountOwner, publishAs } from './lib/start-doc.mjs';
import { startMailSink } from './lib/mail-login.mjs';
import { publishPageSpeedFixtures } from './fixtures/page-speed/index.mjs';
import { githubWidgetFixture } from './lib/github-widget-fixture.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('hydration');
const browser = await chromium.launch();
const waitFor = async (page, expr, ms = 20000) => {
  for (const deadline = Date.now() + ms; Date.now() < deadline;) {
    if (await page.evaluate(expr)) return true;
    await page.waitForTimeout(100);
  }
  return false;
};

const READER_HEADER = 'x-mx-reader';

/**
 * The compiled page as served: its story root (a body child, no wrapper) and every element in it,
 * captured at DOMContentLoaded, before the app can have run — and every script the page fetches.
 */
const COMPILED_PROBE = () => {
  const state = (window.__compiledTakeover = { story: null, served: [] });
  document.addEventListener('DOMContentLoaded', () => {
    const story = document.querySelector('body > [data-mx-inline-story]');
    if (!story) return;
    state.story = story;
    state.served = [...story.querySelectorAll('*')];
  });
};
const COMPILED_VERDICT = () => {
  const { story, served } = window.__compiledTakeover ?? { story: null, served: [] };
  const root = document.getElementById('root');
  return {
    captured: !!story, served: served.length,
    adopted: !!story && !!root && !root.hidden && root.contains(story),
    same: !!story && document.querySelector('#root [data-mx-inline-story]') === story,
    lost: story ? served.filter((n) => !story.contains(n)).length : -1,
    reactOwned: story ? [story, ...served].filter((n) => Object.keys(n).some((k) => k.startsWith('__reactFiber$'))).length : -1,
    mode: story?.__mxIslands?.mode?.() ?? null,
    servedChrome: !!document.querySelector('body > [data-mx-reader-chrome]'),
    appRoot: !!root,
  };
};

/** Serve `path` until it answers compiled (the compile is off the write path), or say what it answered. */
async function compiledServed(path) {
  let served = null;
  for (const end = Date.now() + 30000; Date.now() < end;) {
    served = (await fetch(`${B}${path}`, { headers: { accept: 'text/html' } })).headers.get(READER_HEADER);
    if (served === 'compiled') return 'compiled';
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return served ?? 'absent';
}

async function runCompiledTakeover({ ownerContext, ownerPage, anonymous, kit }) {
  const kitPath = `/a/${kit.id}`;
  const served = await compiledServed(kitPath);
  if (served !== 'compiled') {
    check(false, `compiled takeover: expected the compiled page (${READER_HEADER}: ${served})`);
    return;
  }
  const open = async (context, path) => {
    const page = await context.newPage();
    const errors = [];
    const scripts = [];
    page.on('pageerror', (e) => errors.push(`page error: ${String(e).slice(0, 300)}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.text().slice(0, 300)} (${m.location().url})`); });
    page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(new URL(r.url()).pathname); });
    await page.addInitScript(COMPILED_PROBE);
    const response = await page.goto(`${B}${path}`, { waitUntil: 'load', timeout: 90000 });
    return { page, errors, scripts, served: response?.headers()[READER_HEADER] ?? 'absent' };
  };
  const judge = (label, verdict, errors) => {
    check(verdict.captured && verdict.served > 0, `${label}: the compiled story was served as the body's own root (${verdict.served} elements)`);
    check(verdict.adopted && verdict.same, `${label}: the app adopted THAT element into its root, not a copy`);
    check(verdict.lost === 0, `${label}: every served element is still in the adopted story (${verdict.lost} lost)`);
    check(verdict.reactOwned === 0, `${label}: React owns none of the island story (${verdict.reactOwned} owned)`);
    check(verdict.mode === 'read', `${label}: the islands are still running, in read mode (${verdict.mode})`);
    check(!verdict.servedChrome, `${label}: the served chrome gave way to the app's`);
    check(errors.length === 0, `${label}: no page error (${errors.length}: ${errors[0] ?? ''})`);
  };

  // AN ANONYMOUS READER: nothing of the app after idle; reaching for Comment loads it, and it adopts.
  {
    const { page, errors, scripts, served: header } = await open(anonymous, kitPath);
    check(header === 'compiled', `anonymous: ${kitPath} is served compiled (${header})`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);
    const idle = await page.evaluate(COMPILED_VERDICT);
    const before = scripts.length;
    check(!idle.appRoot && !idle.adopted, `anonymous: after idle the app has not loaded (${before} scripts: ${scripts.join(' ')})`);
    await page.hover('body > [data-mx-reader-chrome] [data-mx-reader-action="comment"]');
    const adopted = await waitFor(page, `(${COMPILED_VERDICT})().adopted`, 30000);
    check(adopted && scripts.length > before, `anonymous: reaching for Comment loaded the app (${scripts.length - before} more scripts)`);
    await page.waitForTimeout(500);
    judge('anonymous', await page.evaluate(COMPILED_VERDICT), errors);
    await page.close();
  }

  // THE OWNER: the app loads on idle, with no gesture at all, and adopts the same element.
  {
    const { page, errors } = await open(ownerContext, kitPath);
    const adopted = await waitFor(page, `(${COMPILED_VERDICT})().adopted`, 30000);
    check(adopted, 'owner: the app loaded on idle, without a gesture, and adopted the story');
    await page.waitForTimeout(500);
    judge('owner', await page.evaluate(COMPILED_VERDICT), errors);
    await page.close();
  }

  // EDIT FROM THE COMPILED PAGE: the interpreter takes over the same source, the edit publishes, and a reload is compiled again.
  {
    const doc = await publishAs(ownerPage, { title: 'Compiled edit', visibility: 'unlisted', markup: '<article><h1>Compiled edit</h1><p id="para">Before the edit.</p>'
      + '<Tabs defaultValue="a"><TabsList><TabsTrigger value="a">A</TabsTrigger><TabsTrigger value="b">B</TabsTrigger></TabsList><TabsContent value="a">a</TabsContent><TabsContent value="b">b</TabsContent></Tabs></article>' });
    const path = `/a/${doc.id}`;
    const header = await compiledServed(path);
    check(header === 'compiled', `edit: the new document is served compiled (${header})`);
    const { page, errors } = await open(ownerContext, path);
    check(await waitFor(page, `(${COMPILED_VERDICT})().adopted`, 30000), 'edit: the owner\'s app adopted the compiled story');
    const head = await ownerPage.evaluate(async (id) => (await fetch(`/api/my/artifacts/${id}`)).json(), doc.id);
    await page.click('#root [data-mx-reader-rail] [data-mx-reader-action="edit"]');
    await page.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 20000 });
    check(await waitFor(page, '!window.__compiledTakeover.story.isConnected && !!document.querySelector("#root [data-mx-inline-story] #para")', 20000),
      'edit: the islands left and the interpreter drew the same source in their place');
    check(await page.evaluate(() => window.__compiledTakeover.story.__mxIslands?.mode?.()) === 'edit', 'edit: the islands were put in edit mode before they went');
    await waitFor(page, '!!document.querySelector("#root #para")?.isContentEditable', 20000);
    await page.evaluate(() => {
      const el = document.querySelector('#root #para');
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    await page.keyboard.type('Edited from the compiled page.');
    await page.click('[aria-label="Exit edit mode"]');
    let after = head;
    for (const end = Date.now() + 20000; Date.now() < end && after.version <= head.version;) {
      await page.waitForTimeout(500);
      after = await ownerPage.evaluate(async (id) => (await fetch(`/api/my/artifacts/${id}`)).json(), doc.id);
    }
    check(after.version > head.version && (after.markup ?? '').includes('Edited from the compiled page.'), `edit: the edit published (v${head.version} → v${after.version})`);
    check(errors.length === 0, `edit: no page error (${errors.length}: ${errors[0] ?? ''})`);
    await page.close();
    const again = await compiledServed(path);
    check(again === 'compiled', `edit: reloading serves the compiled page again (${again})`);
    const { page: reloaded } = await open(anonymous, path);
    check(await reloaded.evaluate(() => document.querySelector('body > [data-mx-inline-story]')?.textContent?.includes('Edited from the compiled page.') ?? false),
      'edit: the reloaded compiled page shows the edit');
    await reloaded.close();
  }
}

try {
  const sink = await startMailSink();
  const ownerContext = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await githubWidgetFixture(ownerContext);
  const ownerPage = await ownerContext.newPage();
  await becomeAccountOwner(ownerPage, B, { sink, email: `mxmx_test_hydration_owner_${Date.now()}@example.com` });
  const fixtures = await publishPageSpeedFixtures((body) => publishAs(ownerPage, body));
  const kit = fixtures.find((fixture) => fixture.key === 'kit');
  const anonymous = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await githubWidgetFixture(anonymous);
  await runCompiledTakeover({ ownerContext, ownerPage, anonymous, kit });

  await anonymous.close();
  await ownerContext.close();

} finally {
  await browser.close();
}
check.done();
