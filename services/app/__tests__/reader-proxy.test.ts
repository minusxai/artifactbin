/**
 * The reader/owner split (proxy.ts), as a decision rather than as HTTP.
 *
 * The browser half — that the rewritten response really arrives with the
 * sandbox CSP, in an opaque origin — is a browser fact, and lives in
 * scripts/gate-secure-arch.mjs. What belongs here is everything that is a pure
 * function of the request: WHICH paths address a document, WHO gets the shell,
 * and the two rules that keep this file from becoming ordinary middleware —
 * it must never redirect, and it must never set a header (a header set here
 * merges into the rewritten response, and the per-row CSP is the sandbox).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { candidateDocument, createAppServer, servesDocumentDirectly } from '@/server/app';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { createArtifact, updateSharing } from '@/lib/artifacts';
import { mintToken } from '@/lib/tokens';
import { createUser } from '@/lib/users';
import { agentCookie, request, useAppHarness } from './harness';

const BASE = 'http://localhost:3000';

const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({ auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null) }));

useAppHarness();

const readerRequest = (path: string, cookie?: string) => request(path, { cookie });

/** Where this request is actually served from: the rewrite target, or the page. */
/**
 * Who is served what, as the app server decides it (server/app): the id of the
 * document to serve directly, or 'page' when the viewer gets the app.
 */
const servedBy = async (request: Request): Promise<string> => {
  const id = await servesDocumentDirectly(request);
  return id ? `/a/${id}/raw` : 'page';
};

const publish = (
  tokenId: string,
  userId: string | null,
  opts: { format?: 'markup' | 'dataset'; visibility?: 'public' | 'private' } = {},
) => {
  const format = opts.format ?? 'markup';
  return createArtifact(tokenId, userId, {
    format,
    content: format === 'dataset' ? '[]' : '',
    source: format === 'markup' ? '<h1>doc</h1>' : null,
    meta: {},
    title: 'Doc',
    description: null,
    visibility: opts.visibility ?? (userId ? 'private' : 'public'),
  });
};

beforeEach(() => {
  sessionUser.id = '';
  sessionUser.email = '';
});

describe('which paths address a document', () => {
  it('names a document at both artifact addresses and nowhere else', () => {
    expect(candidateDocument('/a/Ab3xK9')).toEqual({ id: 'Ab3xK9' });
    expect(candidateDocument('/@someone/Ab3xK9-title')).toEqual({ id: 'Ab3xK9' });
    expect(candidateDocument('/@someone/reports/2026/Ab3xK9-title')).toEqual({ id: 'Ab3xK9' });
    for (const p of ['/a/not-an-id', '/a/Ab3xK9/raw', '/api/artifacts', '/@someone', '/']) expect(candidateDocument(p), p).toBeNull();
  });

  it('leaves anything that is not a document to the page', async () => {
    for (const path of ['/a/not-an-id', '/a/abc123/raw', '/a/abc123/export', '/@someone', '/@someone/reports']) {
      expect(await servedBy(readerRequest(path)), path).toBe('page');
    }
  });

  it('reads the id out of a pretty URL, however decorated', async () => {
    const t = await mintToken('t');
    const row = await publish(t.id, null);
    for (const path of [
      `/a/${row.id}`,
      `/@someone/${row.id}`,
      `/@someone/${row.id}-a-title`,
      `/@someone/reports/2026/${row.id}-a-title`,
    ]) {
      expect(await servedBy(readerRequest(path)), path).toBe(`/a/${row.id}/raw`);
    }
  });
});

describe('who gets the shell', () => {
  it('serves the DOCUMENT to a reader with no credential — without touching the database', async () => {
    const t = await mintToken('t');
    const row = await publish(t.id, null);
    expect(await servedBy(readerRequest(`/a/${row.id}`))).toBe(`/a/${row.id}/raw`);
  });

  it('serves the SHELL to the account that owns it', async () => {
    const user = await createUser({ email: 'owner@example.com' });
    const t = await mintToken('t', user.id);
    const row = await publish(t.id, user.id);
    sessionUser.id = user.id;
    expect(await servedBy(readerRequest(`/a/${row.id}`))).toBe('page');
  });

  it('serves the SHELL to an anonymous owner holding the token in its cookie', async () => {
    const t = await mintToken('t');
    const row = await publish(t.id, null);
    const cookie = await agentCookie([t.id]);
    expect(await servedBy(readerRequest(`/a/${row.id}`, cookie))).toBe('page');
  });

  it('serves the DOCUMENT to a signed-in NON-owner — no hop, no shell', async () => {
    const owner = await createUser({ email: 'owner@example.com' });
    const other = await createUser({ email: 'other@example.com' });
    const t = await mintToken('t', owner.id);
    const row = await publish(t.id, owner.id, { visibility: 'public' });
    sessionUser.id = other.id;
    expect(await servedBy(readerRequest(`/a/${row.id}`))).toBe(`/a/${row.id}/raw`);
  });

  it('leaves a PRIVATE document to the page for a non-owner, so it 404s rather than leaking', async () => {
    const owner = await createUser({ email: 'owner@example.com' });
    const t = await mintToken('t', owner.id);
    const row = await publish(t.id, owner.id); // owned docs are born private
    sessionUser.id = (await createUser({ email: 'nosy@example.com' })).id;
    expect(await servedBy(readerRequest(`/a/${row.id}`))).toBe('page');
    // …and a pretty URL falls through to the folder listing, not a 404: the
    // pair (404 here, listing there) would be an existence oracle.
    expect(await servedBy(readerRequest(`/@someone/${row.id}-doc`))).toBe('page');
  });

  it('serves the DOCUMENT to a browser whose cookie names some OTHER token', async () => {
    const mine = await mintToken('mine');
    const theirs = await mintToken('theirs');
    const row = await publish(theirs.id, null);
    const cookie = await agentCookie([mine.id]);
    expect(await servedBy(readerRequest(`/a/${row.id}`, cookie))).toBe(`/a/${row.id}/raw`);
  });

  it('leaves an unknown id to the page, so missing and unreadable answer alike', async () => {
    sessionUser.id = (await createUser({ email: 'someone@example.com' })).id;
    expect(await servedBy(readerRequest('/a/zzzzzz'))).toBe('page');
  });

  it('leaves the data tiers alone — a dataset is a value, not a document', async () => {
    const user = await createUser({ email: 'owner@example.com' });
    const t = await mintToken('t', user.id);
    const row = await publish(t.id, user.id, { format: 'dataset', visibility: 'public' });
    sessionUser.id = (await createUser({ email: 'reader@example.com' })).id;
    expect(await servedBy(readerRequest(`/a/${row.id}`))).toBe('page');
  });
});

describe('the two rules the reader/owner split keeps', () => {
  it('NEVER redirects — the shared link is the canonical one, and the reader is served AT it', async () => {
    const t = await mintToken('t');
    const row = await publish(t.id, null);
    const app = createAppServer({ indexHtml: async () => '<!doctype html><div id="root">SPA</div>' });
    for (const path of [`/a/${row.id}`, `/@someone/${row.id}-title`]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('location'), path).toBeNull();
    }
  });

  it('adds NO header of its own to the document — the response IS the sandbox', async () => {
    const t = await mintToken('t');
    const row = await publish(t.id, null);
    const app = createAppServer({ indexHtml: async () => '<!doctype html><div id="root">SPA</div>' });
    const served = await app.request(`http://localhost:3000/a/${row.id}`);
    const direct = await rawRoute(new Request(`http://localhost:3000/a/${row.id}/raw`), { params: Promise.resolve({ id: row.id }) });
    // Header for header, what the reader gets IS what `raw` answered.
    expect([...served.headers.keys()].sort()).toEqual([...direct.headers.keys()].sort());
    expect(served.headers.get('content-security-policy')).toBe(direct.headers.get('content-security-policy'));
  });
});

describe('the exporter', () => {
  it('is left on the PAGE — it names its own render target, and a data tier is not a document', async () => {
    // The headless browser has no session, so without this it would be treated
    // as a reader and handed the document (or, for a data tier, raw JSON) —
    // and /export screenshots a named element on the page.
    const t = await mintToken('t');
    const row = await publish(t.id, null);
    expect(await servedBy(readerRequest(`/a/${row.id}?key=whatever`))).toBe('page');
  });
});

describe('only a markup document IS a document', () => {
  it('leaves every data tier to the page, for a reader with no credential at all', async () => {
    // The fast path that skipped this served a dataset reader its own JSON at
    // the share URL — the page renders a table, a recipe or an image instead.
    const t = await mintToken('t');
    const rows = await Promise.all(['dataset', 'markup'].map((f) => publish(t.id, null, { format: f as 'dataset' | 'markup' })));
    expect(await servedBy(readerRequest(`/a/${rows[0].id}`))).toBe('page');
    expect(await servedBy(readerRequest(`/a/${rows[1].id}`))).toBe(`/a/${rows[1].id}/raw`);
  });
});

describe('a PRIVATE document whose data is LIVE keeps its parent page; a public one fetches for itself', () => {
  /*
   * The served document has its own transport now: a GET of /a/<id>/query
   * under the ANONYMOUS read ACL (lib/story-runtime/document-transport) — the
   * sandboxed top-level document fetches its re-runs with no parent at all.
   * A PRIVATE document answers that GET with the uniform 404 (the document's
   * origin is opaque; it cannot present the session), so a private document
   * that declares a query stays in the shell, where the page — which holds
   * the session — relays. Everything else keeps its top-level paint.
   */
  const withQuery = (ds: string) =>
    `<Helmet><Value name="region" type="string" /><Query name="sales">{\`select 1 from ref_${ds}\`}</Query></Helmet>`
    + '<div><select aria-label="Region" value="$region" options="$sales" /></div>';
  const valuesOnly = '<Helmet><Value name="region" type="string" default="EU" /></Helmet><div><input value="$region" /></div>';

  it('serves the DOCUMENT to a reader of a PUBLIC document that declares a query — it fetches its own re-runs', async () => {
    const t = await mintToken('t');
    const row = await createArtifact(t.id, null, {
      format: 'markup', content: '', source: withQuery('dsX'), meta: {}, title: 'Live', description: null, visibility: 'public',
    });
    expect(await servedBy(readerRequest(`/a/${row.id}`))).toBe(`/a/${row.id}/raw`);
  });

  it('serves the DOCUMENT for an UNLISTED one too — the anonymous GET admits it', async () => {
    const user = await createUser({ email: 'unlistedowner@example.com' });
    const t = await mintToken('t', user.id);
    const row = await createArtifact(t.id, user.id, {
      format: 'markup', content: '', source: withQuery('dsU'), meta: {}, title: 'Live', description: null, visibility: 'unlisted',
    });
    expect(await servedBy(readerRequest(`/a/${row.id}`))).toBe(`/a/${row.id}/raw`);
  });

  it('serves the SHELL to an admitted reader of a PRIVATE document that declares a query — the page relays with the session', async () => {
    const owner = await createUser({ email: 'privowner@example.com' });
    const reader = await createUser({ email: 'privreader@example.com' });
    const t = await mintToken('t', owner.id);
    const row = await createArtifact(t.id, owner.id, {
      format: 'markup', content: '', source: withQuery('dsP'), meta: {}, title: 'Live', description: null, visibility: 'private',
    });
    await updateSharing(owner.id, row.id, { shares: [{ email: 'privreader@example.com', role: 'viewer' }] });
    sessionUser.id = reader.id; sessionUser.email = 'privreader@example.com';
    expect(await servedBy(readerRequest(`/a/${row.id}`))).toBe('page');
  });

  it('serves the DOCUMENT to that same admitted reader when the private document declares NO query — nothing to relay', async () => {
    const owner = await createUser({ email: 'privowner2@example.com' });
    const reader = await createUser({ email: 'privreader2@example.com' });
    const t = await mintToken('t', owner.id);
    const row = await createArtifact(t.id, owner.id, {
      format: 'markup', content: '', source: valuesOnly, meta: {}, title: 'Values', description: null, visibility: 'private',
    });
    await updateSharing(owner.id, row.id, { shares: [{ email: 'privreader2@example.com', role: 'viewer' }] });
    sessionUser.id = reader.id; sessionUser.email = 'privreader2@example.com';
    expect(await servedBy(readerRequest(`/a/${row.id}`))).toBe(`/a/${row.id}/raw`);
  });

  it('gives a named EDITOR the page (editing is a mode of the page), and a named viewer the document', async () => {
    const owner = await createUser({ email: 'pubowner@example.com' });
    const editor = await createUser({ email: 'editor@example.com' });
    const viewer = await createUser({ email: 'viewer@example.com' });
    const t = await mintToken('t', owner.id);
    const row = await createArtifact(t.id, owner.id, {
      format: 'markup', content: '', source: '<div><p>hi</p></div>', meta: {}, title: 'Pub', description: null, visibility: 'public',
    });
    await updateSharing(owner.id, row.id, { shares: [{ email: 'editor@example.com', role: 'editor' }, { email: 'viewer@example.com', role: 'viewer' }] });
    sessionUser.id = editor.id; sessionUser.email = 'editor@example.com';
    expect(await servedBy(readerRequest(`/a/${row.id}`))).toBe('page');
    sessionUser.id = viewer.id; sessionUser.email = 'viewer@example.com';
    expect(await servedBy(readerRequest(`/a/${row.id}`))).toBe(`/a/${row.id}/raw`);
  });

  it('a document of <Value>s alone is served top-level — a bound control moves it and nothing needs the server', async () => {
    const t = await mintToken('t');
    const row = await createArtifact(t.id, null, {
      format: 'markup', content: '', source: valuesOnly, meta: {}, title: 'Values', description: null, visibility: 'public',
    });
    expect(await servedBy(readerRequest(`/a/${row.id}`))).toBe(`/a/${row.id}/raw`);
  });

  it('still serves the DOCUMENT for ordinary prose — the common case keeps its top-level paint', async () => {
    const t = await mintToken('t');
    const row = await publish(t.id, null);
    expect(await servedBy(readerRequest(`/a/${row.id}`))).toBe(`/a/${row.id}/raw`);
  });

  it('the owner keeps the shell either way', async () => {
    const user = await createUser({ email: 'flowowner@example.com' });
    const t = await mintToken('t', user.id);
    const row = await createArtifact(t.id, user.id, {
      format: 'markup', content: '', source: withQuery('dsY'), meta: {}, title: 'Live', description: null, visibility: 'public',
    });
    sessionUser.id = user.id;
    expect(await servedBy(readerRequest(`/a/${row.id}`))).toBe('page');
  });
});
