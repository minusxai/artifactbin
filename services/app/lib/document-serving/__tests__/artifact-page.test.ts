/**
 * THE ARTIFACT PAGE'S ANSWER for a native HTML document, without the server: who gets an answer (public and unlisted
 * for anyone, private for its owner alone, one uniform 404 otherwise), when the answer carries the document's frame
 * (only the HTML door, which passes the pages site), what that frame names, that the document's source never rides
 * along, and the JSON door's cache policy and node validator. The app page (server/app) only draws this answer.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { mintAccountToken, setSession, useAppHarness } from '@/__tests__/harness';
import { createArtifact, setMetadataFor } from '@/lib/artifacts';
import { createUser, identityForUser } from '@/lib/accounts';
import { GUEST_TICKET, PAGES_TICKET_PARAM, pagesOriginFor, pagesSiteFor } from '@/lib/http/pages-origin';
import { artifactPageAnswer, artifactPageResponse, readableApp } from '@/lib/document-serving';

useAppHarness();
const APP = 'https://app.example.test';
const site = pagesSiteFor('pages.example.test', APP);
const MARKER = 'only-in-the-source-7f3a';
const SOURCE = `<!doctype html><html><head><title>Head title</title></head><body><h1>Plan</h1><p>${MARKER}</p></body></html>`;

let session: string | null = null;
beforeEach(() => { session = null; setSession(() => (session ? { user: { id: session } } : null)); });

/** Rows are created as every publish creates them: by the owner's account token. */
async function world() {
  const owner = (await createUser({ email: 'mxmx_test_page_owner@example.com' })).id;
  const stranger = (await createUser({ email: 'mxmx_test_page_stranger@example.com' })).id;
  const token = await mintAccountToken('page-owner', owner);
  const make = (visibility: 'public' | 'unlisted' | 'private', title: string | null = 'Quarterly plan', meta: Record<string, unknown> = {}, tokenId: string | null = token.id) =>
    createArtifact(tokenId, owner, { format: 'html', title, description: 'What we will do', source: SOURCE, meta, visibility });
  return { owner, stranger, make };
}
const ask = (id: string, query = '', headers: Record<string, string> = {}) => new Request(`${APP}/a/${id}${query}`, { headers });
const framed = (id: string, query = '', headers: Record<string, string> = {}) => artifactPageAnswer(ask(id, query, headers), id, { pages: site });

describe('who is answered', () => {
  it('anyone reads a public or unlisted document; only its owner reads a private one; everyone else gets the same 404', async () => {
    const w = await world();
    const [pub, unlisted, secret] = await Promise.all([w.make('public'), w.make('unlisted'), w.make('private')]);
    expect((await framed(pub.id)).status).toBe(200);
    expect((await framed(unlisted.id)).status).toBe(200);
    const refused = await framed(secret.id);
    expect(refused).toEqual({ status: 404, body: { error: 'not_found' } });
    session = w.stranger;
    expect(await framed(secret.id)).toEqual(refused);
    session = w.owner;
    expect((await framed(secret.id)).status).toBe(200);
  });

  // A row's creating token admits its holder, but an account-owned row may have no creating token (token_id NULL),
  // and a reader with no token has `tokenId: null` too: holdsCreatingToken (lib/artifacts) never matches a null token.
  it('refuses a private document with no creating token to a guest and a stranger', async () => {
    const w = await world();
    const secret = await w.make('private', 'Imported plan', {}, null);
    expect(await framed(secret.id)).toEqual({ status: 404, body: { error: 'not_found' } });
    session = w.stranger;
    expect(await framed(secret.id)).toEqual({ status: 404, body: { error: 'not_found' } });
    expect((await artifactPageResponse(ask(secret.id), secret.id)).status).toBe(404);
  });

  it('answers a malformed or missing id exactly like a private document', async () => {
    for (const id of ['nope!', '../x', 'Zz99Zz99']) expect(await framed(id), id).toEqual({ status: 404, body: { error: 'not_found' } });
  });

  it('readableApp applies the same rule to app metadata', async () => {
    const w = await world();
    const [pub, secret] = await Promise.all([w.make('public'), w.make('private')]);
    expect((await readableApp(ask(pub.id), pub.id))?.id).toBe(pub.id);
    expect(await readableApp(ask(secret.id), secret.id)).toBeNull();
    expect(await readableApp(ask('nope!'), 'nope!')).toBeNull();
    session = w.owner;
    expect((await readableApp(ask(secret.id), secret.id))?.id).toBe(secret.id);
  });
});

describe('the document frame', () => {
  it('for a guest on a public or unlisted document: its own origin with the guest marker, its raw address and its card', async () => {
    const w = await world();
    for (const visibility of ['public', 'unlisted'] as const) {
      const row = await w.make(visibility);
      const answer = await framed(row.id);
      const origin = pagesOriginFor(row.id, site);
      expect(answer.reader, visibility).toEqual({ mode: 'compiled' });
      expect(answer.frame, visibility).toMatchObject({
        src: `${origin}/?${PAGES_TICKET_PARAM}=${encodeURIComponent(GUEST_TICKET)}`,
        contentUrl: `/a/${row.id}/raw`,
        title: 'Quarterly plan',
        colorMode: 'light',
        head: { title: 'Quarterly plan', description: 'What we will do' },
      });
      expect(answer.frame!.head.image).toMatch(new RegExp(`^${APP}/a/${row.id}/export\\?mode=card&v=1&r=`));
      expect((answer.body as { surface: { framedOrigin?: string } }).surface.framedOrigin).toBe(origin);
    }
  });

  it('for the owner of a private document: a one-time ticket in place of the guest marker', async () => {
    const w = await world();
    const row = await w.make('private');
    session = w.owner;
    const src = new URL((await framed(row.id)).frame!.src);
    expect(src.origin).toBe(pagesOriginFor(row.id, site));
    const ticket = src.searchParams.get(PAGES_TICKET_PARAM);
    expect(ticket).toBeTruthy();
    expect(ticket).not.toBe(GUEST_TICKET);
    expect(new URL((await framed(row.id)).frame!.src).searchParams.get(PAGES_TICKET_PARAM)).not.toBe(ticket);
  });

  it('is drawn only by the HTML door: without the pages site there is no frame and no ticket', async () => {
    const w = await world();
    const row = await w.make('public');
    const answer = await artifactPageAnswer(ask(row.id), row.id);
    expect(answer.status).toBe(200);
    expect(answer.frame).toBeUndefined();
    expect(answer.reader).toBeUndefined();
    expect((answer.body as { surface: Record<string, unknown> }).surface).not.toHaveProperty('framedOrigin');
  });

  it('never carries the document\'s source, through either door', async () => {
    const w = await world();
    const row = await w.make('public');
    for (const answer of [await framed(row.id), await artifactPageAnswer(ask(row.id), row.id)]) {
      expect(JSON.stringify(answer)).not.toContain(MARKER);
      expect((answer.body as { surface: Record<string, unknown> }).surface).toMatchObject({ runtime: { title: 'Quarterly plan', data: {} } });
      expect((answer.body as { surface: Record<string, unknown> }).surface).not.toHaveProperty('source');
    }
  });

  it('is named by the source\'s own title when the row has none', async () => {
    const w = await world();
    const row = await w.make('public', null);
    expect((await framed(row.id)).frame).toMatchObject({ title: 'Head title', head: { title: 'Head title' } });
  });

  it('follows the reader\'s own light/dark pick, and only a valid one', async () => {
    const w = await world();
    const row = await w.make('public');
    expect((await framed(row.id, '', { cookie: 'mx_theme=dark' })).frame?.colorMode).toBe('dark');
    expect((await framed(row.id, '', { cookie: 'mx_theme=purple' })).frame?.colorMode).toBe('light');
  });

  it('carries an archived version\'s raw address when one is asked for', async () => {
    const w = await world();
    const row = await w.make('public');
    session = w.owner;
    const answer = await framed(row.id, '?version=1');
    expect(answer.status).toBe(200);
    expect(answer.frame?.contentUrl).toBe(`/a/${row.id}/raw?version=1`);
  });

  it('is not drawn for the untouched starter placeholder', async () => {
    const w = await world();
    const row = await w.make('public', 'Untitled document', { startPlaceholder: true });
    const answer = await framed(row.id);
    expect(answer.status).toBe(200);
    expect(answer.frame).toBeUndefined();
    expect((answer.body as { surface: { starter: boolean } }).surface.starter).toBe(true);
  });
});

describe('the narrow doors', () => {
  it('`?part=kind` answers the format alone; `?part=editor` is retired', async () => {
    const w = await world();
    const row = await w.make('public');
    expect(await artifactPageAnswer(ask(row.id, '?part=kind'), row.id)).toEqual({ status: 200, body: { format: 'html' } });
    expect(await artifactPageAnswer(ask(row.id, '?part=editor'), row.id)).toEqual({ status: 404, body: { error: 'not_found' } });
    const secret = await w.make('private');
    expect(await artifactPageAnswer(ask(secret.id, '?part=kind'), secret.id)).toEqual({ status: 404, body: { error: 'not_found' } });
  });
});

describe('the JSON door\'s caching', () => {
  it('never lets a page answer be stored; a refusal is the uniform JSON 404', async () => {
    const w = await world();
    const [pub, secret] = await Promise.all([w.make('public'), w.make('private')]);
    const ok = await artifactPageResponse(ask(pub.id), pub.id);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(ok.headers.get('etag')).toBeNull();
    const refused = await artifactPageResponse(ask(secret.id), secret.id);
    expect(refused.status).toBe(404);
    expect(await refused.json()).toEqual({ error: 'not_found' });
  });

  it('revalidates the nodes door: a matching tag is an empty 304, and a metadata edit or another role is a new tag', async () => {
    const w = await world();
    const row = await w.make('public');
    const nodes = (headers: Record<string, string> = {}) => artifactPageResponse(ask(row.id, '?part=nodes', headers), row.id);
    const first = await nodes();
    expect(first.status).toBe(200);
    const etag = first.headers.get('etag')!;
    expect(etag).toMatch(/^"[\w-]+"$/);
    expect(first.headers.get('cache-control')).not.toBe('no-store');
    expect(await first.json()).toMatchObject({ editId: row.edit_id, version: 1, nodes: [] });
    expect((await nodes()).headers.get('etag')).toBe(etag);

    const held = await nodes({ 'if-none-match': etag });
    expect(held.status).toBe(304);
    expect(await held.text()).toBe('');
    expect(held.headers.get('etag')).toBe(etag);

    session = w.owner;
    const owners = (await nodes()).headers.get('etag');
    expect(owners).not.toBe(etag);
    expect((await nodes({ 'if-none-match': etag })).status).toBe(200);

    await setMetadataFor(identityForUser(w.owner), row.id, { title: 'Renamed' });
    const edited = await nodes({ 'if-none-match': owners! });
    expect(edited.status).toBe(200);
    expect(edited.headers.get('etag')).not.toBe(owners);
  });

  it('refuses the nodes door to a reader who may not read the document, whatever validator they hold', async () => {
    const w = await world();
    const row = await w.make('private');
    session = w.owner;
    const etag = (await artifactPageResponse(ask(row.id, '?part=nodes'), row.id)).headers.get('etag')!;
    session = null;
    const refused = await artifactPageResponse(ask(row.id, '?part=nodes', { 'if-none-match': etag }), row.id);
    expect(refused.status).toBe(404);
  });
});
