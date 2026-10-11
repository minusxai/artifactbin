/**
 * THE APP PAGE OF A DOCUMENT WARMS ITS TWO CONNECTIONS (server/app withDocumentFrame): the frame's first URL is on
 * the pages apex, which 302s to `<hex(id)>.<pages host>` — two new TLS handshakes the browser can start from the head.
 * The origins are the server's own (the frame it drew), never the request's.
 */
import { describe, expect, it } from 'vitest';
import { attachActor } from '@artifactbin/utils';
import type { Actor } from '@artifactbin/contracts';
import { useAppHarness, request, mintAccountToken as mintToken } from '@/__tests__/harness';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { claimToken, createUser } from '@/lib/accounts';
import { drainPreparedPageWarmups } from '@/lib/publish/prepared/prepared-page.server';
import { pagesApexOrigin, pagesOriginFor, pagesSiteFor } from '@/lib/http/pages-origin';
import { createAppServer } from '../server/app';

useAppHarness();

const APP = 'https://app.example.test';
const site = pagesSiteFor('pages.example.test', APP)!;
const SHELL = '<!doctype html><html><head><meta charset="utf-8"><title>artifactbin</title></head><body><div id="root"></div></body></html>';
const app = () => createAppServer({ indexHtml: async () => SHELL, pagesSite: site });
const preconnects = (html: string): string[] => [...html.matchAll(/<link rel="preconnect" href="([^"]+)"[^>]*>/g)].map((m) => m[1]!);

async function publish(visibility: string) {
  const user = await createUser({ email: `preconnect-${visibility}@example.com` });
  const t = await mintToken(`preconnect-${visibility}`, user.id);
  await claimToken(user.id, t.token);
  const res = await createRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: '<h1>Warm</h1>', visibility } }));
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  await drainPreparedPageWarmups();
  const actor: Actor = { credential: 'session', userId: user.id, email: `preconnect-${visibility}@example.com`, emailVerified: true };
  return { id, actor };
}

describe('preconnect on the document\'s app page', () => {
  it('names the pages apex and the document\'s own origin, early in the head, for a signed-in reader', async () => {
    const w = await publish('private');
    const res = await app().request(attachActor(new Request(`${APP}/a/${w.id}`, { headers: { accept: 'text/html' } }), w.actor));
    const html = await res.text();
    expect(preconnects(html)).toEqual([pagesApexOrigin(site), pagesOriginFor(w.id, site)]);
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head.indexOf('rel="preconnect"'), 'before the app\'s own stylesheet-and-code links').toBeLessThan(head.indexOf('<title>'));
    // The agent pointer stays the first thing in the head.
    expect(head.indexOf('rel="help"')).toBeLessThan(head.indexOf('rel="preconnect"'));
    // The frame itself is unchanged.
    const src = new URL(/<iframe data-mx-document-frame="" src="([^"]+)"/.exec(html)![1]!.replaceAll('&amp;', '&'));
    expect(src.origin).toBe(pagesApexOrigin(site));
    expect(src.searchParams.get('next')).toBe(`${pagesOriginFor(w.id, site)}/`);
  });

  it('does the same for a guest on a public document, and takes no origin from the request', async () => {
    const w = await publish('unlisted');
    const res = await app().request(`${APP}/a/${w.id}?$x=1`, { headers: { accept: 'text/html', host: 'evil.example', 'x-forwarded-host': 'evil.example' } });
    expect(preconnects(await res.text())).toEqual([pagesApexOrigin(site), pagesOriginFor(w.id, site)]);
  });

  it('names nothing on a page that is not a document', async () => {
    const server = app();
    for (const path of ['/login', '/']) {
      const html = await (await server.request(`${APP}${path}`, { headers: { accept: 'text/html' } })).text();
      expect(preconnects(html), path).toEqual([]);
    }
  });
});
