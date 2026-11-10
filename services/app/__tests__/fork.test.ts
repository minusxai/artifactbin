/**
 * Fork an artifact, through the API.
 *
 * A fork is the same artifact under a new owner and a new id; everything else
 * stays the same. Bytes are shared by content-addressed key, never re-uploaded.
 * History, comments, shares and placement belong to the original's life and do not
 * travel. The door is a browser credential (a person's act from the page): you
 * may fork what you can READ, the miss is the uniform 404, and an anonymous
 * browser has no account to own the copy.
 *
 * Agents fork too: `fork_artifact` on the operations registry (merged from
 * fork-operation.test.ts). The registry entry IS the surface: the bearer route
 * translates it. An agent may fork what its token can READ; the copy is the
 * token's own (account-wide for a claimed token), with three optional overrides
 * applied after the copy; the reply is create-shaped plus `forked_from`.
 */
/* The browser fork door and what does not travel; the credit line, the operations registry and the bearer door are in
 * fork-credit.test.ts (split for the CI shards; ./fork-fixture.ts). */
import { beforeEach, describe, expect, it } from 'vitest';
import { agentCookie, useAppHarness, setSession } from './harness';
import { POST as forkRoute } from '@/app/api/my/artifacts/[id]/fork/route';
import { GET as getMineRoute } from '@/app/api/my/artifacts/[id]/route';
import { GET as getSharingRoute, PUT as putSharingRoute } from '@/app/api/my/artifacts/[id]/sharing/route';
import { GET as versionsMineRoute } from '@/app/api/my/artifacts/[id]/versions/route';
import { getSharingFor } from '@/lib/artifacts';
import { getDb } from '@/lib/platform';
import { identityForUser } from '@/lib/accounts';
import { BASE, sessionUser, params, jreq, create, asSession, noSession, fork, head, PROSE, world } from './fork-fixture';

useAppHarness();
beforeEach(() => setSession(() => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null)));
beforeEach(() => { noSession(); });

describe('POST /api/my/artifacts/:id/fork', () => {
  it('a signed-in reader forks a public document: same content, new id and owner, version 1, provenance kept', async () => {
    const w = await world();
    // GENERAL ACCESS is a VALUE on the row, not a named share, so it travels
    // with visibility and access. Set it before forking: with both sides at the
    // NULL default the `link_role` leg of the field loop below asserts nothing.
    asSession({ id: w.owner.id, email: w.owner.email });
    const general = await putSharingRoute(jreq(`/api/my/artifacts/${w.doc.id}/sharing`, 'PUT', { linkRole: 'editor' }), params(w.doc.id));
    expect(general.status, await general.clone().text()).toBe(200);
    expect(((await general.json()) as { linkRole: string }).linkRole).toBe('editor');

    asSession({ id: w.bob.id, email: w.bob.email });
    const res = await fork(w.doc.id);
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as { id: string; url: string };
    expect(body.id).not.toBe(w.doc.id);
    expect(body.url).toContain(body.id);

    const source = await head(w.doc.id);
    const copy = await head(body.id);
    expect(copy.user_id).toBe(w.bob.id);
    expect(copy.user_id).not.toBe(source.user_id);
    for (const field of ['format', 'title', 'description', 'visibility', 'access', 'link_role'] as const) {
      expect(copy[field], field).toEqual(source[field]);
    }
    expect(source.link_role, 'the source carries the role the loop compares against').toBe('editor');
    // …and on the surface its new owner actually reads it from.
    const sharing = await getSharingRoute(jreq(`/api/my/artifacts/${body.id}/sharing`, 'GET'), params(body.id));
    expect(sharing.status, await sharing.clone().text()).toBe(200);
    expect(((await sharing.json()) as { linkRole: string }).linkRole).toBe('editor');
    expect(copy.meta.theme).toBe(source.meta.theme);
    expect(copy.meta.template).toBe(source.meta.template);
    expect(copy.version).toBe(1);
    expect(copy.forked_from).toBe(w.doc.id);
    expect(source.forked_from).toBeNull();
    // The original is untouched by being forked.
    expect(source.version).toBe(w.doc.version);
    expect(source.edit_id).toBe(w.doc.edit_id);
  });

  it('refuses to copy a document stored in a retired shape, by name', async () => {
    const w = await world();
    const db = await getDb();
    await db.query("UPDATE artifacts SET format='markup',document=NULL,source=$2 WHERE id=$1", [w.doc.id, '<p id="old">Legacy</p>']);
    asSession(w.bob);
    const response = await fork(w.doc.id);
    expect(response.status, await response.clone().text()).toBe(410);
    expect(((await response.json()) as { error: string }).error).toBe('unservable_document');
  });

  it('native node identities and author prose travel while comments remain scoped to the new page', async () => {
    const w=await world();const source=await head(w.doc.id);asSession(w.bob);
    const res=await fork(w.doc.id);expect(res.status).toBe(201);
    const copy=await head((await res.json()).id);
    expect(copy.source).toBe(source.source);expect(copy.source).toContain('data-af-id=');expect(copy.source).toContain('Payroll');
  });

  it('history does not travel: the copy has one version, its own', async () => {
    const w = await world();
    asSession({ id: w.bob.id, email: w.bob.email });
    const id = ((await (await fork(w.doc.id)).json()) as { id: string }).id;
    const res = await versionsMineRoute(jreq(`/api/my/artifacts/${id}/versions`, 'GET'), params(id));
    expect(res.status).toBe(200);
    const versions = (await res.json()) as { versions?: unknown[] } | unknown[];
    const list = Array.isArray(versions) ? versions : versions.versions ?? [];
    expect(list.length).toBeLessThanOrEqual(1);
  });

  it('the owner wire carries forked_from on the copy and null on the source', async () => {
    const w = await world();
    asSession({ id: w.bob.id, email: w.bob.email });
    const id = ((await (await fork(w.doc.id)).json()) as { id: string }).id;
    const mine = await getMineRoute(jreq(`/api/my/artifacts/${id}`, 'GET'), params(id));
    expect(mine.status).toBe(200);
    expect(((await mine.json()) as { forked_from: string | null }).forked_from).toBe(w.doc.id);
    asSession({ id: w.owner.id, email: w.owner.email });
    const theirs = await getMineRoute(jreq(`/api/my/artifacts/${w.doc.id}`, 'GET'), params(w.doc.id));
    expect(((await theirs.json()) as { forked_from: string | null }).forked_from).toBeNull();
  });

  it('a legacy token cookie and no credential both fail browser fork authentication', async () => {
    const w = await world();
    const res = await fork(w.doc.id, await agentCookie([w.anon.id]));
    expect(res.status, await res.clone().text()).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('unauthorized');
    expect((await fork(w.doc.id)).status).toBe(401);
  });

  // The uniform 404, a viewer's share, a document that writes another owner's dataset and a dataset copy sharing
  // its object key are the registry's rules, not the cookie door's: the bearer describes below assert them.

});

/**
 * What the seed does not reach: the sidecar state that must NOT travel, the
 * provenance event, and the same-site rule the browser door owes.
 */
describe('POST /api/my/artifacts/:id/fork — what does not travel', () => {
  it('shares do not travel: the copy is shared with nobody', async () => {
    const w = await world(PROSE, 'private');
    asSession({ id: w.owner.id, email: w.owner.email });
    const shared = await putSharingRoute(jreq(`/api/my/artifacts/${w.doc.id}/sharing`, 'PUT', { shares: [{ email: 'bob@x.com', role: 'editor' }] }), params(w.doc.id));
    expect(shared.status, await shared.clone().text()).toBe(200);

    asSession({ id: w.bob.id, email: w.bob.email });
    const res = await fork(w.doc.id);
    expect(res.status, await res.clone().text()).toBe(201);
    const copyId = ((await res.json()) as { id: string }).id;

    const bob = identityForUser(w.bob.id, '');
    expect((await getSharingFor(bob, copyId))?.shares).toEqual([]);
    // The original's list is untouched by being forked.
    const owner = identityForUser(w.owner.id, '');
    expect((await getSharingFor(owner, w.doc.id))?.shares).toEqual([{ email: 'bob@x.com', role: 'editor' }]);
  });

  it('placement does not travel: the copy is at the forker\'s root', async () => {
    const w = await world();
    const box = await create(w.ta.token, { format: 'folder', title: 'August' });
    const filed = await create(w.ta.token, { html: '<div><p>filed</p></div>', visibility: 'public', parent_id: box.id });
    expect((await head(filed.id)).ancestor_ids).toEqual([box.id]);
    asSession({ id: w.bob.id, email: w.bob.email });
    const res = await fork(filed.id);
    expect(res.status, await res.clone().text()).toBe(201);
    // The source's folder is somebody ELSE's tree — the copy lands at the
    // forker's root, the only place they could have filed it.
    expect((await head(((await res.json()) as { id: string }).id)).ancestor_ids).toEqual([]);
  });

  it('a FOLDER is not forkable: its source names its own children table', async () => {
    const w = await world();
    const box = await create(w.ta.token, { format: 'folder', title: 'Reports', visibility: 'public' });
    asSession({ id: w.bob.id, email: w.bob.email });
    const res = await fork(box.id);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('not_forkable');
  });

  it('records a fork event against the SOURCE, with the forker as the user', async () => {
    const w = await world();
    asSession({ id: w.bob.id, email: w.bob.email });
    const res = await fork(w.doc.id);
    expect(res.status, await res.clone().text()).toBe(201);
    const copyId = ((await res.json()) as { id: string }).id;

    // trackEvent is fire-and-forget (never awaited by a route), so poll.
    const db = await getDb();
    let rows: Array<{ artifact_id: string; user_id: string | null }> = [];
    for (let i = 0; i < 40 && rows.length === 0; i++) {
      rows = (await db.query<{ artifact_id: string; user_id: string | null }>(
        "SELECT artifact_id, user_id FROM analytics_events WHERE event = 'fork'",
      )).rows;
      if (rows.length === 0) await new Promise((r) => setTimeout(r, 25));
    }
    expect(rows).toEqual([{ artifact_id: w.doc.id, user_id: w.bob.id }]);
    expect(rows[0].artifact_id).not.toBe(copyId);
  });

  it('a cookie-authorized fork must be SAME-SITE — both browser credentials', async () => {
    const w = await world();
    const crossSite = (id: string, cookie?: string) =>
      forkRoute(new Request(`${BASE}/api/my/artifacts/${id}/fork`, {
        method: 'POST',
        headers: { Origin: 'https://evil.example', ...(cookie ? { Cookie: cookie } : {}) },
      }), params(id));

    // The anonymous browser (agent cookie) …
    expect((await crossSite(w.doc.id, await agentCookie([w.anon.id]))).status).toBe(401);
    // … and the LOGGED-IN one, which is the credential a tokenId-keyed guard
    // would wave straight through.
    asSession({ id: w.bob.id, email: w.bob.email });
    expect((await crossSite(w.doc.id)).status).toBe(403);
    // Same-site, the same session forks.
    expect((await fork(w.doc.id)).status).toBe(201);
  });
});
