/**
 * The deck example's steps (skills/artifactbin/examples/deck-steps.mjs) run against slide DOM: titles may only claim
 * numbers and time words their own slide shows. A stub page hands evaluate() the jsdom document.
 */
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {afterEach, expect, it} from 'vitest';

const source = readFileSync(new URL('../../../skills/artifactbin/examples/deck-steps.mjs', import.meta.url), 'utf8')
  .replace('SLIDE_COUNT=8,CHART_COUNT=2', 'SLIDE_COUNT=1,CHART_COUNT=1');
const saved = {document: globalThis.document, NodeFilter: (globalThis as {NodeFilter?: unknown}).NodeFilter};
afterEach(() => Object.assign(globalThis, saved));

/** Runs the steps over one slide; returns the claim error, or null when every step passes. */
async function claims(title: string, body: string): Promise<string | null> {
  const dom = new JSDOM(`<main><section data-af-slide data-af-id="slide-a"><p class="t-label">02 · Market</p>` +
    `<h2>${title}</h2>${body}<p class="illustrative">Illustrative figures</p></section></main><span id="count"></span>`);
  Object.assign(globalThis, {document: dom.window.document, NodeFilter: dom.window.NodeFilter});
  const locator: unknown = new Proxy({}, {get: (_, key) => key === 'count' ? async () => 1 : key === 'nth' ? () => locator : async () => {}});
  const page = {waitForFunction: async () => {}, evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg),
    locator: () => locator, getByRole: () => locator, keyboard: {press: async () => {}}};
  const step = async (_label: string, fn: () => Promise<void>) => fn();
  try {
    await new (Object.getPrototypeOf(async function () {}).constructor)('page', 'step', source)(page, step);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

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
