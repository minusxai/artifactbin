import { describe, expect, it } from 'vitest';
import { useAppHarness, request, setSession, mintAccountToken } from './harness';
import { createUser, setRelationState } from '@/lib/accounts';
import { getArtifactById, membershipState, savedMentionStates } from '@/lib/artifacts';
import { POST as publish } from '@/app/api/artifacts/route';
import { POST as editRoute } from '@/app/api/artifacts/[id]/edits/route';
import { GET as pageRoute } from '@/app/api/page/artifact/[id]/route';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { GET as storyRoute } from '@/app/a/[id]/story/route';
import { artifactPageAnswer } from '@/lib/serving/artifact-page';
import { preparedPageFor } from '@/lib/publish/prepared/prepared-page.server';
import { getDb, measureQueries } from '@/lib/platform';
import { pagesSite } from '@/lib/http/pages-origin';
import { observedSourceBody } from './prepared-document';

useAppHarness();

/**
 * THE PREPARED PAGE IS READ IN PARTS — each view loads only what it uses.
 *
 * A prepared page is three stored things of very different weight: the shell (sheet, style overrides, declared dataflow,
 * title… — what the app page needs), the node tree and the compiled page. The tree and the compiled HTML grow with
 * the document; the shell does not. These tests observe what each reader's `prepared_pages` statements actually RETURN
 * (the rows the database sent), so a view that asks for more than it uses fails by what it received, not by how a
 * statement is spelled. The same goes for `/members`: the people a document names are stored with its prepared page
 * (`prepared_pages.mentions`) so the membership list never casts the document to text to look for them.
 */
const OWNER = 'mxmx_test_prepared_parts_owner@example.com';
const BOB = 'mxmx_test_prepared_parts_bob@example.com';

const bigMarkup = (rows: number, mention = '') =>
  `<div data-design="tw" className="px-4 py-8"><h1 id="title">Plan</h1>${mention}<table><tbody>${Array.from({ length: rows }, (_, i) =>
    `<tr id="r${i}"><td>${i}</td><td><strong>Row ${i}</strong></td><td>Research note ${i}: the module graph hides a cycle through the reader chrome.</td></tr>`).join('')}</tbody></table></div>`;

/** What a reader's `SELECT … FROM prepared_pages` statements returned, serialized: the weight it carried off the table. */
async function observe<T>(work: () => Promise<T>): Promise<{ value: T; sql: string[]; returned: string; count: number }> {
  const db = await getDb() as unknown as { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };
  const original = db.query.bind(db);
  const sql: string[] = [], rows: string[] = [];
  db.query = async (text: string, params?: unknown[]) => {
    const flat = text.replace(/\s+/g, ' ').trim();
    sql.push(flat);
    const result = await original(text, params);
    if (/^SELECT\b.*\bFROM prepared_pages\b/i.test(flat)) rows.push(JSON.stringify(result.rows));
    return result;
  };
  try {
    const { value, stats } = await measureQueries(work);
    return { value, sql, returned: rows.join('\n'), count: stats.count };
  } finally { db.query = original; }
}
/** The tree's own spelling (`"type":"element"` nodes) and the compiled page's (`"ssrHalf"`): neither appears in the shell. */
const hasTree = (returned: string) => returned.includes('"type":"element"');
const hasCompiled = (returned: string) => returned.includes('"ssrHalf"');

async function world(rows = 300, mention = '') {
  const owner = await createUser({ email: OWNER });
  const token = await mintAccountToken('owner', owner.id);
  const created = await publish(request('/api/artifacts', { method: 'POST', token: token.token, json: { visibility: 'public', markup: bigMarkup(rows, mention), destination: { type: 'personal' } } }));
  expect(created.status).toBe(201);
  const { id } = await created.json() as { id: string };
  // Prepared once, as the first reader (or the publish-time warm-up of a serving process) does.
  await preparedPageFor((await getArtifactById(id))!, null);
  return { owner, token, id };
}
const as = (user: { id: string } | null, email: string | null) => setSession(user ? { user: { id: user.id, email, emailVerified: true } } as never : null);
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (id: string, query = '') => pageRoute(request(`/api/page/artifact/${id}${query}`), params(id));
const framed = (id: string, query = '') => artifactPageAnswer(request(`/api/page/artifact/${id}${query}`), id, { pages: pagesSite() });

describe('each view loads only the parts of the prepared page it uses', () => {
  it('reads neither the node tree nor the compiled page for the app page, framed or not', async () => {
    const w = await world();
    as(w.owner, OWNER);
    const html = await observe(() => framed(w.id));
    expect(html.value.status).toBe(200);
    const door = await observe(() => json(w.id).then((r) => r.json() as Promise<{ surface: { runtime: { css: string } } }>));
    expect(door.value.surface.runtime.css).toEqual(expect.any(String));
    for (const seen of [html, door]) {
      expect(seen.returned).not.toBe('');
      expect(hasTree(seen.returned)).toBe(false);
      expect(hasCompiled(seen.returned)).toBe(false);
      expect(seen.returned).not.toContain('Research note 299');
    }
  });

  it('reads the node tree and not the compiled page for ?part=nodes, and the answer is the stored tree', async () => {
    const w = await world();
    as(w.owner, OWNER);
    const seen = await observe(() => framed(w.id, '?part=nodes'));
    expect(seen.value.status).toBe(200);
    expect(hasTree(seen.returned)).toBe(true);
    expect(hasCompiled(seen.returned)).toBe(false);
    const { page } = await preparedPageFor((await getArtifactById(w.id))!, null);
    expect((seen.value.body as { nodes: unknown }).nodes).toEqual(page.data.nodes);
  });

  it('reads the compiled page and not the node tree for the document copy, and serves the whole document', async () => {
    const w = await world();
    const seen = await observe(async () => (await rawRoute(request(`/a/${w.id}/raw`), params(w.id))).text());
    expect(seen.value).toContain('Research note 299');
    expect(hasCompiled(seen.returned)).toBe(true);
    expect(hasTree(seen.returned)).toBe(false);
  });

  it('still reads the tree for the live fragment, which hands the version\'s nodes to the morph', async () => {
    const w = await world(20);
    const seen = await observe(async () => (await storyRoute(request(`/a/${w.id}/story`), params(w.id))).text());
    expect(seen.value).toContain('Research note 19');
    expect(hasTree(seen.returned)).toBe(true);
  });
});

describe('a prepared page stored whole by an earlier deployment keeps working', () => {
  /** The earlier shape: one `page` value carrying the tree and the compiled page, no split columns. */
  async function storeWhole(id: string, columns: 'empty' | 'stale') {
    const db = await getDb();
    const whole = (await preparedPageFor((await getArtifactById(id))!, null)).page;
    const { pageFormat: _f, handoverContract: _h, cssVersion: _c, ...stored } = whole;
    await db.query(
      `UPDATE prepared_pages SET page = $2::jsonb, nodes = $3::jsonb, compiled = $3::jsonb WHERE artifact_id = $1`,
      [id, JSON.stringify(stored), columns === 'empty' ? null : JSON.stringify({ stale: true })],
    );
    return whole;
  }
  const split = async (id: string) => (await (await getDb()).query<{ page: { data: Record<string, unknown>; compiled?: unknown }; nodes: unknown; compiled: unknown }>('SELECT page, nodes, compiled FROM prepared_pages WHERE artifact_id = $1', [id])).rows[0]!;

  for (const columns of ['empty', 'stale'] as const) {
    it(`reads it narrowly and rewrites it split, idempotently (split columns ${columns})`, async () => {
      const w = await world(40);
      as(w.owner, OWNER);
      const whole = await storeWhole(w.id, columns);
      const first = await framed(w.id);
      expect(first.status).toBe(200);
      const after = await split(w.id);
      expect(after.nodes).toEqual(whole.data.nodes);
      expect(after.compiled).toEqual(whole.compiled);
      expect(after.page.data).not.toHaveProperty('nodes');
      expect(after.page).not.toHaveProperty('compiled');
      // The rewritten row is the narrow one: nothing is read whole again, and the stored bytes did not move.
      const again = await observe(() => framed(w.id));
      expect(again.value.status).toBe(200);
      expect(hasTree(again.returned) || hasCompiled(again.returned)).toBe(false);
      expect(await split(w.id)).toEqual(after);
      // The tree and the compiled copy are what they were.
      expect(((await framed(w.id, '?part=nodes')).body as { nodes: unknown }).nodes).toEqual(whole.data.nodes);
      expect(await (await rawRoute(request(`/a/${w.id}/raw`), params(w.id))).text()).toContain('Research note 39');
    });
  }
});

describe('/members names the people a document mentions without scanning the document', () => {
  async function mentionWorld() {
    const owner = await createUser({ email: OWNER });
    const token = await mintAccountToken('owner', owner.id);
    const bob = await createUser({ email: BOB });
    const created = await publish(request('/api/artifacts', { method: 'POST', token: token.token, json: { visibility: 'private', markup: bigMarkup(30, `<p id="ask">Ask [@bob](/people/${bob.id})</p>`), destination: { type: 'personal' } } }));
    const { id } = await created.json() as { id: string };
    await (await getDb()).transaction((tx) => setRelationState(tx, bob.id, 'join', id, { status: 'pending', direction: 'invitation', initiatedBy: owner.id, revision: 1 }));
    return { owner, token, bob, id };
  }
  const state = (w: { owner: { id: string }; id: string }) => membershipState({ userId: w.owner.id, tokenId: null }, w.id);
  const reference = async (id: string) => savedMentionStates((await getArtifactById(id))!);
  const scanned = (sql: string[]) => sql.filter((text) => /document::text|strpos\(/.test(text)).length;
  const fullRows = (sql: string[]) => sql.filter((text) => /SELECT (artifacts\.)?\*.* FROM artifacts\b/.test(text)).length;
  const prepare = async (id: string) => { await preparedPageFor((await getArtifactById(id))!, null); };

  it('stores the people with the prepared page and answers from it: no document read, no text scan', async () => {
    const w = await mentionWorld();
    await prepare(w.id);
    expect((await (await getDb()).query<{ mentions: string[] | null }>("SELECT mentions FROM prepared_pages WHERE artifact_id = $1 AND slot = 'head'", [w.id])).rows[0]!.mentions).toEqual([w.bob.id]);
    const seen = await observe(() => state(w));
    expect(seen.value.mentions).toEqual({ [w.bob.id]: 'pending' });
    expect(seen.value.mentions).toEqual(await reference(w.id));
    expect(scanned(seen.sql)).toBe(0);
    expect(fullRows(seen.sql)).toBe(0);
  });

  it('stores an empty list for a document that names no one, and reads nothing for it', async () => {
    const w = await world(20);
    const seen = await observe(() => membershipState({ userId: w.owner.id, tokenId: null }, w.id));
    expect(seen.value.mentions).toEqual({});
    expect((await (await getDb()).query<{ mentions: string[] | null }>("SELECT mentions FROM prepared_pages WHERE artifact_id = $1 AND slot = 'head'", [w.id])).rows[0]!.mentions).toEqual([]);
    expect(scanned(seen.sql)).toBe(0);
    expect(fullRows(seen.sql)).toBe(0);
  });

  it('fills the people of a page prepared before they were stored, once, from the same scan as ever', async () => {
    const w = await mentionWorld();
    await prepare(w.id);
    const db = await getDb();
    await db.query('UPDATE prepared_pages SET mentions = NULL WHERE artifact_id = $1', [w.id]);
    const first = await observe(() => state(w));
    expect(first.value.mentions).toEqual({ [w.bob.id]: 'pending' });
    expect(scanned(first.sql)).toBe(1);
    expect((await db.query<{ mentions: string[] | null }>('SELECT mentions FROM prepared_pages WHERE artifact_id = $1', [w.id])).rows[0]!.mentions).toEqual([w.bob.id]);
    const second = await observe(() => state(w));
    expect(second.value.mentions).toEqual(first.value.mentions);
    expect(scanned(second.sql)).toBe(0);
  });

  it('follows an edit: a version not yet prepared is scanned, never answered from the previous version\'s people', async () => {
    const w = await mentionWorld();
    await prepare(w.id);
    const carol = await createUser({ email: 'mxmx_test_prepared_parts_carol@example.com' });
    const edit = await editRoute(request(`/api/artifacts/${w.id}/edits`, { method: 'POST', token: w.token.token, json: await observedSourceBody(w.id, bigMarkup(30, `<p id="ask">Ask [@carol](/people/${carol.id})</p>`)) }), params(w.id));
    expect(edit.status).toBe(200);
    await (await getDb()).transaction((tx) => setRelationState(tx, carol.id, 'join', w.id, { status: 'pending', direction: 'invitation', initiatedBy: w.owner.id, revision: 1 }));
    const seen = await observe(() => state(w));
    expect(seen.value.mentions).toEqual({ [carol.id]: 'pending' });
    expect(seen.value.mentions).toEqual(await reference(w.id));
    // Once that version is prepared the people are its own.
    await prepare(w.id);
    const after = await observe(() => state(w));
    expect(after.value.mentions).toEqual({ [carol.id]: 'pending' });
    expect(scanned(after.sql)).toBe(0);
  });
});
