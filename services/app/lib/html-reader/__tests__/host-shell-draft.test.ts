/**
 * `mountDraft` (lib/html-reader/host-shell, /af/host.js) through the real app server: a host page at the app's own origin
 * frames the reader's own draft on its draft origin; the bridge relays nothing of the app; a refusal keeps its code.
 * The server's half (POST /api/page/drafts, the draft origin) is services/app/__tests__/page-drafts.test.ts.
 */
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';
import { attachActor } from '@artifactbin/utils';
import type { Actor } from '@artifactbin/contracts';
import { pagesSite } from '@/lib/http';
import { resetDrafts } from '@/lib/page-drafts';
import { mountDraft, HostShellError } from '../host-shell';
import { STORY_FRAME_BRIDGE_MESSAGE } from '../contract';
import { createAppServer } from '@/server/app';
import { mintAccountToken, useAppHarness } from '@/__tests__/harness';

const site = pagesSite();
const APP = site.app;
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><body></body></html>', pagesSite: site });
useAppHarness();
afterEach(() => resetDrafts());
const session = (who: { userId: string | null; email: string | null }): Actor =>
  ({ credential: 'session', sessionId: `draft-${who.userId}`, userId: who.userId!, email: who.email ?? '', emailVerified: true });
const PAGE = '<!doctype html><html><head><link rel="af-dataset" data-af-name="orders" href="./orders.csv"></head><body><h1>Orders</h1></body></html>';
const FILES = [{ path: 'orders.csv', bytes: new TextEncoder().encode('region,amount\nWest,10\n') }];

describe('mountDraft (/af/host.js)', () => {
  function hostPage(reader: Actor | null, origin = APP) {
    const dom = new JSDOM('<!doctype html><html><body><main id="host"></main></body></html>', { url: `${origin}/shell` });
    const win = dom.window as unknown as Window & typeof globalThis;
    win.fetch = (async (input: string | URL, init?: RequestInit) => {
      const request = new Request(new URL(String(input), APP), { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers).entries()), origin } });
      return app.request(reader ? attachActor(request, reader) : request);
    }) as typeof fetch;
    return { win, container: win.document.getElementById('host')! };
  }

  it('frames the draft on its own origin, reads nothing of the app through the bridge, and offers no writes', async () => {
    const owner = await mintAccountToken('draft_owner');
    const { win, container } = hostPage(session(owner));
    const mounted = await mountDraft(container, { html: PAGE, files: FILES, title: 'Orders' }, win);
    expect(new URL(mounted.origin).hostname.startsWith('draft-')).toBe(true);
    expect(mounted.frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation allow-downloads');
    expect(mounted.frame.title).toBe('Orders');
    expect(new URL(mounted.frame.src).origin).toBe(mounted.origin);
    const posted: Array<{ payload: Record<string, unknown> }> = [];
    const frameWindow = mounted.frame.contentWindow!;
    frameWindow.postMessage = ((message: never) => { posted.push(message); }) as Window['postMessage'];
    const send = (payload: unknown, key?: string) => win.dispatchEvent(new win.MessageEvent('message', { data: { type: STORY_FRAME_BRIDGE_MESSAGE, ...(key ? { key } : {}), payload }, origin: mounted.origin, source: frameWindow }));
    send({ kind: 'hello' });
    const attach = posted.find((entry) => (entry as unknown as { payload: { kind: string } }).payload.kind === 'attach') as unknown as { key: string };
    send({ kind: 'ready', nonce: 'n'.repeat(16) }, attach.key);
    send({ kind: 'fetch', call: 1, path: '/api/my/artifacts', method: 'GET', headers: {}, body: null }, attach.key);
    await expect.poll(() => posted.some((entry) => entry.payload?.kind === 'fetch-result')).toBe(true);
    expect(posted.find((entry) => entry.payload?.kind === 'fetch-result')!.payload).toMatchObject({ error: 'refused' });
    mounted.setMode('dark');
    mounted.destroy();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('relays a statement naming a default: link to the draft\'s own door only when this mount allowed live data', async () => {
    const owner = await mintAccountToken('draft_owner');
    const html = '<html><head><link rel="af-dataset" data-af-name="wh" href="default:warehouse"></head><body></body></html>';
    for (const liveSql of [false, true]) {
      const { win, container } = hostPage(session(owner));
      const mounted = await mountDraft(container, { html, files: [], liveSql }, win);
      expect({ connections: mounted.connections, liveSql: mounted.liveSql }).toEqual({ connections: ['wh'], liveSql });
      const posted: Array<{ payload: Record<string, unknown> }> = [];
      const frameWindow = mounted.frame.contentWindow!;
      frameWindow.postMessage = ((message: never) => { posted.push(message); }) as Window['postMessage'];
      const send = (payload: unknown, key?: string) => win.dispatchEvent(new win.MessageEvent('message', { data: { type: STORY_FRAME_BRIDGE_MESSAGE, ...(key ? { key } : {}), payload }, origin: mounted.origin, source: frameWindow }));
      send({ kind: 'hello' });
      const attach = posted.find((entry) => entry.payload?.kind === 'attach') as unknown as { key: string; payload: { id: string } };
      expect(attach.payload.id).toBe(`draft:${new URL(mounted.origin).hostname.split('.')[0]}`);
      send({ kind: 'ready', nonce: 'n'.repeat(16) }, attach.key);
      send({ kind: 'fetch', call: 1, path: `/api/artifacts/${encodeURIComponent(attach.payload.id)}/sql`, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql: 'select 1 from wh.t', params: {} }) }, attach.key);
      await expect.poll(() => posted.some((entry) => entry.payload?.kind === 'fetch-result')).toBe(true);
      const result = posted.find((entry) => entry.payload?.kind === 'fetch-result')!.payload as { status: number; body: string };
      // Allowed: the draft's door answers (this test install has no default connection); not allowed: the relay refuses.
      if (liveSql) expect({ status: result.status, error: JSON.parse(result.body).error }).toEqual({ status: 404, error: 'dataset_not_found' });
      else expect(result.status).toBe(403);
      mounted.destroy();
    }
  });

  it('rejects with the refusal the embedding app can show', async () => {
    const owner = await mintAccountToken('draft_owner');
    const { win, container } = hostPage(session(owner));
    const failure = await mountDraft(container, { html: PAGE, files: [] }, win).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HostShellError);
    expect(failure).toMatchObject({ code: 'unresolved_draft_files', message: expect.stringContaining('orders.csv') });
    const signedOut = hostPage(null);
    expect(await mountDraft(signedOut.container, { html: '<p>x</p>', files: [] }, signedOut.win).catch((error: unknown) => (error as HostShellError).code)).toBe('unauthorized');
  });
});

