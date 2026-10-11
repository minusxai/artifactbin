/**
 * THE READER'S LIGHT/DARK PICK REACHES EVERY DOCUMENT THEY OPEN, FROM THE FIRST PAINT. The app's toggle stores one
 * preference (`mx_theme`, lib/story-runtime/reader-mode chooseTheme) that the app origin's server reads: the app page
 * draws the frame's ground in the picked mode and the frame's first URL carries it, so the document on its own origin
 * is served in that mode (its `<html>` and story root) — under its own validator, never another mode's. No pick: the
 * author's mode, exactly as before. The writer's `/edit` address keeps the document's own mode. Through the real app server.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { attachActor } from '@artifactbin/utils';
import type { Actor } from '@artifactbin/contracts';
import { useAppHarness, request, setSession, mintAccountToken as mintToken } from '@/__tests__/harness';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { claimToken, createUser } from '@/lib/accounts';
import { drainPreparedPageWarmups } from '@/lib/publish/prepared/prepared-page.server';
import { pagesSiteFor } from '@/lib/http/pages-origin';
import { createAppServer } from '../server/app';

useAppHarness();
afterEach(() => { setSession(null); });

const APP = 'https://app.example.test';
const site = pagesSiteFor('pages.example.test', APP)!;
const SHELL = '<!doctype html><html><head><title>artifactbin</title></head><body><div id="root"></div></body></html>';
const app = createAppServer({ indexHtml: async () => SHELL, pagesSite: site });

async function world() {
  const user = await createUser({ email: `mxmx_test_pick_${Math.random().toString(36).slice(2, 8)}@example.com` });
  const t = await mintToken('pick', user.id);
  await claimToken(user.id, t.token);
  const actor: Actor = { credential: 'session', userId: user.id, email: user.email!, emailVerified: true };
  const publish = async (markup: string, extra: Record<string, unknown> = {}) => {
    const res = await createRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup, visibility: 'public', ...extra } }));
    expect(res.status, await res.clone().text()).toBe(201);
    const { id } = (await res.json()) as { id: string };
    await drainPreparedPageWarmups();
    return id;
  };
  return { actor, publish };
}

const as = (url: string, actor: Actor | null, init: RequestInit = {}) => { const built = new Request(url, init); return actor ? attachActor(built, actor) : built; };
const unescape = (value: string) => value.replaceAll('&amp;', '&');

/** The app page for `path` with the reader's stored pick (or none): the frame's ground class and its first URL. */
async function appPage(path: string, actor: Actor | null, pick: 'light' | 'dark' | null) {
  const res = await app.request(as(`${APP}${path}`, actor, { headers: { accept: 'text/html', ...(pick ? { cookie: `mx_theme=${pick}` } : {}) } }));
  expect(res.status).toBe(200);
  const html = await res.text();
  const ground = /<div data-mx-framed="" class="([^"]*)">/.exec(html)?.[1] ?? null;
  const src = unescape(/<iframe data-mx-document-frame="" src="([^"]+)"/.exec(html)![1]!);
  return { ground, src };
}

/** Follow the frame's first URL to the document on its own origin (the ticket is spent; a repeat view is redirected to the clean address). */
async function framed(src: string): Promise<{ html: string; url: string; etag: string | null }> {
  let url = src;
  for (let hop = 0; hop < 3; hop++) {
    const res = await app.request(new Request(url, { headers: { accept: 'text/html' } }));
    if (res.status === 302) { url = new URL(res.headers.get('location')!, url).href; continue; }
    expect(res.status).toBe(200);
    return { html: await res.text(), url, etag: res.headers.get('etag') };
  }
  throw new Error('the frame never arrived');
}

const htmlMode = (html: string) => /<html [^>]*class="([^"]*)"/.exec(html)?.[1] ?? null;
const storyMode = (html: string) => /<div [^>]*data-mx-inline-story=""[^>]*class="([^"]*)"/.exec(html)?.[1] ?? null;
/** A frame URL's search without its one-time ticket: what it asks the document's origin for. */
const asked = (src: string) => { const url = new URL(src); url.searchParams.delete('_pt'); return url.search; };
const DOC = '<h1 id="t">Mode probe</h1><p id="p">Words in the document.</p>';

describe('the reader\'s stored pick on a document page', () => {
  it('draws a light document dark from its first byte when the reader picked dark: ground, page and story root', async () => {
    const w = await world();
    const id = await w.publish(DOC, { colorMode: 'light' });
    const page = await appPage(`/a/${id}`, w.actor, 'dark');
    expect(page.ground).toBe('dark');
    const doc = await framed(page.src);
    expect(htmlMode(doc.html)).toBe('dark');
    expect(storyMode(doc.html)).toBe('dark');
  });

  it('keeps the author\'s mode for a reader who never picked', async () => {
    const w = await world();
    const light = await w.publish(DOC, { colorMode: 'light' });
    const dark = await w.publish(DOC, { colorMode: 'dark' });
    for (const [id, mode] of [[light, 'light'], [dark, 'dark']] as const) {
      const page = await appPage(`/a/${id}`, w.actor, null);
      expect(page.ground, mode).toBe(mode);
      const doc = await framed(page.src);
      expect(htmlMode(doc.html), mode).toBe(mode);
      expect(storyMode(doc.html), mode).toBe(mode);
    }
  });

  it('a pick of light applies to a dark document too', async () => {
    const w = await world();
    const id = await w.publish(DOC, { colorMode: 'dark' });
    const page = await appPage(`/a/${id}`, w.actor, 'light');
    expect(page.ground).toBe('light');
    expect(htmlMode((await framed(page.src)).html)).toBe('light');
  });

  it('the one pick follows the reader to every other document they open', async () => {
    const w = await world();
    const first = await w.publish(DOC, { colorMode: 'light' });
    const second = await w.publish('<h1 id="t">Another</h1><p id="p">More words.</p>', { colorMode: 'light' });
    for (const id of [first, second]) {
      const page = await appPage(`/a/${id}`, null, 'dark');
      expect(page.ground, id).toBe('dark');
      expect(htmlMode((await framed(page.src)).html), id).toBe('dark');
    }
  });

  it('the picked page has its own validator: a cached author-mode copy never answers for it', async () => {
    const w = await world();
    const id = await w.publish(DOC, { colorMode: 'light' });
    const plain = await framed((await appPage(`/a/${id}`, null, null)).src);
    const picked = await framed((await appPage(`/a/${id}`, null, 'dark')).src);
    expect(plain.etag).toBeTruthy();
    expect(picked.etag).toBeTruthy();
    expect(picked.etag).not.toBe(plain.etag);
    const revalidated = await app.request(new Request(picked.url, { headers: { accept: 'text/html', 'if-none-match': plain.etag! } }));
    expect(revalidated.status).toBe(200);
    expect(htmlMode(await revalidated.text())).toBe('dark');
  });

  it('a fresh frame URL (a consent grant\'s reload) asks for the picked mode as the drawn frame does', async () => {
    const w = await world();
    const id = await w.publish(DOC, { colorMode: 'light' });
    const fresh = async (pick: string | null) => {
      const res = await app.request(as(`${APP}/api/page/frame/${id}`, w.actor, { headers: pick ? { cookie: `mx_theme=${pick}` } : {} }));
      expect(res.status).toBe(200);
      return asked(((await res.json()) as { src: string }).src);
    };
    const drawnDark = asked((await appPage(`/a/${id}`, w.actor, 'dark')).src);
    const drawnPlain = asked((await appPage(`/a/${id}`, w.actor, null)).src);
    expect(drawnDark).not.toBe(drawnPlain);
    expect(await fresh('dark')).toBe(drawnDark);
    expect(await fresh(null)).toBe(drawnPlain);
  });

  it('the writer\'s /edit address keeps the document\'s own mode, whatever the reader picked', async () => {
    const w = await world();
    const id = await w.publish(DOC, { colorMode: 'light' });
    const page = await appPage(`/a/${id}/edit`, w.actor, 'dark');
    expect(page.ground).toBe('light');
    expect(htmlMode((await framed(page.src)).html)).toBe('light');
  });

  it('ignores anything but light or dark in the stored pick', async () => {
    const w = await world();
    const id = await w.publish(DOC, { colorMode: 'light' });
    const page = await appPage(`/a/${id}`, null, 'sepia' as 'dark');
    expect(page.ground).toBe('light');
    expect(htmlMode((await framed(page.src)).html)).toBe('light');
  });
});
