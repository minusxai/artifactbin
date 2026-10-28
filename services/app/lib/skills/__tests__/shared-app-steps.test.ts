/**
 * The shared-app example's narrow-viewport steps (skills/artifactbin/examples/shared-app-steps.mjs) over a jsdom page:
 * the trend's x labels must follow the month selector (or read as dates in time order), text outside main fails, and
 * dark mode, turned on to check it survives a reload, is turned back off (narrow() reports 'dark mode left on').
 */
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {afterEach, expect, it} from 'vitest';

const source = readFileSync(new URL('../../../skills/artifactbin/examples/shared-app-steps.mjs', import.meta.url), 'utf8')
  .replace('PLACEHOLDERS_OK=false', 'PLACEHOLDERS_OK=true');
const saved = {document: globalThis.document, NodeFilter: (globalThis as {NodeFilter?: unknown}).NodeFilter};
afterEach(() => Object.assign(globalThis, saved));
const MONTHS = ['2025-11', '2025-12', '2026-01'];

/** Runs the narrow steps over a page whose trend axis shows labels; returns the failure, or null. */
async function narrow(labels: string[], before = ''): Promise<string | null> {
  const points = '<path></path>'.repeat(2 * MONTHS.length);
  const dom = new JSDOM(`${before}<main><p id="status">Loaded 300 sample transactions.</p><b id="target">$3,105.00</b>` +
    `<select id="month">${MONTHS.map(m => `<option>${m}</option>`).join('')}</select>` +
    `<div id="trend"><svg><g class="role-axis" aria-label="Y-axis"><g class="role-axis-label"><text>0</text><text>1,000</text></g></g>` +
    `<g class="role-axis" aria-label="X-axis for a discrete scale"><g class="role-axis-label">${labels.map(l => `<text>${l}</text>`).join('')}</g></g>` +
    `<g class="mark-symbol role-mark">${points}</g></svg></div><div id="payer"><svg><g class="mark-rect role-mark"><path></path></g></svg></div>` +
    '<button data-af-id="cat-Groceries-open">Groceries</button><ul><li data-af-id="row-1">row</li></ul></main>');
  const doc = dom.window.document;
  Object.assign(globalThis, {document: doc, NodeFilter: dom.window.NodeFilter});
  const locator = (selector: string) => ({count: async () => doc.querySelectorAll(selector).length,
    textContent: async () => doc.querySelector(selector)?.textContent ?? '', click: async () => {}, waitFor: async () => {},
    first: () => locator(selector)});
  const page = {viewportSize: () => ({width: 390, height: 800}), reload: async () => {}, locator,
    evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg),
    waitForFunction: async (fn: (arg: unknown) => unknown, arg: unknown) => { if (!fn(arg)) throw Error('timed out'); },
    getByRole: () => ({click: async () => { doc.documentElement.dataset.afDark = String(doc.documentElement.dataset.afDark !== 'true'); }})};
  const step = async (_label: string, fn: () => Promise<void>) => fn();
  try {
    await new (Object.getPrototypeOf(async function () {}).constructor)('page', 'step', source)(page, step);
    if (doc.documentElement.dataset.afDark === 'true') return 'dark mode left on';
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

it('passes the template order and relabelled months still in time order', async () => {
  expect(await narrow(MONTHS)).toBeNull();
  expect(await narrow(['Nov 2025', 'Dec 2025', 'Jan 2026'])).toBeNull();
});

it('fails a trend whose months were sorted alphabetically', async () => {
  expect(await narrow(['Dec 2025', 'Jan 2026', 'Nov 2025'])).toContain('trend months out of order: Dec 2025, Jan 2026, Nov 2025');
  expect(await narrow(['2025-12', '2025-11', '2026-01'])).toContain('trend months out of order');
});

it('fails on stray text outside main, such as a leftover "-->"', async () => {
  expect(await narrow(MONTHS, '-->')).toContain('stray text outside main: "-->"');
});
