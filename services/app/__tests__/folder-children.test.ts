/**
 * A FOLDER'S CHILDREN ARE A TABLE THE DATAFLOW READS — `ref_<folderId>` in a
 * document's `<Query>`, computed on the server for ONE viewer.
 *
 * This is the power feature under the folder page rather than the folder page
 * itself: the page is app chrome now (web/pages/Folder, over `folderPageFor`),
 * and what survives here is that ANY document may list a folder's contents —
 * `<Query name="q">{`select * from ref_<folderId>`}</Query>` bound with
 * `<Files data="$q" />` — filtered and ordered however its author likes.
 *
 * Both callers project the SAME selection (lib/folders `selectChildren`), so
 * the rules pinned here — which rows a viewer gets, and who is told the
 * numbers — are the rules the page obeys too. What only this half decides is
 * the THUMBNAIL, and that is asserted here because only this half has one.
 *
 * The viewer legs go at `childrenTableFor` directly: the viewer is the whole
 * subject, and driving four of them through a document's query endpoint would
 * be testing the transport four times and the ACL once. ONE end-to-end leg
 * below proves the wiring — a real document, a real `<Query>`, the real
 * endpoint. Plan: ~/projects/artifactbin-folders.md.
 */
import { describe, expect, it } from 'vitest';
import { agentCookie, request, useAppHarness } from './harness';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { GET as queryGet } from '@/app/a/[id]/query/route';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { STORY_DATA_EVENT } from '@/lib/story-runtime/contract';
import { getArtifactById, updateSharing } from '@/lib/artifacts';
import { childrenTableFor } from '@/lib/folders';
import { subscribeToArtifact } from '@/lib/story/live';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';

useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const j = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, any> });
async function owner(name = 'owner') {
  const t = await mintToken(name);
  const u = await createUser({ email: `${name}@example.com` });
  await claimToken(u.id, t.token);
  return { token: t.token, tokenId: t.id, userId: u.id, email: `${name}@example.com`, cookie: await agentCookie([t.id]) };
}
const create = async (token: string, body: Record<string, unknown>) => {
  const r = await j(await createRoute(request('/api/artifacts', { method: 'POST', json: body, token })));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
};

async function world() {
  const o = await owner();
  const f = await create(o.token, { format: 'folder', title: 'Reports', visibility: 'public' });
  const pub = await create(o.token, { markup: '<h1>Board update</h1>', title: 'Board update', visibility: 'public', parent_id: f.id });
  const priv = await create(o.token, { markup: '<h1>Hiring plan</h1>', title: 'Hiring plan', visibility: 'private', parent_id: f.id });
  const sub = await create(o.token, { format: 'folder', title: 'Q3', visibility: 'public', parent_id: f.id });
  // UNLISTED means listed nowhere: readable by link, absent from every listing a stranger sees.
  const quiet = await create(o.token, { markup: '<h1>Quiet</h1>', title: 'Quiet', visibility: 'unlisted', parent_id: f.id });
  return { o, f, pub, priv, sub, quiet };
}

/** The table as one viewer reads it. */
const tableFor = async (folderId: string, viewer: { userId: string | null; tokenId: string | null; email: string | null }) =>
  childrenTableFor((await getArtifactById(folderId))!, viewer);

/** Nobody at all: no account, no token, no share. */
const STRANGER = { userId: null, tokenId: null, email: null };

describe('the children table', () => {
  it('a stranger on a public folder sees its PUBLIC children only (never unlisted, never private), with no numbers and a thumbnail', async () => {
    const { f, pub, sub } = await world();
    const rows = (await tableFor(f.id, STRANGER)).rows as any[];
    expect(rows.map((x) => x.id).sort()).toEqual([pub.id, sub.id].sort());
    const doc = rows.find((x) => x.id === pub.id);
    expect(doc).toMatchObject({ title: 'Board update', format: 'markup', level: 1, visibility: 'public', url: `/a/${pub.id}` });
    expect(doc.thumbnail).toContain(`/a/${pub.id}/export`);
    expect(doc.views).toBeNull();
    expect(doc.sparkline).toBeNull();
    expect(rows.find((x) => x.id === sub.id)).toMatchObject({ format: 'folder', thumbnail: null });
  });

  it('the owner sees every child, with view counts and a sparkline, and no thumbnail for a private one', async () => {
    const { o, f, pub, priv, sub, quiet } = await world();
    const rows = (await tableFor(f.id, { userId: o.userId, tokenId: o.tokenId, email: o.email })).rows as any[];
    expect(rows.map((x) => x.id).sort()).toEqual([pub.id, priv.id, sub.id, quiet.id].sort());
    expect(rows.find((x) => x.id === quiet.id).thumbnail).toContain(`/a/${quiet.id}/export`);
    const p = rows.find((x) => x.id === priv.id);
    // A request the sandboxed frame makes carries no session, so a private
    // child's card would 404 even for its owner. The APP page has no such
    // problem and loads it — the one rule the two projections differ on.
    expect(p.thumbnail).toBeNull();
    expect(typeof p.views).toBe('number');
    expect(typeof p.sparkline).toBe('string');
    expect(typeof rows.find((x) => x.id === pub.id).views).toBe('number');
  });

  /*
   * THE OWNER MAY BE A TOKEN, NOT AN ACCOUNT. `sessionActor` answers an account
   * session as a `viewer` and the AGENT COOKIE as a bare `tokenId`, so a caller
   * that threads only the viewer hands an ANONYMOUS owner the stranger's view
   * of their own listing — no private children, no counts. Found on the dev
   * walk, where every artifact belongs to an unclaimed token.
   */
  it('an anonymous owner sees their OWN folder through its token: the numbers, which a stranger never gets', async () => {
    const t = await mintToken('bare');
    const f = await create(t.token, { format: 'folder', title: 'Mine', visibility: 'unlisted' });
    // One PUBLIC child, so the two viewers see the same row and the only thing
    // that differs is the numbers — which is what this test is about — and one
    // UNLISTED beside it, because an anonymous owner's shelf obeys the listing
    // rule like everyone else's.
    const child = await create(t.token, { markup: '<p>open</p>', title: 'Open', visibility: 'public', parent_id: f.id });
    const quiet = await create(t.token, { markup: '<p>quiet</p>', title: 'Quiet', visibility: 'unlisted', parent_id: f.id });

    const mine = (await tableFor(f.id, { userId: null, tokenId: t.id, email: null })).rows as any[];
    expect(mine.map((x) => x.id).sort()).toEqual([child.id, quiet.id].sort());
    const open = mine.find((x) => x.id === child.id);
    expect(typeof open.views).toBe('number');
    expect(typeof open.sparkline).toBe('string');

    const theirs = (await tableFor(f.id, STRANGER)).rows as any[];
    expect(theirs.map((x) => x.id)).toEqual([child.id]);
    expect(theirs[0].views).toBeNull();
    expect(theirs[0].sparkline).toBeNull();
  });

  /*
   * The BOUNDARY of the read fast path: the listing asks the LINK first and
   * only pays for a share lookup on a row the link does not already open
   * (lib/folders). That is exact — `maxRole` can only raise, and the anonymous
   * ceiling is `viewer`, the rank the read question asks for — and this is the
   * case that would break if it were ever approximated the other way: a
   * private child the link refuses, which a named person must still see.
   */
  it('a person named on a private child sees it in the listing; a signed-in stranger does not', async () => {
    const { o, f, pub, priv, sub } = await world();
    const guest = await createUser({ email: 'guest@example.com' });
    const bystander = await createUser({ email: 'bystander@example.com' });
    await updateSharing(o.userId, priv.id, { shares: [{ email: 'guest@example.com', role: 'viewer' }] });
    const seen = async (u: { id: string; email: string }) =>
      (await tableFor(f.id, { userId: u.id, tokenId: null, email: u.email })).rows.map((r) => r.id).sort();
    expect(await seen(guest)).toEqual([priv.id, pub.id, sub.id].sort());
    expect(await seen(bystander)).toEqual([pub.id, sub.id].sort());
  });

  /**
   * THE WIRING, ONCE, END TO END: a real document declaring a real `<Query>`
   * over a real folder, read through the real endpoint. Everything above is
   * about WHO sees what; this is about the table existing at all — that
   * `validateRefs` admits a folder in a read position, that `data-checks` knows
   * its fixed columns, and that the resolver registers the rows.
   */
  it('a DOCUMENT may list a folder it can read, through its own query endpoint', async () => {
    const { o, f, pub, sub } = await world();
    const doc = await create(o.token, {
      title: 'Index',
      visibility: 'public',
      markup: `<Helmet><Query name="kids">{\`select id, title from ref_${f.id} order by title\`}</Query></Helmet>\n<Files data="$kids" />`,
    });
    const q = JSON.stringify({ values: {}, only: ['kids'] });
    const r = await j(await queryGet(request(`/a/${doc.id}/query?q=${encodeURIComponent(q)}`), params(doc.id)));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    // The anonymous transport, so the STRANGER's view of the folder: its public
    // children only. The document's own visibility opens the endpoint; the
    // folder's ACL decides the rows, and the two are separate questions.
    expect((r.body.tables.kids.rows as any[]).map((x) => x.id).sort()).toEqual([pub.id, sub.id].sort());
  });

  /**
   * THE STREAM FOLLOWS A FOLDER TO ITSELF, and that rule is now STATED rather
   * than inferred.
   *
   * It used to be inferred: a folder's source was a scaffold naming
   * `ref_<own id>`, so `datasetsForDocument` returned its own id and the events
   * route subscribed it as an ordinary dataset. A folder has no source now, so
   * nothing would name it, and an open listing would sit stale until somebody
   * reloaded — the exact regression a later edit to `followDatasets` would
   * reintroduce in silence.
   *
   * Over the real route and a real socketless stream read, because the rule
   * lives in the ROUTE: `childrenTableFor` and `notifyParent` are both fine
   * either way, and the leg below already proves the NOTIFY fires.
   */
  it('the events stream subscribes a folder to its OWN channel, so a child arrives as a data frame', async () => {
    const o = await owner();
    const f = await create(o.token, { format: 'folder', title: 'Live', visibility: 'public' });
    const stream = await eventsRoute(request(`/a/${f.id}/events`), params(f.id));
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    // Drain the opening frame before writing, so what is read after the create
    // cannot be the connect frame arriving late.
    await reader.read();
    await create(o.token, { markup: '<p>new</p>', title: 'New', parent_id: f.id });
    let seen = '';
    const until = Date.now() + 5000;
    while (!seen.includes(`event: ${STORY_DATA_EVENT}`) && Date.now() < until) {
      const chunk = await reader.read();
      if (chunk.done) break;
      seen += decoder.decode(chunk.value as Uint8Array);
    }
    await reader.cancel();
    expect(seen, 'no data frame — the folder is not following its own channel').toContain(`event: ${STORY_DATA_EVENT}`);
    expect(seen).toContain(`"datasets":["${f.id}"]`);
  });

  it('a child created under an open folder wakes the folder\'s own channel', async () => {
    const o = await owner();
    const f = await create(o.token, { format: 'folder', title: 'Live' });
    let woke = 0;
    const unsubscribe = await subscribeToArtifact(f.id, () => { woke += 1; });
    try {
      await create(o.token, { markup: '<p>new</p>', parent_id: f.id });
      const until = Date.now() + 5000;
      while (woke === 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
      expect(woke).toBeGreaterThan(0);
    } finally { await unsubscribe(); }
  });
});
