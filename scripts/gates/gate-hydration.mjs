/** Compiled reader handover: the served story survives the island boot in its frame and yields to editing. */
import { createChecker } from './lib/assert.mjs';
import { fixtureFetch as fetch } from './lib/fixture-http.mjs';
import { launchChromium } from './lib/browser.mjs';
import { documentFrame } from './lib/page-facts.mjs';
import { becomeAccountOwner, publishAs } from '../lib/start-doc.mjs';
import { startMailSink } from '../lib/mail-login.mjs';
import { publishPageSpeedFixtures } from '../fixtures/page-speed/index.mjs';
import { githubWidgetFixture } from './lib/github-widget-fixture.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('hydration');
const browser = await launchChromium();
/** Poll an expression in a page or frame until it is truthy. */
const waitFor = async (target, expr, ms = 20000) => {
  for (const deadline = Date.now() + ms; Date.now() < deadline;) {
    if (await target.evaluate(expr).catch(() => false)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
};

const READER_HEADER = 'x-mx-reader';

/**
 * The compiled page as served IN THE DOCUMENT'S FRAME: its story root (a body child, no wrapper) and every element
 * in it, captured at DOMContentLoaded, before any island can have run. An init script runs in every frame; on the
 * app page (which carries no story) it captures nothing.
 */
const COMPILED_PROBE = () => {
  const state = (window.__compiledTakeover = { story: null, served: [], staticNodes: [] });
  document.addEventListener('DOMContentLoaded', () => {
    const story = document.querySelector('body > [data-mx-inline-story]');
    if (!story) return;
    state.story = story;
    state.served = [...story.querySelectorAll('*')];
    // One-tree keys also cover stateful kit roots; full-kit and Mermaid gates check their reader-visible transitions.
    state.staticNodes = [...story.querySelectorAll('[data-mx-ast]')]
      .filter((node) => !node.closest('[data-hk^="s"], [aria-label="Question embed"], [data-mx-mermaid-state], [data-slot="avatar-fallback"], [data-slot="tabs-content"], [data-slot="tooltip-trigger"]'))
      .map((node) => ({ node, attrs: [...node.attributes].map((attr) => [attr.name, attr.value]),
        text: [...node.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent).join('') }));
  });
};
/** The verdict, read inside the document's frame: the served story is the one still running there. */
const COMPILED_VERDICT = () => {
  const { story, served, staticNodes } = window.__compiledTakeover ?? { story: null, served: [], staticNodes: [] };
  return {
    captured: !!story, served: served.length,
    // There is no adoption any more (the app page frames the document): the served element is simply still THE story.
    same: !!story && story.isConnected && document.querySelector('[data-mx-inline-story]') === story,
    lost: story ? served.filter((n) => !story.contains(n)).length : -1,
    staticNodes: staticNodes.length,
    staticChanged: staticNodes.filter(({ node, attrs, text }) => !story?.contains(node)
      || JSON.stringify([...node.attributes].map((attr) => [attr.name, attr.value])) !== JSON.stringify(attrs)
      || [...node.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent).join('') !== text).length,
    reactOwned: story ? [story, ...served].filter((n) => Object.keys(n).some((k) => k.startsWith('__reactFiber$'))).length : -1,
    mode: story?.__mxIslands?.mode?.() ?? null,
    framed: document.documentElement.classList.contains('mx-framed'),
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

async function runCompiledTakeover({ ownerContext, ownerPage, anonymous, kit, fixtures }) {
  const kitPath = `/a/${kit.id}`;
  const served = await compiledServed(kitPath);
  if (served !== 'compiled') {
    check(false, `compiled takeover: expected the compiled page (${READER_HEADER}: ${served})`);
    return;
  }
  const open = async (context, path) => {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`page error: ${String(e).slice(0, 300)}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.text().slice(0, 300)} (${m.location().url})`); });
    await page.addInitScript(COMPILED_PROBE);
    const response = await page.goto(`${B}${path}`, { waitUntil: 'load', timeout: 90000 });
    const doc = await documentFrame(page, { timeout: 60000 });
    return { page, doc, errors, served: response?.headers()[READER_HEADER] ?? 'absent' };
  };
  /** Poll the frame's verdict until `want`, or give up: returns the last verdict. */
  const verdictWhen = async (page, want, ms = 30000) => {
    let verdict = null;
    for (const deadline = Date.now() + ms; Date.now() < deadline;) {
      verdict = await (await documentFrame(page)).evaluate(COMPILED_VERDICT).catch(() => null);
      if (verdict && want(verdict)) return verdict;
      await page.waitForTimeout(100);
    }
    return verdict ?? { captured: false, served: 0, same: false, lost: -1, staticNodes: 0, staticChanged: -1, reactOwned: -1, mode: null, framed: false };
  };
  const judge = (label, verdict, errors) => {
    check(verdict.captured && verdict.served > 0, `${label}: the compiled story was served as the framed document's own root (${verdict.served} elements)`);
    check(verdict.framed, `${label}: the document runs in the app page's frame`);
    // "The app adopted THAT element into its root" is retired: the app page frames the document and adopts nothing.
    check(verdict.same, `${label}: the served story element is still the document's story, not a copy`);
    check(verdict.lost === 0, `${label}: every served element is still in the story (${verdict.lost} lost)`);
    check(verdict.reactOwned === 0, `${label}: no React fiber on the island story (a guard against React returning) (${verdict.reactOwned} owned)`);
    check(verdict.mode === 'read', `${label}: the islands are still running, in read mode (${verdict.mode})`);
    // "The served chrome gave way to the app's" is retired: the document carries no chrome; the bar is the app page's.
    check(errors.length === 0, `${label}: no page error (${errors.length}: ${errors[0] ?? ''})`);
  };

  // AN ANONYMOUS READER. "Nothing of the app after idle; reaching for Comment loads it" is retired: every reader gets
  // the app page, which frames the document (lib/serving/document-frame); the islands boot in the frame regardless.
  {
    const { page, errors, served: header } = await open(anonymous, kitPath);
    check(header === 'compiled', `anonymous: ${kitPath} is served compiled (${header})`);
    const verdict = await verdictWhen(page, (v) => v.mode === 'read');
    await page.waitForTimeout(500);
    judge('anonymous', verdict.mode === 'read' ? await (await documentFrame(page)).evaluate(COMPILED_VERDICT) : verdict, errors);
    await page.close();
  }

  // THE OWNER: the islands boot in the frame with no gesture at all, on the same served element.
  {
    const { page, errors } = await open(ownerContext, kitPath);
    const verdict = await verdictWhen(page, (v) => v.mode === 'read');
    check(verdict.mode === 'read', 'owner: the islands booted in the frame without a gesture');
    await page.waitForTimeout(500);
    judge('owner', await (await documentFrame(page)).evaluate(COMPILED_VERDICT), errors);
    await page.close();
  }

  // EDIT FROM THE COMPILED PAGE: the same story accepts the editor, the edit publishes, and a reload is compiled again.
  {
    const doc = await publishAs(ownerPage, { title: 'Compiled edit', visibility: 'unlisted', markup: '<article><h1>Compiled edit</h1><p id="para">Before the edit.</p>'
      + '<Tabs defaultValue="a"><TabsList><TabsTrigger value="a">A</TabsTrigger><TabsTrigger value="b">B</TabsTrigger></TabsList><TabsContent value="a">a</TabsContent><TabsContent value="b">b</TabsContent></Tabs></article>' });
    const path = `/a/${doc.id}`;
    const header = await compiledServed(path);
    check(header === 'compiled', `edit: the new document is served compiled (${header})`);
    const { page, doc: frame, errors } = await open(ownerContext, path);
    check((await verdictWhen(page, (v) => v.mode === 'read')).mode === 'read', 'edit: the owner\'s frame booted the compiled story');
    const head = await ownerPage.evaluate(async (id) => (await fetch(`/api/my/artifacts/${id}`)).json(), doc.id);
    // The rail's Edit is the app bar's own button now (solid/document/DocumentChrome).
    await page.click('header[aria-label="Page bar"] [aria-label="Edit"]');
    await page.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 20000 });
    check(await waitFor(frame, 'window.__compiledTakeover.story.isConnected && document.querySelector("[data-mx-inline-story]") === window.__compiledTakeover.story && !!document.querySelector("#para")?.isContentEditable', 20000),
      'edit: the compiled story stayed mounted in its frame and became editable');
    check(await frame.evaluate(() => window.__compiledTakeover.story.__mxIslands?.mode?.()) === 'edit', 'edit: the islands entered edit mode');
    await waitFor(frame, '!!document.querySelector("#para")?.isContentEditable', 20000);
    // A click gives the frame the page's keyboard focus; the selection then takes the paragraph's whole text.
    await frame.click('#para');
    await frame.evaluate(() => {
      const el = document.querySelector('#para');
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    // The keyboard goes to the focused frame.
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
    let again = await compiledServed(path);
    for (const end = Date.now() + 20000; end > Date.now() && again !== 'compiled';) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      again = await compiledServed(path);
    }
    check(again === 'compiled', `edit: reloading serves the compiled page again (${again})`);
    const { page: reloaded, doc: reloadedDoc } = await open(anonymous, path);
    check(await waitFor(reloadedDoc, 'document.querySelector("body > [data-mx-inline-story]")?.textContent?.includes("Edited from the compiled page.") ?? false', 10000),
      'edit: the reloaded compiled page shows the edit');
    await reloaded.close();
  }

  // Every page-speed lab fixture keeps its server-rendered static AST nodes, attributes, and direct text
  // through the compiled island boot in the frame. Dynamic island descendants are checked by the
  // existing takeover and full-kit gates; their hydration attributes are owned by Solid.
  for (const fixture of fixtures) {
    const path = `/a/${fixture.id}`;
    const header = await compiledServed(path);
    check(header === 'compiled', `static hydration ${fixture.key}: compiled response (${header})`);
    if (header !== 'compiled') continue;
    const { page, errors } = await open(ownerContext, path);
    // A prose fixture ships no island module (its mode stays null), so the boot is waited for only so long.
    await verdictWhen(page, (v) => v.mode === 'read', 8000);
    await page.waitForTimeout(500);
    const verdict = await (await documentFrame(page)).evaluate(COMPILED_VERDICT);
    check(verdict.captured && verdict.staticNodes > 0 && verdict.staticChanged === 0,
      `static hydration ${fixture.key}: ${verdict.staticNodes} static nodes retained attributes and direct text (${verdict.staticChanged} changed)`);
    check(errors.length === 0, `static hydration ${fixture.key}: no page errors (${errors[0] ?? ''})`);
    await page.close();
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
  await runCompiledTakeover({ ownerContext, ownerPage, anonymous, kit, fixtures });

  await anonymous.close();
  await ownerContext.close();

} finally {
  await browser.close();
}
check.done();
