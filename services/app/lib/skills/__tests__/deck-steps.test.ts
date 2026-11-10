/**
 * The deck example's steps (skills/artifactbin/examples/deck-steps.mjs) run against slide DOM: the unedited template
 * passes, and placeholders, a missing badge and stray text outside the slides fail. A stub page hands evaluate() the jsdom document; template() renders examples/deck.html itself (charts stubbed).
 * The steps read their slide and chart counts from the page's SLIDES (none on a hand-built page).
 */
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {afterEach, expect, it} from 'vitest';

const source = readFileSync(new URL('../../../skills/artifactbin/examples/deck-steps.mjs', import.meta.url), 'utf8');
const DECK = readFileSync(new URL('../../../skills/artifactbin/examples/deck.html', import.meta.url), 'utf8');
const saved = {document: globalThis.document, NodeFilter: (globalThis as {NodeFilter?: unknown}).NodeFilter,
  window: (globalThis as {window?: unknown}).window};
afterEach(() => Object.assign(globalThis, saved));

/** Runs the steps over one page; returns the first failure, or null when every step passes. */
async function run(html: string | JSDOM, steps = source): Promise<string | null> {
  const dom = typeof html === 'string' ? new JSDOM(html) : html;
  Object.assign(globalThis, {document: dom.window.document, NodeFilter: dom.window.NodeFilter, window: dom.window});
  const locator: unknown = new Proxy({}, {get: (_, key) => key === 'count' ? async () => 1 : key === 'nth' ? () => locator : async () => {}});
  const evaluate = async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg);
  const page = {waitForFunction: async () => {}, evaluate, mainFrame: () => ({evaluate}),
    locator: () => locator, getByRole: () => locator, keyboard: {press: async () => {}}};
  const step = async (_label: string, fn: () => Promise<void>) => fn();
  try {
    await new (Object.getPrototypeOf(async function () {}).constructor)('page', 'step', steps)(page, step);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

/** Renders examples/deck.html (after edit) in jsdom with Vega stubbed, then runs the steps with placeholders allowed. */
async function template(edit = (html: string) => html): Promise<string | null> {
  const html = edit(DECK), [data, app] = [...html.matchAll(/<script type="module"[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]!);
  const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ''), {runScripts: 'outside-only'});
  Object.assign(dom.window, {IntersectionObserver: class { observe() {} disconnect() {} }, stubs: {compile: () => ({spec: {}}),
    vega: {View: class { async runAsync() {} finalize() {} }, parse: () => ({}), expressionInterpreter: {}},
    apollo: {sql: () => { throw Error('the template deck reads no dataset'); }}}});
  dom.window.eval(data!);
  await dom.window.eval(`(async()=>{const vega=stubs.vega,{compile}=stubs,{sql}=stubs.apollo;${app!.replace(/^import .*$/gm, '')}})()`);
  return run(dom, source.replace('PLACEHOLDERS_OK=false', 'PLACEHOLDERS_OK=true'));
}

const NAV = '<nav data-af-deck-chrome><button>←</button><button>→</button><span id="count">01 / 01</span></nav>';
const BADGE = '<p class="illustrative">Illustrative figures</p>';
/** Runs the steps over one slide (with the deck nav and, unless replaced, the badge). */
const claims = (title: string, body: string, badge = BADGE, before = '') => run(`${before}<main><section data-af-slide ` +
  `data-af-id="slide-a"><p class="t-label">02 · Market</p><h2>${title}</h2>${body}${badge}</section></main>${NAV}`);

it('fails while a slide keeps a template placeholder', async () => {
  expect(await claims('[Market size in one sentence]', '<p>[placeholder]</p>')).toContain('placeholders left');
  expect(await claims('A $4.2B market', '<p>$4.2B total</p>')).toBeNull();
});

it('requires the Illustrative figures badge on every slide, even one without figures', async () => {
  expect(await claims('Why buyers switch', '<ul><li>Less manual work</li></ul>', '')).toContain('no Illustrative figures badge on slide-a');
  expect(await claims('Why buyers switch', '<ul><li>Less manual work</li></ul>')).toBeNull();
});

it('fails on stray text outside the slides and the nav, such as a leftover "-->"', async () => {
  expect(await claims('Why buyers switch', '<ul><li>Less manual work</li></ul>', BADGE, '-->')).toContain('stray text outside the slides: "-->"');
  expect(await claims('Why buyers switch', '<ul><li>Less manual work</li></ul>')).toBeNull();
});

it('passes the unedited deck template', async () => {
  expect(await template()).toBeNull();
});

it('fails while the <title> is a starter placeholder', async () => {
  const named = (title: string) => (html: string) => html.replace('<title>[Company] pitch deck</title>', `<title>${title}</title>`);
  expect(await run(`<title>[Company] pitch deck</title>${NAV}`)).toContain('placeholders left on the page title or description');
  expect(await template(named('Why our onboarding takes 11 days'))).toBeNull();
});
