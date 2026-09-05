/**
 * THE FOLDER PAGE IS APP CHROME, and a folder has NO CONTENT.
 *
 * The listing used to be a document: a two-line scaffold whose `<Query>` read
 * the folder's own children and whose `<Files>` drew them, served through the
 * sandboxed frame every document is served through. Measured on production,
 * that put the listing LAST — shell 0.25 s, frame document 0.98 s, runtime
 * booted 2.59 s, children 2.86 s — for a query the server answers in ~50 ms,
 * behind a runtime an opaque origin cannot cache.
 *
 * So a listing is APP DATA. It is answered by the artifact page endpoint,
 * inlined into the HTML (server/app withBootstrap) and drawn by web/pages
 * Folder.tsx. This file pins that answer: who sees which children, which
 * ancestors are named, what the count counts, and the write door that now
 * refuses content on a row that has none.
 */
import { describe, expect, it } from 'vitest';
import { agentCookie, request, useAppHarness } from './harness';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { GET as pageRoute } from '@/app/api/page/artifact/[id]/route';
import { PUT as putMineRoute, PATCH as patchMineRoute } from '@/app/api/my/artifacts/[id]/route';
import { PUT as putRoute } from '@/app/api/artifacts/[id]/route';
import { POST as editRoute } from '@/app/api/artifacts/[id]/edits/route';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { getArtifactById, updateSharing } from '@/lib/artifacts';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';

useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const j = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, any> });

async function owner(name: string) {
  const t = await mintToken(name);
  const u = await createUser({ email: `${name}@example.com` });
  await claimToken(u.id, t.token);
  return { token: t.token, tokenId: t.id, userId: u.id, email: `${name}@example.com`, cookie: await agentCookie([t.id]) };
}
const create = async (token: string, body: Record<string, unknown>) => {
  const r = await j(await createRoute(request('/api/artifacts', { method: 'POST', json: body, token })));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as Record<string, any>;
};
/** The page endpoint, as one viewer. */
const pageAs = async (id: string, cookie?: string) => j(await pageRoute(request(`/api/page/artifact/${id}`, cookie ? { cookie } : {}), params(id)));

async function world() {
  const o = await owner('folderowner');
  const f = await create(o.token, { format: 'folder', title: 'Reports', visibility: 'public' });
  const pub = await create(o.token, { markup: '<h1>Board update</h1>', title: 'Board update', visibility: 'public', parent_id: f.id });
  const priv = await create(o.token, { markup: '<h1>Hiring plan</h1>', title: 'Hiring plan', visibility: 'private', parent_id: f.id });
  const quiet = await create(o.token, { markup: '<h1>Quiet</h1>', title: 'Quiet', visibility: 'unlisted', parent_id: f.id });
  const sub = await create(o.token, { format: 'folder', title: 'Q3', visibility: 'public', parent_id: f.id });
  return { o, f, pub, priv, quiet, sub };
}

describe('a folder has no content', () => {
  it('is created with an EMPTY source and an empty meta — no scaffold, no compiled sheet', async () => {
    const o = await owner('nocontent');
    const f = await create(o.token, { format: 'folder', title: 'Reports' });
    const row = (await getArtifactById(f.id))!;
    expect(row.format).toBe('folder');
    expect(row.source).toBe('');
    expect(row.content).toBe('');
    expect(row.meta).toEqual({});
    // The create echo must not hand back markup nobody sent.
    expect(f.markup ?? '').toBe('');
  });

  it('refuses content on a replace — a folder is a place, not a document (400 not_editable)', async () => {
    const o = await owner('nowrite');
    const f = await create(o.token, { format: 'folder', title: 'Reports' });
    for (const [door, run] of [
      ['bearer', () => putRoute(request(`/api/artifacts/${f.id}`, { method: 'PUT', json: { markup: '<p>hi</p>' }, token: o.token }), params(f.id))],
      ['session', () => putMineRoute(request(`/api/my/artifacts/${f.id}`, { method: 'PUT', json: { markup: '<p>hi</p>' }, cookie: o.cookie, origin: 'same' }), params(f.id))],
    ] as const) {
      const r = await j(await run());
      expect(r.status, `${door}: ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body.error, door).toBe('not_editable');
    }
    // …and the row is untouched: still a folder, still empty. The bug this
    // replaces changed `format` to 'markup', which orphaned every child (their
    // ancestor_ids named a row that was no longer a folder) and made the id
    // permanently unusable as a parent.
    const row = (await getArtifactById(f.id))!;
    expect(row.format).toBe('folder');
    expect(row.source).toBe('');
  });

  it('refuses the edit protocol on a folder too — the same code, from the same fact', async () => {
    const o = await owner('noedit');
    const f = await create(o.token, { format: 'folder', title: 'Reports' });
    const row = (await getArtifactById(f.id))!;
    const r = await j(await editRoute(request(`/api/artifacts/${f.id}/edits`, {
      method: 'POST', token: o.token,
      json: { edit_id: row.edit_id, old_string: '', new_string: '<p>x</p>' },
    }), params(f.id)));
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.error).toBe('not_editable');
  });

  it('still takes the METADATA a folder has — title, visibility and placement — through PUT', async () => {
    const o = await owner('meta');
    const parent = await create(o.token, { format: 'folder', title: 'Parent' });
    const f = await create(o.token, { format: 'folder', title: 'Reports' });
    const r = await j(await putRoute(request(`/api/artifacts/${f.id}`, {
      method: 'PUT', token: o.token, json: { title: 'Renamed', visibility: 'unlisted', parent_id: parent.id },
    }), params(f.id)));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = (await getArtifactById(f.id))!;
    expect(row.title).toBe('Renamed');
    expect(row.visibility).toBe('unlisted');
    expect(row.ancestor_ids).toEqual([parent.id]);
    expect(row.format).toBe('folder');
  });

  it('renames from the browser through PATCH {title} — metadata-only, no version bump', async () => {
    const o = await owner('rename');
    const f = await create(o.token, { format: 'folder', title: 'Reports' });
    const before = (await getArtifactById(f.id))!;
    const r = await j(await patchMineRoute(request(`/api/my/artifacts/${f.id}`, {
      method: 'PATCH', json: { title: 'Quarterly' }, cookie: o.cookie, origin: 'same',
    }), params(f.id)));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.title).toBe('Quarterly');
    const after = (await getArtifactById(f.id))!;
    expect(after.title).toBe('Quarterly');
    expect(after.version).toBe(before.version);
    // A rename is a rename of a DOCUMENT too — the door is not folder-only.
    const doc = await create(o.token, { markup: '<h1>x</h1>', title: 'Doc' });
    const d = await j(await patchMineRoute(request(`/api/my/artifacts/${doc.id}`, {
      method: 'PATCH', json: { title: 'Doc renamed' }, cookie: o.cookie, origin: 'same',
    }), params(doc.id)));
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect((await getArtifactById(doc.id))!.title).toBe('Doc renamed');
  });

  /*
   * AND THE MIRROR IMAGE, which is worse: `parseContentInput` turns a body of
   * `{"format":"folder"}` with no content into the empty stored state, so a PUT
   * of that shape at a DOCUMENT would blank its source and file it in the
   * folders partition — the same class of loss as the format flip above, with
   * the document's content gone rather than its children. Format is the ROW's
   * on replace, in BOTH directions.
   */
  it('never turns a document INTO a folder — format is the row\'s, whatever the body says', async () => {
    const o = await owner('nodemote');
    const doc = await create(o.token, { markup: '<h1>Real work</h1>', title: 'Doc' });
    const r = await j(await putRoute(request(`/api/artifacts/${doc.id}`, {
      method: 'PUT', token: o.token, json: { format: 'folder' },
    }), params(doc.id)));
    const row = (await getArtifactById(doc.id))!;
    expect(row.format, JSON.stringify(r.body)).toBe('markup');
    expect(row.source).toContain('Real work');
  });

  it('has no document to serve: raw is the uniform 404', async () => {
    const o = await owner('noraw');
    const f = await create(o.token, { format: 'folder', title: 'Reports', visibility: 'public' });
    const r = await rawRoute(request(`/a/${f.id}/raw`), params(f.id));
    expect(r.status).toBe(404);
  });
});

describe('the folder page bootstrap', () => {
  it('answers the OWNER the whole shelf, with the numbers and a card for every linkable child', async () => {
    const { o, f, pub, priv, quiet, sub } = await world();
    const r = await pageAs(f.id, o.cookie);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const folder = r.body.folder;
    expect(folder, 'the page carries a folder block').toBeTruthy();
    expect(folder.id).toBe(f.id);
    expect(folder.title).toBe('Reports');
    expect(folder.trail).toEqual([]);
    expect(folder.rows.map((x: any) => x.id).sort()).toEqual([pub.id, priv.id, quiet.id, sub.id].sort());
    expect(folder.count).toEqual({ documents: 3, folders: 1 });
    // The shelf's own row shape — this is what Shelf takes.
    const doc = folder.rows.find((x: any) => x.id === pub.id);
    expect(doc).toMatchObject({ id: pub.id, title: 'Board update', format: 'markup', visibility: 'public', url: `/a/${pub.id}`, parent_id: f.id });
    expect(typeof doc.version).toBe('number');
    expect(typeof doc.updated_at).toBe('string');
    expect(typeof doc.views).toBe('number');
    expect(typeof doc.sparkline).toBe('string');
    // A PRIVATE child gets a real row on the app page: the shelf loads its card
    // WITH the session, which is the one thing the sandboxed frame could not do.
    expect(folder.rows.find((x: any) => x.id === priv.id)).toMatchObject({ visibility: 'private', title: 'Hiring plan' });
    // A folder is never a document page: the surface it would frame is absent.
    expect(r.body.surface).toBeUndefined();
    expect(r.body.role).toBe('owner');
  });

  it('answers a STRANGER the public children only — never unlisted, never private, and no numbers', async () => {
    const { f, pub, sub } = await world();
    const r = await pageAs(f.id);
    expect(r.status).toBe(200);
    const folder = r.body.folder;
    expect(folder.rows.map((x: any) => x.id).sort()).toEqual([pub.id, sub.id].sort());
    expect(folder.count).toEqual({ documents: 1, folders: 1 });
    for (const row of folder.rows) {
      expect(row.views, 'a stranger is told no numbers').toBeUndefined();
      expect(row.sparkline).toBeUndefined();
    }
  });

  it('answers an EDITOR of the folder the whole shelf, with the numbers', async () => {
    const { o, f, priv } = await world();
    const editor = await owner('foldereditor');
    await updateSharing(o.userId, f.id, { shares: [{ email: editor.email, role: 'editor' }] });
    const r = await pageAs(f.id, editor.cookie);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.role).toBe('editor');
    expect(r.body.folder.rows.map((x: any) => x.id)).toContain(priv.id);
    expect(typeof r.body.folder.rows[0].views).toBe('number');
  });

  it('names only the ancestors THIS viewer may read — an unreadable one is ABSENT, never redacted', async () => {
    const o = await owner('trail');
    const secret = await create(o.token, { format: 'folder', title: 'Secret', visibility: 'private' });
    const open = await create(o.token, { format: 'folder', title: 'Open', visibility: 'public', parent_id: secret.id });
    const leaf = await create(o.token, { format: 'folder', title: 'Leaf', visibility: 'public', parent_id: open.id });
    const mine = await pageAs(leaf.id, o.cookie);
    expect(mine.body.folder.trail.map((c: any) => c.id)).toEqual([secret.id, open.id]);
    const theirs = await pageAs(leaf.id);
    // The private ancestor is simply not there. A crumb saying "a folder you
    // may not see" is the existence oracle the uniform 404 exists to avoid.
    expect(theirs.body.folder.trail.map((c: any) => c.id)).toEqual([open.id]);
    expect(JSON.stringify(theirs.body)).not.toContain(secret.id);
  });

  it('is the uniform 404 for a folder this viewer may not read', async () => {
    const o = await owner('closed');
    const f = await create(o.token, { format: 'folder', title: 'Reports', visibility: 'private' });
    expect((await pageAs(f.id)).status).toBe(404);
    const stranger = await owner('outsider');
    expect((await pageAs(f.id, stranger.cookie)).status).toBe(404);
  });

  it('counts an EMPTY folder honestly and still answers a page', async () => {
    const o = await owner('emptyfolder');
    const f = await create(o.token, { format: 'folder', title: 'Nothing' });
    const r = await pageAs(f.id, o.cookie);
    expect(r.status).toBe(200);
    expect(r.body.folder.rows).toEqual([]);
    expect(r.body.folder.count).toEqual({ documents: 0, folders: 0 });
  });
});
