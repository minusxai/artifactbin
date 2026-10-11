/**
 * A DOCUMENT IS REVALIDATED, NOT RE-SENT. The document on its own origin answers with a strong ETag and
 * `Cache-Control: private, no-cache`, and `If-None-Match` is a 304 before anything is rendered; the node and editor
 * doors of the app page's JSON do the same. A change of reader, role, consent, edit, build or theme changes the tag;
 * nothing is ever shared between readers. Brotli on the document's origin, as on the app page. Through the real app server.
 */
import zlib from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachActor } from '@artifactbin/utils';
import type { Actor } from '@artifactbin/contracts';
import { useAppHarness, request, setSession, mintAccountToken as mintToken } from '@/__tests__/harness';
import { observedRequest } from '@/__tests__/conditional-request';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { PUT as putRoute } from '@/app/api/artifacts/[id]/route';
import { POST as grantRoute } from '@/app/api/trust/route';
import { GET as artifactPage } from '@/app/api/page/artifact/[id]/route';
import { claimToken, createUser } from '@/lib/accounts';
import { drainPreparedPageWarmups } from '@/lib/publish/prepared/prepared-page.server';
import * as serve from '@/lib/publish/prepared/serve.server';
import { pagesOriginFor, pagesSiteFor } from '@/lib/http/pages-origin';
import { getDb, measureQueries } from '@/lib/platform';
import { snapshotStore } from '@/lib/publish/prepared/snapshots.server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createAppServer } from '../server/app';

const build = vi.hoisted(() => ({ id: null as string | null }));
vi.mock('@/lib/compiled-page/build.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/compiled-page/build.server')>();
  return { ...actual, loadCompilerBuild: () => { const real = actual.loadCompilerBuild(); return build.id ? { ...real, id: build.id } : real; } };
});

useAppHarness();
afterEach(() => { build.id = null; setSession(null); vi.restoreAllMocks(); });

const APP = 'https://app.example.test';
const site = pagesSiteFor('pages.example.test', APP)!;
const SHELL = '<!doctype html><html><head><title>artifactbin</title></head><body><div id="root"></div></body></html>';
const app = createAppServer({ indexHtml: async () => SHELL, pagesSite: site });
const PLOTLY = 'https://cdn.plot.ly';
const BODY = '<h1 id="top">A plan</h1>' + '<p id="p">The quick brown fox jumps over the lazy dog, and then does it again for good measure. </p>'.repeat(40);

async function world() {
  const user = await createUser({ email: `mxmx_test_reval_${Math.random().toString(36).slice(2, 8)}@example.com` });
  const t = await mintToken('reval', user.id);
  await claimToken(user.id, t.token);
  const actor: Actor = { credential: 'session', userId: user.id, email: user.email!, emailVerified: true };
  const publish = async (markup: string, visibility = 'public', extra: Record<string, unknown> = {}) => {
    const res = await createRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup, visibility, ...extra } }));
    expect(res.status, await res.clone().text()).toBe(201);
    const { id } = (await res.json()) as { id: string };
    await drainPreparedPageWarmups();
    return id;
  };
  const edit = async (id: string, markup: string, extra: Record<string, unknown> = {}) => {
    const res = await putRoute(await observedRequest(`/api/artifacts/${id}`, { method: 'PUT', token: t.token, json: { markup, ...extra } }), { params: Promise.resolve({ id }) });
    expect(res.status, await res.clone().text()).toBe(200);
    await drainPreparedPageWarmups();
  };
  return { user, token: t, actor, publish, edit };
}

const as = (url: string, actor: Actor | null, init: RequestInit = {}) => { const built = new Request(url, init); return actor ? attachActor(built, actor) : built; };
/** The pages cookie the frame's first URL (the app page's ticket) exchanges for: a signed-in reader's, or the guest's (none). */
async function pagesCookie(id: string, actor: Actor | null, appCookie: string | null = null): Promise<string | null> {
  const page = await app.request(as(`${APP}/a/${id}`, actor, { headers: { accept: 'text/html', ...(appCookie ? { cookie: appCookie } : {}) } }));
  const src = /<iframe data-mx-document-frame="" src="([^"]+)"/.exec(await page.text())![1]!.replaceAll('&amp;', '&');
  const exchanged = await app.request(src);
  const value = /__Host-afbin_pages=([^;]+)/.exec(exchanged.headers.get('set-cookie') ?? '')?.[1];
  return value ? `__Host-afbin_pages=${value}` : null;
}
/** The frame's first URL (the ticket-bearing request) the app page draws for `actor`. */
async function frameSrc(id: string, actor: Actor | null): Promise<string> {
  const page = await app.request(as(`${APP}/a/${id}`, actor, { headers: { accept: 'text/html' } }));
  return /<iframe data-mx-document-frame="" src="([^"]+)"/.exec(await page.text())![1]!.replaceAll('&amp;', '&');
}
const read = (id: string, headers: Record<string, string> = {}, init: RequestInit = {}) =>
  app.request(`${pagesOriginFor(id, site)}/`, { headers: { accept: 'text/html', ...headers }, ...init });
const tagOf = (res: Response): string => res.headers.get('etag')!;

describe('the document on its own origin', () => {
  it('answers with a strong ETag and private revalidation, and a repeat view is a 304 under a kilobyte that renders nothing', async () => {
    const w = await world();
    const id = await w.publish(BODY);
    const first = await read(id);
    expect(first.status).toBe(200);
    const tag = tagOf(first);
    expect(tag).toMatch(/^"[A-Za-z0-9_-]{22}"$/);
    expect(first.headers.get('cache-control')).toBe('private, no-cache');
    expect(first.headers.get('vary')).toMatch(/Accept-Encoding/i);
    const html = await first.text();
    expect(html).toContain('A plan');

    const compiled = vi.spyOn(serve, 'compiledPageFor');
    const second = await read(id, { 'if-none-match': tag });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
    expect(second.headers.get('etag')).toBe(tag);
    expect(second.headers.get('cache-control')).toBe('private, no-cache');
    const wire = [...second.headers].reduce((sum, [name, value]) => sum + name.length + value.length + 4, 0);
    expect(wire).toBeLessThan(1024);
    expect(compiled, 'a 304 renders nothing').not.toHaveBeenCalled();
    // The validator is not a promise about other tags: anything else gets the page.
    const other = await read(id, { 'if-none-match': '"someone-elses-tag-000"' });
    expect(other.status).toBe(200);
    expect(compiled).toHaveBeenCalledTimes(1);
    expect(await other.text()).toBe(html);
    // HEAD answers the same validator, no body.
    const head = await read(id, {}, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(tagOf(head)).toBe(tag);
  });

  it('answers a 304 with fewer queries than the page it stands for', async () => {
    const w = await world();
    const id = await w.publish(BODY);
    const tag = tagOf(await read(id));
    await getDb();
    const full = await measureQueries(async () => (await read(id)).text());
    const revalidated = await measureQueries(async () => { const res = await read(id, { 'if-none-match': tag }); expect(res.status).toBe(304); });
    expect(revalidated.stats.count).toBeLessThanOrEqual(full.stats.count);
    expect(revalidated.stats.count).toBeLessThan(25);
  });

  it('changes the tag with the reader: another account, the same account in another role, and a guest', async () => {
    const w = await world();
    const id = await w.publish(BODY, 'public');
    const guest = tagOf(await read(id));
    const owner = tagOf(await read(id, { cookie: (await pagesCookie(id, w.actor))! }));
    const stranger = await createUser({ email: 'mxmx_test_reval_stranger@example.com' });
    const strangerActor: Actor = { credential: 'session', userId: stranger.id, email: stranger.email!, emailVerified: true };
    const reader = tagOf(await read(id, { cookie: (await pagesCookie(id, strangerActor))! }));
    expect(new Set([guest, owner, reader]).size).toBe(3);
    // The reader's tag is theirs alone: it does not answer for the owner, the guest or anyone else.
    for (const [who, headers] of [['owner', { cookie: (await pagesCookie(id, w.actor))! }], ['guest', {}]] as const) {
      expect((await read(id, { ...headers, 'if-none-match': reader })).status, who).toBe(200);
    }
    // The same reader, a different role on the document: the link now grants edit. Nothing about the version moved.
    const strangerCookie = (await pagesCookie(id, strangerActor))!;
    const { updateSharingFor } = await import('@/lib/artifacts');
    await updateSharingFor({ tokenId: w.token.id, userId: w.user.id }, id, { linkRole: 'editor' });
    const asEditor = await read(id, { cookie: strangerCookie, 'if-none-match': reader });
    expect(asEditor.status).toBe(200);
    expect(tagOf(asEditor)).not.toBe(reader);
  });

  it('changes the tag with the role the reader holds, though nothing of the document or its link moved: a named share', async () => {
    const w = await world();
    const id = await w.publish(BODY, 'public');
    const stranger = await createUser({ email: 'mxmx_test_reval_shared@example.com' });
    const actor: Actor = { credential: 'session', userId: stranger.id, email: stranger.email!, emailVerified: true };
    const cookie = (await pagesCookie(id, actor))!;
    const viewer = tagOf(await read(id, { cookie }));
    const { updateSharingFor } = await import('@/lib/artifacts');
    await updateSharingFor({ tokenId: w.token.id, userId: w.user.id }, id, { shares: [{ email: stranger.email!, role: 'editor' }] });
    const editor = await read(id, { cookie, 'if-none-match': viewer });
    expect(editor.status).toBe(200);
    expect(tagOf(editor)).not.toBe(viewer);
    expect((await read(id, { cookie, 'if-none-match': tagOf(editor) })).status).toBe(304);
  });

  it('settles who is asking before it answers a 304: a ticket-bearing request is never a 304 for a different viewer', async () => {
    const w = await world();
    const id = await w.publish(BODY, 'public');
    const stranger = await createUser({ email: 'mxmx_test_reval_ticket_stranger@example.com' });
    const strangerActor: Actor = { credential: 'session', userId: stranger.id, email: stranger.email!, emailVerified: true };
    const mine = await app.request(await frameSrc(id, w.actor));
    expect(mine.status).toBe(200);
    const ownerTag = tagOf(mine);
    const ownerCookie = mine.headers.get('set-cookie')!.split(';')[0]!;
    // The owner's validator on the stranger's ticket: the stranger is who is asking, so the page is sent, and their session set.
    const theirs = await app.request(await frameSrc(id, strangerActor), { headers: { 'if-none-match': ownerTag } });
    expect(theirs.status).toBe(200);
    expect(tagOf(theirs)).not.toBe(ownerTag);
    expect(theirs.headers.get('set-cookie')).toMatch(/^__Host-afbin_pages=/);
    // …and on a guest's frame, even with the owner's cookie held: nobody is asking, the owner's tag answers for nothing, the cookie goes.
    const guest = await app.request(await frameSrc(id, null), { headers: { 'if-none-match': ownerTag, cookie: ownerCookie } });
    expect(guest.status).toBe(200);
    expect(tagOf(guest)).not.toBe(ownerTag);
    expect(guest.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    // A spent ticket replayed with someone else's validator and no cookie of its own is nobody's page too.
    const spent = await frameSrc(id, w.actor);
    expect((await app.request(spent)).status).toBe(200);
    const replay = await app.request(spent, { headers: { 'if-none-match': ownerTag } });
    expect(replay.status).toBe(200);
    expect(tagOf(replay)).not.toBe(ownerTag);
    // The same viewer's own validator is still a 304 — and the session the ticket buys is set on it all the same.
    const again = await app.request(await frameSrc(id, w.actor), { headers: { 'if-none-match': ownerTag } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
    expect(again.headers.get('set-cookie')).toMatch(/^__Host-afbin_pages=[A-Za-z0-9_-]{40,}/);
  });

  it('changes the tag with what the reader trusts: a reader who allowed the declared hosts once', async () => {
    const w = await world();
    const id = await w.publish(`<Helmet><meta name="csp-script" content="${PLOTLY}" /></Helmet><h1>Chart</h1>`, 'public');
    const before = await read(id, { cookie: (await pagesCookie(id, null))! ?? '' });
    const granted = await grantRoute(request('/api/trust', { method: 'POST', json: { artifactId: id, grant: 'once' }, origin: 'same' }));
    expect(granted.status, await granted.clone().text()).toBe(200);
    const trust = /((?:__Host-)?afbin_trust=[^;]+)/.exec(granted.headers.get('set-cookie') ?? '')![1]!;
    const after = await read(id, { cookie: (await pagesCookie(id, null, trust))! });
    expect(before.headers.get('content-security-policy')).not.toContain(PLOTLY);
    expect(after.headers.get('content-security-policy')).toContain(PLOTLY);
    expect(tagOf(after)).not.toBe(tagOf(before));
    // The old tag is not an answer for the reader who now trusts more.
    expect((await read(id, { cookie: (await pagesCookie(id, null, trust))!, 'if-none-match': tagOf(before) })).status).toBe(200);
  });

  it('changes the tag with an edit, and with the theme', async () => {
    const w = await world();
    const id = await w.publish(BODY);
    const v1 = tagOf(await read(id));
    await w.edit(id, `${BODY}<p id="more">One more paragraph.</p>`);
    const res = await read(id, { 'if-none-match': v1 });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('One more paragraph.');
    const v2 = tagOf(res);
    expect(v2).not.toBe(v1);
    expect((await read(id, { 'if-none-match': v2 })).status).toBe(304);
    await w.edit(id, `${BODY}<p id="more">One more paragraph.</p>`, { theme: 'industry' });
    const themed = await read(id, { 'if-none-match': v2 });
    expect(themed.status).toBe(200);
    expect(tagOf(themed)).not.toBe(v2);
  });

  it('changes the tag when the data the page starts from is recomputed, and keeps it while the guest snapshot is the one it was rendered with', async () => {
    const w = await world();
    const fixtures = path.resolve(process.cwd(), '../../scripts/fixtures/page-speed');
    const sales = await w.publish('', 'public', { markup: undefined, dataset: readFileSync(path.join(fixtures, 'sales.csv'), 'utf8'), title: 'Perf sales' });
    const id = await w.publish(readFileSync(path.join(fixtures, 'dashboard.jsx'), 'utf8').replaceAll('{{sales}}', sales), 'public', { template: 'dashboard' });
    // The cold path answers within the served-results budget and stores the guest snapshot either way. Whether its rows made
    // it into that answer is a race with the budget, not something a validator could name: it carries none and stays uncached.
    const cold = await read(id);
    expect(cold.headers.get('etag')).toBeNull();
    expect(cold.headers.get('cache-control')).toBe('no-store');
    let first = cold;
    for (const end = Date.now() + 10_000; Date.now() < end && !(await first.clone().text()).includes('744,503');) { await new Promise((r) => setTimeout(r, 100)); first = await read(id); }
    expect(await first.clone().text()).toContain('744,503');
    // The next one finds the stored snapshot and carries a tag.
    const tag = tagOf(await read(id));
    expect((await read(id, { 'if-none-match': tag })).status).toBe(304);
    const db = await getDb();
    const stored = (await db.query<{ plan_key: string; inputs_key: string }>('SELECT plan_key, inputs_key FROM data_snapshots WHERE artifact_id = $1', [id])).rows[0]!;
    const key = { artifactId: id, slot: 'head' as const, planKey: stored.plan_key, inputsKey: stored.inputs_key };
    const held = (await snapshotStore.get(key))!;
    // A revalidation lands: the same rows, computed later. The page is rendered with a different snapshot, so a different tag.
    await snapshotStore.put({ ...held.snapshot, computedAt: held.snapshot.computedAt + 5 });
    const recomputed = await read(id, { 'if-none-match': tag });
    expect(recomputed.status).toBe(200);
    expect(tagOf(recomputed)).not.toBe(tag);
    expect((await read(id, { 'if-none-match': tagOf(recomputed) })).status).toBe(304);
  });

  it('changes the tag with the build the page runs on', async () => {
    const w = await world();
    const id = await w.publish(BODY);
    const tag = tagOf(await read(id));
    build.id = 'f'.repeat(16);
    const other = await read(id, { 'if-none-match': tag });
    expect(other.status).toBe(200);
    expect(tagOf(other)).not.toBe(tag);
    build.id = null;
    expect((await read(id, { 'if-none-match': tag })).status).toBe(304);
  });

  it('changes the tag with the query string, which the page starts from', async () => {
    const w = await world();
    const id = await w.publish('<Helmet><Value name="region" type="string" default="north" /></Helmet><h1>Region {$region}</h1>');
    const plain = tagOf(await read(id));
    const asked = await app.request(`${pagesOriginFor(id, site)}/?$region=west`, { headers: { accept: 'text/html', 'if-none-match': plain } });
    expect(asked.status).toBe(200);
    expect(tagOf(asked)).not.toBe(plain);
  });

  it('never revalidates a capture or a version the exporter photographs: those stay uncached', async () => {
    const w = await world();
    const id = await w.publish(BODY);
    const { mintExportKey } = await import('@/lib/platform');
    const res = await app.request(`${pagesOriginFor(id, site)}/?chrome=0&key=${encodeURIComponent(mintExportKey(id))}`, { headers: { accept: 'text/html' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('brotli on the document\'s origin', () => {
  it('answers a client that takes it with brotli, the same bytes decoded, and the tag of that representation', async () => {
    const w = await world();
    const id = await w.publish(BODY);
    const plain = await read(id);
    const identity = await plain.text();
    expect(plain.headers.get('content-encoding')).toBeNull();
    const br = await read(id, { 'accept-encoding': 'gzip, br' });
    expect(br.headers.get('content-encoding')).toBe('br');
    expect(br.headers.get('vary')).toMatch(/Accept-Encoding/i);
    const wire = Buffer.from(await br.arrayBuffer());
    expect(wire.byteLength).toBeLessThan(identity.length / 3);
    expect(zlib.brotliDecompressSync(wire).toString()).toBe(identity);
    // One validator per representation, and either answers for the page.
    expect(tagOf(br)).not.toBe(tagOf(plain));
    for (const tag of [tagOf(br), tagOf(plain)]) {
      const again = await read(id, { 'accept-encoding': 'br', 'if-none-match': tag });
      expect(again.status).toBe(304);
      expect(again.headers.get('content-encoding')).toBeNull();
      // The 304 names the body the client holds.
      expect(again.headers.get('etag')).toBe(tag);
    }
  });

  it('sends identity to a client that refuses brotli or takes only gzip', async () => {
    const w = await world();
    const id = await w.publish(BODY);
    for (const accept of ['gzip', 'br;q=0, gzip', 'identity']) {
      const res = await read(id, { 'accept-encoding': accept });
      expect(res.headers.get('content-encoding'), accept).toBeNull();
    }
  });
});

describe('the app page\'s node and editor doors', () => {
  type Who = { id: string; email: string } | null;
  const door = (id: string, part: string, who: Who, headers: Record<string, string> = {}) => {
    setSession(who ? { user: { id: who.id, email: who.email } } : null);
    return artifactPage(request(`/api/page/artifact/${id}?part=${part}`, { headers }), { params: Promise.resolve({ id }) });
  };
  const outsider = async () => createUser({ email: 'mxmx_test_reval_out@example.com' });

  for (const part of ['nodes', 'editor']) {
    it(`?part=${part} is revalidated with a tag that changes with the edit and the build, and answers 304 without preparing the page`, async () => {
      const w = await world();
      const id = await w.publish(BODY, 'private');
      const first = await door(id, part, w.user);
      expect(first.status).toBe(200);
      const tag = tagOf(first);
      expect(tag).toMatch(/^"[A-Za-z0-9_-]{22}"$/);
      expect(first.headers.get('cache-control')).toBe('private, no-cache');
      const again = await door(id, part, w.user, { 'if-none-match': tag });
      expect(again.status).toBe(304);
      expect(await again.text()).toBe('');
      expect(again.headers.get('etag')).toBe(tag);
      await w.edit(id, `${BODY}<p id="more">One more paragraph.</p>`);
      const changed = await door(id, part, w.user, { 'if-none-match': tag });
      expect(changed.status).toBe(200);
      expect(tagOf(changed)).not.toBe(tag);
      build.id = 'e'.repeat(16);
      const rebuilt = await door(id, part, w.user, { 'if-none-match': tagOf(changed) });
      expect(rebuilt.status).toBe(200);
    });
  }

  it('never lets a tag stand in for access: a reader who may not read, or may not edit, gets what they always got', async () => {
    const w = await world();
    const stranger = await outsider();
    const id = await w.publish(BODY, 'private');
    const nodes = tagOf(await door(id, 'nodes', w.user));
    const editor = tagOf(await door(id, 'editor', w.user));
    expect((await door(id, 'nodes', stranger, { 'if-none-match': nodes })).status).toBe(404);
    expect((await door(id, 'editor', stranger, { 'if-none-match': editor })).status).toBe(404);
    expect((await door(id, 'nodes', null, { 'if-none-match': nodes })).status).toBe(404);
    // A public document: a stranger reads the nodes, may not edit, and the writer's editor tag does not open the editor.
    const open = await w.publish(BODY, 'public');
    const openEditor = tagOf(await door(open, 'editor', w.user));
    expect((await door(open, 'editor', stranger, { 'if-none-match': openEditor })).status).toBe(404);
    expect((await door(open, 'nodes', stranger)).status).toBe(200);
  });
});
