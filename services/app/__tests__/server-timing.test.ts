/**
 * SERVER-TIMING ON EVERY RESPONSE (server/app, the first middleware): the app's wall time and its database wait,
 * with the statement COUNT and never the statements, ids or URLs — on an /api route, the app page, a redirect, the
 * pages origin, a static miss, and a stream that must keep streaming.
 */
import { describe, expect, it } from 'vitest';
import { attachActor } from '@artifactbin/utils';
import type { Actor } from '@artifactbin/contracts';
import { useAppHarness, request, mintAccountToken as mintToken } from '@/__tests__/harness';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { claimToken, createUser } from '@/lib/accounts';
import { drainPreparedPageWarmups } from '@/lib/publish/prepared/prepared-page.server';
import { pagesOriginFor, pagesSiteFor } from '@/lib/http/pages-origin';
import { createAppServer } from '../server/app';

useAppHarness();

const APP = 'https://app.example.test';
const site = pagesSiteFor('pages.example.test', APP)!;
const SHELL = '<!doctype html><html><head><title>artifactbin</title></head><body><div id="root"></div></body></html>';
const app = () => createAppServer({ indexHtml: async () => SHELL, pagesSite: site });
const TIMING = /^total;dur=\d+(?:\.\d+)?, db;dur=\d+(?:\.\d+)?;desc="\d+ queries"$/;

const as = (url: string, actor: Actor | null, init: RequestInit = {}) => {
  const built = new Request(url, init);
  return actor ? attachActor(built, actor) : built;
};
/** The one header, parsed: its statement count. */
function timing(res: Response): { header: string; queries: number } {
  const all = [...res.headers].filter(([name]) => name.toLowerCase() === 'server-timing');
  expect(all, 'exactly one Server-Timing header').toHaveLength(1);
  const header = res.headers.get('server-timing')!;
  expect(header).toMatch(TIMING);
  expect(header, 'a statement count only').not.toMatch(/select|insert|update|https?:|\/a\//i);
  return { header, queries: Number(/desc="(\d+) queries"/.exec(header)![1]) };
}

async function world() {
  const user = await createUser({ email: 'timing-owner@example.com' });
  const t = await mintToken('timing-owner', user.id);
  await claimToken(user.id, t.token);
  const res = await createRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: '<h1>Timed</h1>', visibility: 'private' } }));
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  await drainPreparedPageWarmups();
  const actor: Actor = { credential: 'session', userId: user.id, email: 'timing-owner@example.com', emailVerified: true };
  return { id, actor };
}

describe('Server-Timing', () => {
  it('rides an /api route once, with the statements it issued', async () => {
    const w = await world();
    const res = await app().request(as(`${APP}/api/my/people`, w.actor));
    expect(res.status).toBe(200);
    expect(timing(res).queries).toBeGreaterThan(0);
  });

  it('rides a refusal and a miss under /api, which touch no table', async () => {
    const unauthorized = await app().request(`${APP}/api/my/people`);
    expect(unauthorized.status).toBe(401);
    expect(timing(unauthorized).queries).toBeGreaterThanOrEqual(0);
    const missing = await app().request(`${APP}/api/nothing-is-served-here`);
    expect(missing.status).toBe(404);
    timing(missing);
  });

  it('rides the app page of a document, the app\'s own pages, and a redirect', async () => {
    const w = await world();
    const server = app();
    const page = await server.request(as(`${APP}/a/${w.id}`, w.actor, { headers: { accept: 'text/html' } }));
    expect(page.status).toBe(200);
    expect(timing(page).queries).toBeGreaterThan(0);
    const shell = await server.request(`${APP}/login`, { headers: { accept: 'text/html' } });
    timing(shell);
    // The apex exchange 302s to the document's origin: headers of a redirect are immutable and must still carry it.
    const src = /<iframe data-mx-document-frame="" src="([^"]+)"/.exec(await page.text())![1]!.replaceAll('&amp;', '&');
    const redirect = await server.request(src);
    expect(redirect.status).toBe(302);
    timing(redirect);
  });

  it('keeps the phases a route reports itself, in the same one header', async () => {
    const w = await world();
    const res = await app().request(as(`${APP}/a/${w.id}/download`, w.actor));
    expect(res.status).toBe(200);
    const header = res.headers.get('server-timing')!;
    expect([...res.headers].filter(([name]) => name.toLowerCase() === 'server-timing')).toHaveLength(1);
    expect(header).toMatch(/\w+;dur=[\d.]+, .*total;dur=[\d.]+, db;dur=[\d.]+;desc="\d+ queries"$/);
    expect(header.match(/total;dur/g)).toHaveLength(1);
  });

  it('rides the document served on its own pages origin', async () => {
    const w = await world();
    const server = app();
    const page = await server.request(as(`${APP}/a/${w.id}`, w.actor, { headers: { accept: 'text/html' } }));
    const src = /<iframe data-mx-document-frame="" src="([^"]+)"/.exec(await page.text())![1]!.replaceAll('&amp;', '&');
    const exchanged = await server.request(src);
    const cookie = /afbin_pages=([^;]+)/.exec(exchanged.headers.get('set-cookie')!)![1]!;
    const doc = await server.request(exchanged.headers.get('location')!, { headers: { cookie: `afbin_pages=${cookie}` } });
    expect(doc.status).toBe(200);
    expect(new URL(exchanged.headers.get('location')!).origin).toBe(pagesOriginFor(w.id, site));
    timing(doc);
  });

  it('leaves the live SSE stream streaming: the header leaves with the first event, the stream stays open', async () => {
    const w = await world();
    const abort = new AbortController();
    const res = await app().request(as(`${APP}/api/my/people/events`, w.actor, { signal: abort.signal }));
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    timing(res);
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(new TextDecoder().decode(first.value)).toBe('data: {}\n\n');
    // Still open: nothing ended it, only the client's abort does.
    const pending = await Promise.race([reader.read().then(() => 'ended'), new Promise((resolve) => setTimeout(() => resolve('open'), 150))]);
    expect(pending).toBe('open');
    abort.abort();
  });
});
