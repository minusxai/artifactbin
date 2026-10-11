import { describe, expect, it } from 'vitest';
import { useAppHarness, request, setSession, mintAccountToken } from './harness';
import { createUser } from '@/lib/accounts';
import { updateSharingFor, effectiveRole, getArtifactById, membershipState, savedMentionStates } from '@/lib/artifacts';
import { setRelationState } from '@/lib/accounts';
import { POST as publish } from '@/app/api/artifacts/route';
import { GET as pageRoute } from '@/app/api/page/artifact/[id]/route';
import { GET as membersRoute } from '@/app/api/my/artifacts/[id]/members/route';
import { artifactPageAnswer } from '@/lib/serving/artifact-page';
import { refDataForRow } from '@/lib/document-data';
import { preparedPageFor, drainPreparedPageWarmups } from '@/lib/publish/prepared/prepared-page.server';
import { getDb, measureQueries } from '@/lib/platform';
import { pagesSite } from '@/lib/http/pages-origin';

useAppHarness();

/**
 * THE ARTIFACT PAGE'S WEIGHT — bytes on the wire and statements on the database.
 *
 * Measured on a large document (a 500-row table): the answer carried the document's whole node tree twice over
 * (the reader's runtime, then again in the HTML bootstrap), read the artifacts row — document included — twice for
 * its owner, and decided who may read it only after decoding it. The tree is now its own part (`?part=nodes`, fetched
 * by the page once the framed document is up), the owner's "has invited users" is an EXISTS, and a row the viewer may
 * not read is refused from its header. Counting statements and full-row reads, not milliseconds, keeps these stable.
 */
const OWNER = 'mxmx_test_payload_budget_owner@example.com';
const STRANGER = 'mxmx_test_payload_budget_stranger@example.com';

const bigMarkup = (rows: number, extra = '') =>
  `<div data-design="tw" className="px-4 py-8"><h1 id="title">Plan</h1><table><tbody>${Array.from({ length: rows }, (_, i) =>
    `<tr id="r${i}"><td>${i}</td><td><strong>Row ${i}</strong></td><td>Research note ${i}: the module graph hides a cycle through the reader chrome.</td></tr>`).join('')}</tbody></table>${extra}</div>`;

/** Every SQL text the work sent to the database. */
async function sqlOf<T>(work: () => Promise<T>): Promise<{ value: T; sql: string[]; count: number }> {
  const db = await getDb() as unknown as { query: (sql: string, params?: unknown[]) => Promise<unknown> };
  const original = db.query.bind(db);
  const sql: string[] = [];
  db.query = (text: string, params?: unknown[]) => { sql.push(text.replace(/\s+/g, ' ').trim()); return original(text, params); };
  try {
    const { value, stats } = await measureQueries(work);
    return { value, sql, count: stats.count };
  } finally { db.query = original; }
}
/** A statement that loads whole artifact rows — the document column comes with `*`. */
const fullRowReads = (sql: string[]) => sql.filter((text) => /SELECT (artifacts\.)?\*.* FROM artifacts\b/.test(text)).length;

async function ownerWorld(markup = bigMarkup(300)) {
  const owner = await createUser({ email: OWNER });
  const token = await mintAccountToken('owner', owner.id);
  const stranger = await createUser({ email: STRANGER });
  const created = await publish(request('/api/artifacts', { method: 'POST', token: token.token, json: { visibility: 'private', markup, destination: { type: 'personal' } } }));
  expect(created.status).toBe(201);
  const { id } = await created.json() as { id: string };
  await drainPreparedPageWarmups();
  return { owner, stranger, token, id };
}
const as = (user: { id: string } | null, email: string | null) => setSession(user ? { user: { id: user.id, email, emailVerified: true } } as never : null);
const json = (id: string, query = '') => pageRoute(request(`/api/page/artifact/${id}${query}`), { params: Promise.resolve({ id }) });
const framed = (id: string, query = '') => artifactPageAnswer(request(`/api/page/artifact/${id}${query}`), id, { pages: pagesSite() });

describe('the page payload does not carry the document tree', () => {
  it('leaves the node tree out of both doors and keeps the framed runtime to what the page reads', async () => {
    const w = await ownerWorld();
    as(w.owner, OWNER);
    const jsonAnswer = await json(w.id).then((r) => r.json()) as { surface: { runtime: { title: string; data: Record<string, unknown> } & Record<string, unknown> } };
    const whole = JSON.stringify(jsonAnswer);
    const html = await framed(w.id);
    const htmlBytes = JSON.stringify(html.body).length;
    const runtime = ((html.body as { surface: { runtime: { title: string; data: Record<string, unknown> } & Record<string, unknown> } }).surface.runtime);
    // The tree of 300 rows is far larger than anything else in the answer; it is no longer in it.
    expect(whole).not.toContain('"Research note 299');
    expect(htmlBytes).toBeLessThan(6_000);
    expect(runtime.data).not.toHaveProperty('nodes');
    expect(Object.keys(runtime).sort()).toEqual(['data', 'title']);
    expect(Object.keys(runtime.data)).not.toContain('refData');
    // The JSON door answers a framed document with the SAME runtime as the HTML door (it measured 211 KB for a large
    // document: sheet 96 KB, system sheet 41 KB, author script 72 KB, none of which the app reads).
    expect(jsonAnswer.surface.runtime).toEqual(runtime);
    for (const gone of ['"css"', '"systemCss"', '"authorScript"', '"overrides"']) expect(whole).not.toContain(gone);
    // 6 KB is the HTML door's budget for the same page; the whole JSON answer (shell props, author, canonical)
    // carries about 1 KB more than the runtime, so the same ceiling holds for both doors.
    expect(whole.length).toBeLessThan(6_000);
  });

  it('carries none of a document\'s author script or sheet, however large they are', async () => {
    // The production page measured 211 KB: sheet 96 KB, system sheet 41 KB, author script 72 KB. A script of that size, and a
    // class for every row, must still leave the JSON door at the framed runtime's few hundred bytes.
    const script = `export const marker = "AUTHOR_SCRIPT_MARKER";\n${Array.from({ length: 1500 }, (_, i) => `export const v${i} = ${JSON.stringify(`author script padding line ${i} that nothing in the app reads`)};`).join('\n')}`;
    const markup = `<Helmet><script>{${JSON.stringify(script)}}</script></Helmet>${bigMarkup(120).replace('<tr id="r0">', '<tr id="r0" className="bg-emerald-500 text-rose-600 ring-2 divide-y">')}`;
    const w = await ownerWorld(markup);
    as(w.owner, OWNER);
    const body = await json(w.id).then((r) => r.text());
    expect(script.length).toBeGreaterThan(70_000);
    expect(body).not.toContain('AUTHOR_SCRIPT_MARKER');
    expect(body).not.toContain('author script padding');
    for (const gone of ['"css"', '"systemCss"', '"authorScript"', '"overrides"', '"fontPreloads"']) expect(body).not.toContain(gone);
    expect(body.length).toBeLessThan(6_000);
    expect(JSON.parse(body).surface.runtime).toEqual({ title: expect.any(String), data: {} });
  });

  it('answers a small framed document the same shape through both doors', async () => {
    const small = await ownerWorld('<h1 id="t">Small</h1>');
    as(small.owner, OWNER);
    const viaJson = await json(small.id).then((r) => r.json()) as { surface: { runtime: unknown } };
    const viaHtml = (await framed(small.id)).body as { surface: { runtime: unknown } };
    expect(viaJson.surface.runtime).toEqual(viaHtml.surface.runtime);
    expect(viaJson.surface.runtime).toEqual({ title: expect.any(String), data: {} });
  });

  it('serves the tree as its own part, the prepared page\'s nodes for the version asked', async () => {
    const w = await ownerWorld();
    as(w.owner, OWNER);
    const part = await framed(w.id, '?part=nodes');
    expect(part.status).toBe(200);
    const row = await getArtifactById(w.id);
    const { page } = await preparedPageFor(row!, null);
    expect(part.body).toEqual({ editId: row!.edit_id, version: row!.version, nodes: page.data.nodes });
    expect(JSON.stringify(part.body)).toContain('Research note 299');
  });

  it('refuses the nodes part to everyone the page refuses, and to a document that is not markup', async () => {
    const w = await ownerWorld();
    as(w.stranger, STRANGER);
    expect(await framed(w.id, '?part=nodes')).toMatchObject({ status: 404, body: { error: 'not_found' } });
    expect((await json(w.id, '?part=nodes')).status).toBe(404);
    as(null, null);
    expect((await json(w.id, '?part=nodes')).status).toBe(404);
    as(w.owner, OWNER);
    const dataset = await publish(request('/api/artifacts', { method: 'POST', token: w.token.token, json: { visibility: 'private', dataset: [{ n: 1 }], destination: { type: 'personal' } } }));
    const datasetId = (await dataset.json() as { id: string }).id;
    expect((await json(datasetId, '?part=nodes')).status).toBe(404);
  });

  it('serves the nodes part to a reader who may only read, once the link or a share lets them in', async () => {
    const w = await ownerWorld();
    await updateSharingFor({ tokenId: '', userId: w.owner.id }, w.id, { shares: [{ email: STRANGER, role: 'viewer' }] });
    as(w.stranger, STRANGER);
    const part = await framed(w.id, '?part=nodes');
    expect(part.status).toBe(200);
    await updateSharingFor({ tokenId: '', userId: w.owner.id }, w.id, { shares: [] });
    expect((await framed(w.id, '?part=nodes')).status).toBe(404);
  });
});

describe('the page reads the artifact row once, and a refusal reads none', () => {
  it('reads the whole row once for an owner whose document has invited users', async () => {
    const w = await ownerWorld();
    await updateSharingFor({ tokenId: '', userId: w.owner.id }, w.id, { shares: [{ email: STRANGER, role: 'viewer' }] });
    as(w.owner, OWNER);
    const seen = await sqlOf(() => json(w.id).then((r) => r.json() as Promise<{ role: string; surface: { hasInvitedUsers: boolean } }>));
    expect(seen.value.role).toBe('owner');
    expect(seen.value.surface.hasInvitedUsers).toBe(true);
    expect(fullRowReads(seen.sql)).toBe(1);
  });

  it('refuses a stranger without loading the document', async () => {
    const w = await ownerWorld();
    as(w.stranger, STRANGER);
    const seen = await sqlOf(() => json(w.id));
    expect(seen.value.status).toBe(404);
    expect(fullRowReads(seen.sql)).toBe(0);
  });

  it('answers /members for a document with no people in it without loading the document, and with them as before', async () => {
    const w = await ownerWorld();
    as(w.owner, OWNER);
    const call = () => membersRoute(request(`/api/my/artifacts/${w.id}/members`), { params: Promise.resolve({ id: w.id }) });
    const plain = await sqlOf(call);
    expect(plain.value.status).toBe(200);
    expect(await plain.value.json()).toMatchObject({ mentions: {}, canManage: true });
    expect(fullRowReads(plain.sql)).toBe(0);
  });
});

describe('/members names the same mentions with or without reading the document', () => {
  /** An owner, a person (bob) with a pending join on the document, and the document, whose markup may name bob. */
  async function mentionWorld(markupFor: (bobId: string) => string) {
    const owner = await createUser({ email: OWNER });
    const token = await mintAccountToken('owner', owner.id);
    const bob = await createUser({ email: 'mxmx_test_payload_budget_bob@example.com' });
    const created = await publish(request('/api/artifacts', { method: 'POST', token: token.token, json: { visibility: 'private', markup: markupFor(bob.id), destination: { type: 'personal' } } }));
    const { id } = await created.json() as { id: string };
    await (await getDb()).transaction((tx) => setRelationState(tx, bob.id, 'join', id, { status: 'pending', direction: 'invitation', initiatedBy: owner.id, revision: 1 }));
    return { owner, token, bob, id };
  }
  const stateOf = (w: { owner: { id: string }; id: string }) => membershipState({ userId: w.owner.id, tokenId: null }, w.id);
  const reference = async (id: string) => savedMentionStates((await getArtifactById(id))!);

  it('finds a person the document\'s text names, as the whole-row scan does, reading the document because it can name someone', async () => {
    const w = await mentionWorld((bob) => `<div><h1 id="t">Plan</h1><p id="p">Ask [@bob](/people/${bob})</p></div>`);
    const seen = await sqlOf(() => stateOf(w));
    expect(seen.value.mentions).toEqual({ [w.bob.id]: 'pending' });
    expect(seen.value.mentions).toEqual(await reference(w.id));
    expect(fullRowReads(seen.sql)).toBe(1);
  });

  it('finds a person only a comment names, without reading the document', async () => {
    const w = await mentionWorld(() => '<h1 id="t">Plain</h1><p id="p">Nobody here</p>');
    await (await getDb()).query("INSERT INTO annotations(id,artifact_id,body,author_kind,status,snippet) VALUES('thread',$1,$2,'human','open','')", [w.id, `Hi [@bob](/people/${w.bob.id})`]);
    const seen = await sqlOf(() => stateOf(w));
    expect(seen.value.mentions).toEqual({ [w.bob.id]: 'pending' });
    expect(seen.value.mentions).toEqual(await reference(w.id));
    expect(fullRowReads(seen.sql)).toBe(0);
  });

  it('names no one for a document and comments that name no one, reading nothing', async () => {
    const w = await mentionWorld(() => '<h1 id="t">Plain</h1>');
    const seen = await sqlOf(() => stateOf(w));
    expect(seen.value.mentions).toEqual({});
    expect(await reference(w.id)).toEqual({});
    expect(fullRowReads(seen.sql)).toBe(0);
  });
});

describe('a named share is stamped only when there is something to stamp', () => {
  async function sharedWorld(resolved: boolean) {
    const w = await ownerWorld('<h1 id="t">Shared</h1>');
    await updateSharingFor({ tokenId: '', userId: w.owner.id }, w.id, { shares: [{ email: STRANGER, role: 'commenter' }] });
    const db = await getDb();
    if (resolved) await db.query('UPDATE artifact_shares SET user_id=$2 WHERE artifact_id=$1', [w.id, w.stranger.id]);
    else await db.query('UPDATE artifact_shares SET user_id=NULL WHERE artifact_id=$1', [w.id]);
    return w;
  }
  const roleOfStranger = async (w: Awaited<ReturnType<typeof ownerWorld>>) => {
    const row = await getArtifactById(w.id);
    return effectiveRole(row!, { userId: w.stranger.id, tokenId: null, email: STRANGER });
  };

  it('reads an already-stamped share in one statement and writes nothing', async () => {
    const w = await sharedWorld(true);
    const seen = await sqlOf(() => roleOfStranger(w));
    expect(seen.value).toBe('commenter');
    expect(seen.sql.filter((text) => /^UPDATE artifact_shares/.test(text))).toEqual([]);
  });

  it('stamps an invitation that names the account\'s email, once, and the role is the same', async () => {
    const w = await sharedWorld(false);
    const first = await sqlOf(() => roleOfStranger(w));
    expect(first.value).toBe('commenter');
    expect(first.sql.filter((text) => /^UPDATE artifact_shares/.test(text))).toHaveLength(1);
    expect((await (await getDb()).query<{ user_id: string }>('SELECT user_id FROM artifact_shares WHERE artifact_id=$1', [w.id])).rows[0]?.user_id).toBe(w.stranger.id);
    const again = await sqlOf(() => roleOfStranger(w));
    expect(again.value).toBe('commenter');
    expect(again.sql.filter((text) => /^UPDATE artifact_shares/.test(text))).toEqual([]);
  });
});

describe('a document\'s asset refs resolve in a fixed number of statements', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  it('costs the same for one ref as for five, owned, link-readable and private alike', async () => {
    const w = await ownerWorld('<h1 id="t">Refs</h1>');
    const other = await mintAccountToken('other', (await createUser({ email: 'mxmx_test_payload_budget_other@example.com' })).id);
    const image = async (token: string, visibility: string) => (await (await publish(request('/api/artifacts', { method: 'POST', token, json: { visibility, image: PNG } }))).json() as { id: string }).id;
    const own = [await image(w.token.token, 'private'), await image(w.token.token, 'private'), await image(w.token.token, 'private')];
    const linked = await image(other.token, 'public');
    const hidden = await image(other.token, 'private');
    const rowWith = async (ids: string[]) => ({ ...(await getArtifactById(w.id))!, meta: { refs: ids.map((id) => ({ id, kind: 'image' })) } });
    const one = await sqlOf(async () => refDataForRow(await rowWith([own[0]!])));
    const five = await sqlOf(async () => refDataForRow(await rowWith([...own, linked, hidden])));
    expect(Object.keys(one.value)).toEqual([own[0]]);
    expect(Object.keys(five.value).sort()).toEqual([...own, linked].sort());
    expect(five.value[linked]).toMatchObject({ kind: 'image' });
    expect(five.value).not.toHaveProperty(hidden);
    // `rowWith` itself reads the document row once in each; the refs add a fixed number beyond that.
    expect(five.count).toBe(one.count + 1);
  });
});
