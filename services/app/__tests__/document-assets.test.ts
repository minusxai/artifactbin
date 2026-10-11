/**
 * THE DOCUMENT'S SHARED CSS, CACHED. A document on its own origin links the stylesheets every document of a build
 * shares from the app's origin (lib/page-styles/linked-sheets.server) instead of inlining ~200 KB of them: the same
 * addresses for every document, immutable, and only the document's own rules inline. Through the real app server.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { useAppHarness, request, mintAccountToken as mintToken } from '@/__tests__/harness';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { drainPreparedPageWarmups } from '@/lib/publish/prepared/prepared-page.server';
import { pagesOriginFor, pagesSiteFor } from '@/lib/http/pages-origin';
import { mintExportKey } from '@/lib/platform';
import { cssUnits } from '@/lib/page-styles/css-units';
import { createAppServer } from '../server/app';

useAppHarness();

const APP = 'https://app.example.test';
const site = pagesSiteFor('pages.example.test', APP)!;
const SHELL = '<!doctype html><html><head><title>artifactbin</title></head><body><div id="root"></div></body></html>';
const app = createAppServer({ indexHtml: async () => SHELL, pagesSite: site });
const FIXTURES = path.resolve(process.cwd(), '../../scripts/fixtures/page-speed');
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');

async function publish(markup: string, extra: Record<string, unknown> = {}): Promise<string> {
  const t = await mintToken('assets-owner');
  const res = await createRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup, visibility: 'public', ...extra } }));
  expect(res.status, await res.clone().text()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  await drainPreparedPageWarmups();
  return id;
}
const documentOrigin = async (id: string, headers: Record<string, string> = {}) =>
  app.request(`${pagesOriginFor(id, site)}/`, { headers: { accept: 'text/html', ...headers } });
const linksOf = (html: string) => [...html.matchAll(/<link rel="stylesheet" href="([^"]+)" crossorigin (data-mx-[a-z0-9-]+)>/g)].map((m) => ({ href: m[1]!, attr: m[2]! }));
const styles = (html: string) => [...html.matchAll(/<style( data-mx-[a-z0-9-]+)?>([\s\S]*?)<\/style>/g)].map((m) => ({ attr: m[1]?.trim() ?? '', css: m[2]! }));
const inlineBytes = (html: string) => styles(html).reduce((sum, style) => sum + style.css.length, 0);

describe('a document on its own origin', () => {
  it('links the shared stylesheets from the app\'s origin and carries only its own rules inline', async () => {
    const id = await publish(fixture('prose.jsx'));
    const res = await documentOrigin(id);
    expect(res.status).toBe(200);
    const html = await res.text();
    const links = linksOf(html);
    // Eight shards of the union; the few a document's own rules sit inside are carried inline, in place, instead.
    const shards = links.map((l) => l.attr).filter((a) => a.startsWith('data-mx-tw-s'));
    expect(shards.length).toBeGreaterThanOrEqual(5);
    expect(styles(html).filter((s) => s.attr.startsWith('data-mx-tw-i')).length).toBeGreaterThan(0);
    expect(links.map((l) => l.attr)).toContain('data-mx-base');
    for (const link of links) expect(link.href).toMatch(new RegExp(`^${APP}/islands/c/[0-9a-f]{16}\\.css$`));
    expect(styles(html).some((s) => s.attr === 'data-mx-tw')).toBe(false);
    // ~200 KB of CSS was inline in every document; what remains is the root rule, the document's own utilities and its author CSS.
    expect(inlineBytes(html)).toBeLessThan(40_000);
    expect(res.headers.get('content-security-policy')).toContain(`style-src 'self' 'unsafe-inline' ${APP}/islands/c/`);
  });

  it('serves each linked sheet immutable from the app, and the sheets of two documents are the same addresses', async () => {
    const [prose, kit] = [await publish(fixture('prose.jsx')), await publish(fixture('kit.jsx'))];
    const [a, b] = [linksOf(await (await documentOrigin(prose)).text()), linksOf(await (await documentOrigin(kit)).text())];
    const shared = a.filter((link) => b.some((other) => other.href === link.href));
    // Everything but the shards each document dirtied: a second document's first view fetches none of these again.
    expect(shared.length).toBeGreaterThanOrEqual(6);
    expect(shared.map((l) => l.attr)).toContain('data-mx-base');
    for (const link of a) {
      const sheet = await app.request(new URL(link.href).pathname);
      expect(sheet.status, link.href).toBe(200);
      expect(sheet.headers.get('content-type')).toMatch(/^text\/css/);
      expect(sheet.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    }
  });

  it('applies exactly the rules the standalone document inlines: nothing of the sheet is lost or invented', async () => {
    const id = await publish(fixture('deck.jsx'), { template: 'deck', theme: 'industry' });
    const linked = await (await documentOrigin(id)).text();
    // The same document as the in-app /raw copy, which inlines the standalone sheets (the sandboxed copy has no shared origin).
    const inline = await (await rawRoute(request(`/a/${id}/raw`), { params: Promise.resolve({ id }) })).text();
    expect(linksOf(inline)).toEqual([]);
    expect(styles(inline).some((s) => s.attr === 'data-mx-tw')).toBe(true);
    const expand = async (html: string) => {
      const texts = styles(html).filter((s) => s.attr).map((s) => s.css);
      for (const link of linksOf(html)) texts.push(await (await app.request(new URL(link.href).pathname)).text());
      return new Set(texts.flatMap((css) => cssUnits(css)));
    };
    const [applied, standalone] = [await expand(linked), await expand(inline)];
    for (const unit of standalone) expect(applied.has(unit), unit.slice(0, 80)).toBe(true);
    // The one thing the linked sheets carry that the standalone does not is the union's own, shorter statement of a
    // block the document restates with more declarations (the theme variables): the restatement follows and wins.
    const prelude = (unit: string) => unit.slice(0, unit.indexOf('{')).trim();
    const preludes = new Set([...standalone].map(prelude));
    for (const unit of applied) if (!standalone.has(unit)) expect(preludes.has(prelude(unit)), unit.slice(0, 80)).toBe(true);
  });

  it('preloads a linked sheet\'s faces from the sheet\'s origin, so each face downloads once', async () => {
    const id = await publish(fixture('prose.jsx'), { theme: 'industry' });
    const html = await (await documentOrigin(id)).text();
    const preloads = [...html.matchAll(/<link rel="preload" href="([^"]+)" as="font"/g)].map((m) => m[1]!);
    expect(preloads.length).toBeGreaterThan(0);
    for (const href of preloads) expect(href.startsWith(`${APP}/fonts/`), href).toBe(true);
  });

  it('keeps the sheets inline where the document has no shared origin: the sandboxed copy and a signed capture', async () => {
    const id = await publish(fixture('kit.jsx'));
    const copy = await (await rawRoute(request(`/a/${id}/raw`), { params: Promise.resolve({ id }) })).text();
    expect(copy).not.toContain('/islands/c/');
    const key = mintExportKey(id);
    const capture = await (await rawRoute(request(`/a/${id}/raw?chrome=0&key=${encodeURIComponent(key)}`), { params: Promise.resolve({ id }) })).text();
    expect(capture).not.toContain('/islands/c/');
    expect(styles(capture).some((s) => s.attr === 'data-mx-tw')).toBe(true);
  });
});
