/**
 * THE HOST-PAGE GUIDE'S FIRST EXAMPLE IN A REAL BROWSER (skills/artifactbin/references/host-pages.md): a host page on
 * another origin, served with exactly the strict Content-Security-Policy the guide states (no 'unsafe-inline'), loads
 * the manifest, one design system and two components from the app server. Chromium enforces the policy: the
 * components are styled by adopted sheets, no inline style element exists and nothing is refused. Without the opt-in
 * meta the same page's component styles are refused, which proves the policy is being enforced.
 * Real Chromium: CI runs this in `integration` (scripts/lib/chromium-tests).
 */
import { getRequestListener } from '@hono/node-server';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { withHttpServer, type RunningServer } from '@artifactbin/test-support/net';
import { guideExamples } from '@/test/helpers/skill-docs';
import { createAppServer } from '@/server/app';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();
let app: RunningServer, shell: RunningServer, browser: Browser;
let page = '', script = '', policy = '';
beforeAll(async () => {
  const server = createAppServer({ indexHtml: async () => '<!doctype html><html><body></body></html>' });
  app = await withHttpServer(getRequestListener(server.fetch));
  const [html] = guideExamples('host-pages', 'Components and a design system under a strict CSP', 'html', app.base);
  [script] = guideExamples('host-pages', 'Components and a design system under a strict CSP', 'js', app.base);
  page = html!;
  // The policy the example says it is served with, as one header.
  policy = /Served with: Content-Security-Policy: ([\s\S]*?)-->/.exec(page)![1]!.replace(/\s+/g, ' ').trim();
  shell = await withHttpServer((req, res) => {
    if (req.url === '/shell.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(script); return; }
    const html = req.url === '/without-opt-in' ? page.replace('<meta name="af-styles" content="adopted">', '') : page;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': policy });
    res.end(html);
  });
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => { await browser?.close(); await shell?.close(); await app?.close(); });

async function open(path: string) {
  const context = await browser.newContext();
  const tab = await context.newPage();
  const refused: string[] = [];
  tab.on('console', (message) => { if (/Content Security Policy/i.test(message.text())) refused.push(message.text()); });
  await tab.goto(shell.base + path);
  await tab.waitForFunction(() => customElements.get('af-button') && customElements.get('af-tabs'), null, { timeout: 20_000 });
  const seen = await tab.evaluate(() => ({
    styles: document.querySelectorAll('style').length,
    adopted: document.adoptedStyleSheets.length,
    button: getComputedStyle(document.querySelector('af-button')!).display,
    background: getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
  }));
  await context.close();
  return { ...seen, refused };
}

it('renders two components styled under the guide\'s strict policy, with no inline style element and nothing refused', async () => {
  expect(policy).toContain("style-src " + app.base);
  expect(policy).not.toContain('unsafe-inline');
  const seen = await open('/');
  expect(seen.refused).toEqual([]);
  expect(seen.styles).toBe(0);
  expect(seen.adopted).toBe(2);
  expect(seen.button).toBe('inline-flex');
  // The design system's sheet loaded from its pinned address under `style-src`.
  expect(seen.background).not.toBe('');
}, 60_000);

it('without the opt-in the same policy refuses the components\' styles', async () => {
  const seen = await open('/without-opt-in');
  expect(seen.refused.length).toBeGreaterThan(0);
  expect(seen.adopted).toBe(0);
  expect(seen.button).not.toBe('inline-flex');
}, 60_000);
