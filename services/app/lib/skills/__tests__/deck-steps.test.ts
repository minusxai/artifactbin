/**
 * The deck example's steps (skills/artifactbin/examples/deck-steps.mjs) run against slide DOM: titles may only claim
 * numbers and time words their own slide shows, and the ask's milestone starts from the traction chart's last value.
 * A stub page hands evaluate() the jsdom document; template() renders examples/deck.html itself (charts stubbed).
 */
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {afterEach, expect, it} from 'vitest';

const source = readFileSync(new URL('../../../skills/artifactbin/examples/deck-steps.mjs', import.meta.url), 'utf8')
  .replace('SLIDE_COUNT=8,CHART_COUNT=2', 'SLIDE_COUNT=1,CHART_COUNT=1');
const DECK = readFileSync(new URL('../../../skills/artifactbin/examples/deck.html', import.meta.url), 'utf8');
const saved = {document: globalThis.document, NodeFilter: (globalThis as {NodeFilter?: unknown}).NodeFilter,
  window: (globalThis as {window?: unknown}).window};
afterEach(() => Object.assign(globalThis, saved));

/** Runs the steps over one page; returns the first failure, or null when every step passes. */
async function run(html: string | JSDOM, steps = source): Promise<string | null> {
  const dom = typeof html === 'string' ? new JSDOM(html) : html;
  Object.assign(globalThis, {document: dom.window.document, NodeFilter: dom.window.NodeFilter, window: dom.window});
  const locator: unknown = new Proxy({}, {get: (_, key) => key === 'count' ? async () => 1 : key === 'nth' ? () => locator : async () => {}});
  const page = {waitForFunction: async () => {}, evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg),
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
    vega: {View: class { async runAsync() {} finalize() {} }, parse: () => ({}), expressionInterpreter: {}}}});
  dom.window.eval(data!);
  await dom.window.eval(`(async()=>{const vega=stubs.vega,{compile}=stubs;${app!.replace(/^import .*$/gm, '')}})()`);
  return run(dom, source.replace('PLACEHOLDERS_OK=false', 'PLACEHOLDERS_OK=true'));
}

const NAV = '<nav data-af-deck-chrome><button>←</button><button>→</button><span id="count">01 / 01</span></nav>';
const BADGE = '<p class="illustrative">Illustrative figures</p>';
/** Runs the steps over one slide (with the deck nav and, unless replaced, the badge). */
const claims = (title: string, body: string, badge = BADGE, before = '') => run(`${before}<main><section data-af-slide ` +
  `data-af-id="slide-a"><p class="t-label">02 · Market</p><h2>${title}</h2>${body}${badge}</section></main>${NAV}`);
const flow = (labels: string[]) => '<div class="figure"><svg>' + labels.map(label => `<rect></rect><text>${label}</text>`).join('') + '</svg></div>';

it('reads SVG text node by node, so a visible tick or label backs a title number', async () => {
  const chart = '<div class="chart"><svg><text>0</text><text>2</text><text>4</text><text>14</text></svg></div>';
  expect(await claims('Utilities grew to 14', chart)).toBeNull();
  expect(await claims('Utilities grew to 15', chart)).toContain("claims '15' but the slide doesn't show it (numbers on slide: 2, 0, 4, 14)");
});

it('backs a time word only with the same form beside a number or a title neighbour', async () => {
  const title = 'Clamp-on sensors that hear a leak weeks before it breaks';
  expect(await claims(title, '<ul><li>One field crew a week</li></ul>')).toContain("claims 'weeks'");
  expect(await claims(title, '<ul><li>Flags a leak weeks before a main breaks</li></ul>')).toBeNull();
  expect(await claims('Leaks found in hours', '<ul><li>Alerts within 4 hours</li></ul>')).toBeNull();
});

it('treats today, so far and this quarter as claims the slide must show', async () => {
  expect(await claims('$0.31B reachable today', '<p>$0.31B serviceable market</p>')).toContain("claims 'today'");
  expect(await claims('$0.31B reachable today', '<p>$0.31B reachable today</p>')).toBeNull();
  expect(await claims('12 utilities so far', '<p>12 utilities signed</p>')).toContain("claims 'so far'");
  expect(await claims('12 utilities this quarter', '<p>12 utilities signed this quarter</p>')).toBeNull();
});

it('passes plain titles whose numbers are on the slide, and skips template placeholders', async () => {
  expect(await claims('A $4.2B market, $1.1B serviceable', '<div class="chart"><svg><text>$4.2B</text><text>$1.1B</text></svg></div>')).toBeNull();
  expect(await claims('[Market size in one sentence]', '<p>[placeholder]</p>')).toContain('placeholders left');
});

it('requires the Illustrative figures badge on every slide, even one without figures', async () => {
  expect(await claims('Why buyers switch', '<ul><li>Less manual work</li></ul>', '')).toContain('no Illustrative figures badge on slide-a');
  expect(await claims('Why buyers switch', '<ul><li>Less manual work</li></ul>')).toBeNull();
});

it('treats "in one shift"-style phrases with a time noun as durations, and other nouns as plain copy', async () => {
  const boxes = flow(['Hear', 'Locate', 'Dispatch', 'Repair']);
  expect(await claims('From pipe noise to a repair crew in one shift', boxes)).toContain("claims 'in one shift'");
  expect(await claims('From pipe noise to a repair crew in one shift', boxes + '<p>Crew dispatched within one shift</p>')).toBeNull();
  expect(await claims('Every main checked within a single visit', boxes)).toContain("claims 'within a single visit'");
  expect(await claims('Under two weeks to install', '<ul><li>Installs in a day</li></ul>')).toContain("claims 'under two weeks'");
  expect(await claims('From pipe noise to repair in four steps', boxes)).toBeNull();
  expect(await claims('Leak detection in one clamp-on unit', boxes)).toBeNull();
  expect(await claims('Every main in one dashboard', boxes)).toBeNull();
});

it('fails on stray text outside the slides and the nav, such as a leftover "-->"', async () => {
  expect(await claims('Why buyers switch', '<ul><li>Less manual work</li></ul>', BADGE, '-->')).toContain('stray text outside the slides: "-->"');
  expect(await claims('Why buyers switch', '<ul><li>Less manual work</li></ul>')).toBeNull();
});

it('treats hyphenated and multi- durations as claims: the unit beside a number, or the same compound', async () => {
  const title = 'Paid per sensor, per month, on a five-year term';
  expect(await claims(title, '<ul><li>$40 per sensor per month</li></ul>')).toContain("claims 'five-year'");
  expect(await claims(title, '<ul><li>$40 per sensor per month</li><li>5-year contracts</li></ul>')).toBeNull();
  const quarters = '<div class="chart"><svg>' + [1, 2, 3, 4, 5, 6].map(q => `<text>Q${q}</text>`).join('') + '</svg></div>';
  expect(await claims('Pilots become multi-year contracts', quarters)).toContain("claims 'multi-year'");
  expect(await claims('Pilots become multi-year contracts', quarters + '<p>Multi-year renewals</p>')).toBeNull();
  expect(await claims('Installs in a two-week window', '<ul><li>Installs in a day</li></ul>')).toContain("claims 'two-week'");
});

it('counts spelled-out numbers like digits, backed by the value, the word or that many labelled items', async () => {
  const items = (n: number) => '<ul class="items">' + Array.from({length: n}, (_, i) => `<li>Reason ${String.fromCharCode(65 + i)}</li>`).join('') + '</ul>';
  expect(await claims('Three reasons buyers switch', items(3))).toBeNull();
  expect(await claims('Three reasons buyers switch', items(2))).toContain("claims 'three'");
  expect(await claims('A dozen utilities signed', '<p>12 utilities signed</p>')).toBeNull();
  expect(await claims('Two hundred sensors live', '<p>200 sensors installed</p>')).toBeNull();
  expect(await claims('Two hundred sensors live', '<p>120 sensors installed</p>')).toContain("claims 'two hundred'");
});

it('passes the unedited deck template, whose ask milestone starts from the traction chart', async () => {
  expect(await template()).toBeNull();
});

it("fails an ask milestone that doesn't start from the traction chart's last value", async () => {
  expect(await template(html => html.replace("milestone:'[100 customers]'", "milestone:'12 → 100 customers'")))
    .toContain('the ask milestone "14 → 12 → 100 customers" does not start from Traction\'s last value 14');
  expect(await template(html => html.replace("from:'traction', milestone:'[100 customers]'", "milestone:'12 → 100 customers'")))
    .toContain('does not start from Traction\'s last value 14');
  expect(await template(html => html.replace("{x:'Q4', y:14}", "{x:'Q4', y:28}"))).toBeNull();
});
