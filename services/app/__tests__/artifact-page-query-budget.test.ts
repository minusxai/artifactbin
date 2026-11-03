import {nativeHtml} from '@/__tests__/native-html-fixture';
/**
 * WHAT A PAGE VIEW COSTS THE DATABASE: the app page for a document (`GET /a/<id>`, the HTML door: documentPreparation
 * admits the row, artifactPageAnswer draws its chrome). Production is Postgres behind a small pool, so a view asks each
 * thing once: the viewer's role is resolved once per request (admission and the chrome share one memo of access
 * facts), and the author, likes, follows and open-annotation count arrive in one statement.
 *
 * Each case records the statements a view issues after a first, warming view and pins the budget; the page's
 * values (role, likes, follow, author, annotations) are pinned beside it, from a world where every one of them is
 * non-trivial, so the savings cannot come from skipping the work.
 */
import { ACTOR_HEADER, type Actor } from '@artifactbin/contracts';
import { signActor } from '@artifactbin/utils';
import { describe, expect, it } from 'vitest';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { createUser, ensureUsername, mintToken } from '@/lib/accounts';
import { link } from '@/lib/social';
import { getDb } from '@/lib/platform';
import { recordStatements, useAppHarness } from '@/__tests__/harness';
import { BOOTSTRAP_ID, createAppServer } from '@/server/app';

useAppHarness();

/**
 * The statements a view may issue, per door. Observed on this fixture before the shared memo and the one social
 * statement: the JSON door 17 / 6 / 8 (signed-in reader / anonymous / owner), the HTML door 21 / 7 / 12. The HTML door
 * also mints the frame's ticket (three statements for a signed-in reader) and names the canonical address.
 */
const BUDGET = {
  json: { signedIn: 7, anonymous: 3, owner: 5 },
  html: { signedIn: 11, anonymous: 4, owner: 9 },
};

const SECRET = 'vitest-actor-secret-0000000000000000';
const app = createAppServer({ actorSecret: SECRET, indexHtml: async () => '<!doctype html><head><title>x</title></head><body><div id="root"></div></body>' });
const session = (user: { id: string; email: string | null }): Actor => ({ credential: 'session', userId: user.id, email: user.email!, emailVerified: true });
const actorHeaders = (actor: Actor | null): Record<string, string> => (actor ? { [ACTOR_HEADER]: signActor(actor, SECRET) } : {});
const inlined = (html: string) => {
  const m = new RegExp(`<script type="application/json" id="${BOOTSTRAP_ID}">([\\s\\S]*?)</script>`).exec(html);
  return m ? JSON.parse(m[1]!) as { artifact: Record<string, any> } : null;
};
type Door = 'json' | 'html';
/** One page view through `door`: its status and the page's answer (the HTML door's inlined copy of it). */
async function view(door: Door, id: string, actor: Actor | null, search = ''): Promise<{ status: number; page: Record<string, any> | null }> {
  if (door === 'json') {
    const response = await app.request(`/api/page/artifact/${id}${search}`, { headers: actorHeaders(actor) });
    return { status: response.status, page: response.status === 200 ? await response.json() as Record<string, any> : null };
  }
  const response = await app.request(`/a/${id}${search}`, { headers: { accept: 'text/html', ...actorHeaders(actor) } });
  return { status: response.status, page: inlined(await response.text())?.artifact ?? null };
}

const userKindReads = (sql: string[]) => sql.filter((text) => /SELECT kind FROM users/i.test(text)).length;

/**
 * An author with a handle and a face; a public page with three likes (the viewer's among them) and two open comment
 * threads; the viewer follows the author, and so does one other account (the author following the viewer back is not
 * the author's follower count).
 */
async function world() {
  const db = await getDb();
  const author = await ensureUsername(await createUser({ email: 'mxmx_test_budget_author@example.com' }));
  await db.query("UPDATE users SET image_key = 'avatars/budget-author.webp' WHERE id = $1", [author.id]);
  const viewer = await ensureUsername(await createUser({ email: 'mxmx_test_budget_viewer@example.com' }));
  const fan = await createUser({ email: 'mxmx_test_budget_fan@example.com' });
  const other = await createUser({ email: 'mxmx_test_budget_other@example.com' });
  const token = await mintToken('budget-author', author.id);
  const mk = async (title: string) => {
    const response = await createArtifactRoute(new Request('http://localhost:3000/api/artifacts', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token.token}` }, body: JSON.stringify({ title, html: nativeHtml(`<h1>${title}</h1><p>Body.</p>`), visibility: 'public' }) }));
    expect(response.status, await response.clone().text()).toBe(201);
    return (await response.json() as { id: string }).id;
  };
  const doc = await mk('Budget');
  const anonymousDoc = await mk('Anonymous budget');
  for (const id of [doc, anonymousDoc]) {
    for (const liker of [viewer, fan, other]) await link(liker.id, 'like', id);
    // Two open threads count; a resolved one, a deleted one and a reply do not.
    await db.query("INSERT INTO annotations (id, artifact_id, body, author_kind, status) VALUES ($1, $2, 'one', 'human', 'open'), ($3, $2, 'two', 'human', 'open'), ($4, $2, 'done', 'human', 'resolved'), ($5, $2, 'gone', 'human', 'open')", [`${id}_a1`, id, `${id}_a2`, `${id}_a3`, `${id}_a4`]);
    await db.query("INSERT INTO annotations (id, artifact_id, root_id, body, author_kind, status) VALUES ($1, $2, $3, 'reply', 'human', 'open')", [`${id}_r1`, id, `${id}_a1`]);
    await db.query('UPDATE annotations SET deleted_at = now() WHERE id = $1', [`${id}_a4`]);
  }
  await link(viewer.id, 'follow', author.id);
  await link(fan.id, 'follow', author.id);
  await link(author.id, 'follow', viewer.id);
  return { author, viewer, doc, anonymousDoc };
}

for (const door of ['json', 'html'] as const) describe(`a page view through the ${door.toUpperCase()} door`, () => {
  it('for a signed-in reader who is not the owner: the role once, the social chrome in one statement', async () => {
    const w = await world();
    const actor = session(w.viewer);
    expect((await view(door, w.doc, actor)).status).toBe(200);
    const { value, sql, count } = await recordStatements(() => view(door, w.doc, actor));
    console.info('[budget] %s door, signed-in non-owner page view: statements=%d user-kind reads=%d', door, count, userKindReads(sql));
    expect(value.status).toBe(200);
    const page = value.page!;
    expect(page.role).toBe('viewer');
    expect(page.kind).toBe('account');
    expect(page.like).toEqual({ liked: true, count: 3 });
    expect(page.follow).toEqual({ userId: w.author.id, following: true, count: 2 });
    expect(page.surface.author).toEqual({ username: w.author.username, id: w.author.id, image: expect.stringContaining(`/${w.author.id}`), forkedFrom: null });
    expect(page.surface.openAnnotations).toBe(2);
    expect(page.surface).not.toHaveProperty('hasInvitedUsers');
    expect(count).toBeLessThanOrEqual(BUDGET[door].signedIn);
    expect(userKindReads(sql)).toBeLessThanOrEqual(1);
  });

  it('for an anonymous reader: no role facts, the social chrome in one statement', async () => {
    const w = await world();
    // A query string keeps the anonymous shell cache out of it: this is the view it would have to render.
    const { value, count } = await recordStatements(() => view(door, w.anonymousDoc, null, '?budget=1'));
    console.info('[budget] %s door, anonymous page view: statements=%d', door, count);
    expect(value.status).toBe(200);
    const page = value.page!;
    expect(page.role).toBe('viewer');
    expect(page.like).toEqual({ liked: false, count: 3 });
    expect(page.follow).toEqual({ userId: w.author.id, following: false, count: 2 });
    expect(page.surface.author).toMatchObject({ username: w.author.username, id: w.author.id });
    expect(page.surface.openAnnotations).toBe(2);
    expect(count).toBeLessThanOrEqual(BUDGET[door].anonymous);
  });

  it('for the owner: ownership short-circuits the role, nothing to follow', async () => {
    const w = await world();
    const actor = session(w.author);
    expect((await view(door, w.doc, actor)).status).toBe(200);
    const { value, count } = await recordStatements(() => view(door, w.doc, actor));
    console.info('[budget] %s door, owner page view: statements=%d', door, count);
    expect(value.status).toBe(200);
    const page = value.page!;
    expect(page.role).toBe('owner');
    expect(page.like).toEqual({ liked: false, count: 3 });
    expect(page.follow).toBeNull();
    expect(page.surface.author).toMatchObject({ username: w.author.username, id: w.author.id });
    expect(page.surface.openAnnotations).toBe(2);
    expect(page.surface.hasInvitedUsers).toBe(false);
    expect(count).toBeLessThanOrEqual(BUDGET[door].owner);
  });

  it('answers a page nobody liked, by an author nobody follows, with zeros', async () => {
    const w = await world();
    const db = await getDb();
    await db.query("UPDATE relations SET deleted_at = now() WHERE object_id IN ($1, $2)", [w.doc, w.author.id]);
    await db.query("UPDATE annotations SET status = 'resolved' WHERE artifact_id = $1", [w.doc]);
    const page = (await view(door, w.doc, session(w.viewer))).page!;
    expect(page.like).toEqual({ liked: false, count: 0 });
    expect(page.follow).toEqual({ userId: w.author.id, following: false, count: 0 });
    expect(page.surface.openAnnotations).toBe(0);
  });

  it('still refuses a private page to a signed-in stranger with the uniform 404, and admits a named share', async () => {
    const w = await world();
    const db = await getDb();
    await db.query("UPDATE artifacts SET visibility = 'private' WHERE id = $1", [w.doc]);
    expect((await view(door, w.doc, session(w.viewer))).status).toBe(404);
    expect((await view(door, w.doc, null)).status).toBe(404);
    expect((await view(door, w.doc, session(w.author))).status).toBe(200);
    await db.query("INSERT INTO artifact_shares (artifact_id, email, role) VALUES ($1, $2, 'editor')", [w.doc, w.viewer.email]);
    const shared = await view(door, w.doc, session(w.viewer));
    expect(shared.status).toBe(200);
    expect(shared.page!.role).toBe('editor');
  });
});
