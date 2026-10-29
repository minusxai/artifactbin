import {nativeHtml} from './native-html-fixture';
import {nativeAnchor} from './native-annotation-fixture';
import { AsyncLocalStorage } from 'node:async_hooks';
import { identityForUser } from '@/lib/accounts';
import { expect, it } from 'vitest';
import { request, useAppHarness, mintAccountToken as mintToken } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as getArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as myCreateAnnotationRoute } from '@/app/api/my/artifacts/[id]/annotations/route';
import { listAnnotationPageFor, listAnnotationsFor } from '@/lib/annotations';
import { GET as listAnnotationsRoute } from '@/app/api/artifacts/[id]/annotations/route';
import { GET as myListAnnotationsRoute } from '@/app/api/my/artifacts/[id]/annotations/route';
import { getDb, measureQueries } from '@/lib/platform';
import { artifactQuery } from '@/lib/artifacts/table';
import { createDocumentGraph } from '@/lib/document';

useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const DOC = '<p data-af-id="intro">An introduction paragraph.</p><div data-af-id="findings">Revenue grew 40% in Q3.</div>';

/** A document with `threads` open roots; every third has a reply, with replies. */
async function seed(threads: number) {
  const t = await mintToken('agent');
  const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { html: nativeHtml(DOC) } }));
  const doc = (await made.json()) as { id: string; edit_id: string };
  const actor = { credential: 'session' as const, userId: t.userId!, email: t.email!, emailVerified: true };
  const tokenActor = identityForUser(t.userId!, t.id, t.email!);
  const db = await getDb();
  const ids: string[] = [];
  for (let i = 0; i < threads; i++) {
    const res = await myCreateAnnotationRoute(request(`/api/my/artifacts/${doc.id}/annotations`, { method: 'POST', actor, json: { anchor: nativeAnchor(i % 2 ? 'findings' : 'intro'), edit_id: doc.edit_id, body: `thread ${i}` } }), params({ id: doc.id }));
    expect(res.status, await res.clone().text()).toBe(201);
    ids.push(((await res.json()) as { id: string }).id);
  }
  for (const [i, id] of ids.entries()) {
    if (i % 3 === 0) await db.query("INSERT INTO annotations(id,artifact_id,root_id,body,author_kind,author_user_id) VALUES($1,$2,$3,$4,'human',$5)", [`${doc.id}-reply-${i}`, doc.id, id, `reply ${i}`, t.userId]);
  }
  return { t, doc, ids, tokenActor, db };
}

it('lists threads in a number of statements that does not grow with them', async () => {
  const one = await seed(1), ten = await seed(10);
  const small = await measureQueries(() => listAnnotationsFor(one.tokenActor, one.doc.id));
  const large = await measureQueries(() => listAnnotationsFor(ten.tokenActor, ten.doc.id));
  expect(small.value).toHaveLength(1);
  expect(large.value).toHaveLength(10);
  expect(large.stats.count).toBe(small.stats.count);
  const paged = await measureQueries(() => listAnnotationPageFor(ten.tokenActor, ten.doc.id, { status: 'open', limit: 10 }));
  expect(paged.value?.annotations).toHaveLength(10);
  expect(paged.stats.count).toBe(small.stats.count);
});

it('keeps each thread, reply with its own root', async () => {
  const f = await seed(10);
  const list = (await listAnnotationsFor(f.tokenActor, f.doc.id))!;
  expect(list.map(a => a.id)).toEqual(f.ids);
  list.forEach((a, i) => {
    expect(a.thread.map(c => c.body)).toEqual(i % 3 === 0 ? [`thread ${i}`, `reply ${i}`] : [`thread ${i}`]);
  });
});

it('loads replies only for the roots a page selects', async () => {
  const f = await seed(9);
  const seen = new Set<string>();
  const query = f.db.query.bind(f.db);
  f.db.query = (async (sql: string, args?: unknown[]) => {
    const result = await (query as (s: string, a?: unknown[]) => Promise<{ rows: Array<{ root_id?: string | null }> }>)(sql, args);
    for (const row of result.rows) if (row.root_id) seen.add(row.root_id);
    return result;
  }) as typeof f.db.query;
  try {
    const page = (await listAnnotationPageFor(f.tokenActor, f.doc.id, { status: 'open', limit: 3 }))!;
    expect(page.annotations.map(a => a.id)).toEqual(f.ids.slice(0, 3));
    expect([...seen]).toEqual([f.ids[0]]);
  } finally { f.db.query = query as typeof f.db.query; }
});


it('keeps native source GET independent of comment volume and exposes threads on the dedicated endpoint', async () => {
  const read = async (f: Awaited<ReturnType<typeof seed>>) => measureQueries(async () => {
    const res = await getArtifactRoute(request(`/api/artifacts/${f.doc.id}`, { token: f.t.token }), params({ id: f.doc.id }));
    return await res.json() as {annotations:Array<{id:string}>;open_annotations:number};
  });
  const one = await seed(1), ten = await seed(10);
  const small = await read(one), large = await read(ten);
  expect(large.value).not.toHaveProperty('annotations');
  expect(large.value).not.toHaveProperty('open_annotations');
  const listed=await listAnnotationsRoute(request(`/api/artifacts/${ten.doc.id}/annotations`,{token:ten.t.token}),params({id:ten.doc.id}));
  expect((await listed.json()).annotations.map((a:{id:string})=>a.id)).toEqual(ten.ids);
  expect(large.stats.count).toBe(small.stats.count);
});

/** A ~2.5 MB page: the access decision for its comments must not read it. */
const BIG_FILLER = `${Array.from({ length: 12000 }, (_, i) => `<p>Filler paragraph number ${i} with enough words to weigh about two hundred bytes of markup, repeated until the page is large.</p>`).join('')}`;

/** The stored form of DOC plus BIG_FILLER, built once for the file: the publish pipeline is not what these tests are about. */
let bigStored: string | undefined;

/**
 * The large page is seeded cheaply: the artifact and its threads are created through the normal routes on the small
 * DOC (whose node ids the anchors name), then the stored document is swapped for the graph of DOC followed by BIG_FILLER in one UPDATE. The
 * result is the same row a publish of that page would leave (same intro/findings nodes, same preserved source), without
 * pushing 2.5 MB through publish validation and a per-comment re-read of it.
 */
async function seedBig(threads: number) {
  const f = await seed(threads);
  if (bigStored === undefined) {
    const small = (await artifactQuery<{ source: string }>(f.db, 'SELECT document, source FROM artifacts WHERE id = $1', [f.doc.id])).rows[0]!.source;
    bigStored = JSON.stringify(createDocumentGraph(small.replace(/^<!doctype html>/i, '').replace('</body>', `${BIG_FILLER}</body>`), 1, { preserveSource: true }));
  }
  await f.db.query('UPDATE artifacts SET document = $1::jsonb WHERE id = $2', [bigStored, f.doc.id]);
  const actor = { credential: 'session' as const, userId: f.t.userId!, email: f.t.email!, emailVerified: true };
  return { t: f.t, doc: f.doc, actor, tokenActor: f.tokenActor };
}

/** Run `work` and count the statements IT issued (its async context only, never background work) that returned a document or source. */
async function readingDocument<T>(work: () => Promise<T>): Promise<{ value: T; documentRows: number }> {
  const db = await getDb();
  const query = db.query.bind(db);
  const mine = new AsyncLocalStorage<true>();
  let documentRows = 0;
  db.query = (async (sql: string, args?: unknown[]) => {
    const result = await (query as (s: string, a?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>)(sql, args);
    if (mine.getStore()) for (const row of result.rows) if (row.document != null || row.source != null) documentRows++;
    return result;
  }) as typeof db.query;
  try { return { value: await mine.run(true, work), documentRows }; } finally { db.query = query as typeof db.query; }
}

it('lists a large document with no threads without reading the document', async () => {
  const f = await seedBig(0);
  const { value, documentRows } = await readingDocument(() => listAnnotationPageFor(f.tokenActor, f.doc.id, { status: 'open', limit: 10 }));
  expect(value).toEqual({ annotations: [] });
  expect(documentRows).toBe(0);
  const all = await readingDocument(() => listAnnotationsFor(f.tokenActor, f.doc.id));
  expect(all.value).toEqual([]);
  expect(all.documentRows).toBe(0);
});

it('reads the document of a large page once, only to anchor the threads it lists, with the same result as before', async () => {
  const f = await seedBig(4);
  const paged = await readingDocument(() => listAnnotationPageFor(f.tokenActor, f.doc.id, { status: 'open', limit: 10 }));
  expect(paged.documentRows).toBe(1);
  // The artifact GET inlines the open threads from the row it already holds: the unchanged reference.
  const inline = await listAnnotationsRoute(request(`/api/artifacts/${f.doc.id}/annotations`, { token: f.t.token }), params({ id: f.doc.id }));
  const expected = ((await inline.json()) as { annotations: unknown[] }).annotations;
  expect(expected).toHaveLength(4);
  expect(JSON.parse(JSON.stringify(paged.value!.annotations))).toEqual(expected);
  expect(JSON.parse(JSON.stringify((await listAnnotationsFor(f.tokenActor, f.doc.id))!))).toEqual(expected);
  expect(paged.value!.annotations.every(a => !a.orphaned && a.anchor)).toBe(true);
  const empty = await readingDocument(() => listAnnotationPageFor(f.tokenActor, f.doc.id, { status: 'resolved', limit: 10 }));
  expect(empty.value).toEqual({ annotations: [] });
  expect(empty.documentRows).toBe(0);
});

it('answers a stranger, and a trashed or missing document, with the same null and the uniform 404 body', async () => {
  const f = await seedBig(1);
  const stranger = await mintToken('other');
  const strangerActor = identityForUser(stranger.userId!, stranger.id, stranger.email!);
  const refused = await readingDocument(() => listAnnotationPageFor(strangerActor, f.doc.id, { status: 'open', limit: 10 }));
  expect(refused.value).toBeNull();
  expect(refused.documentRows).toBe(0);
  expect(await listAnnotationsFor(strangerActor, f.doc.id)).toBeNull();
  const viaToken = await listAnnotationsRoute(request(`/api/artifacts/${f.doc.id}/annotations`, { token: stranger.token }), params({ id: f.doc.id }));
  expect(viaToken.status).toBe(404);
  expect(await viaToken.json()).toEqual({ error: 'not_found' });
  const strangerSession = { credential: 'session' as const, userId: stranger.userId!, email: stranger.email!, emailVerified: true };
  const viaSession = await myListAnnotationsRoute(request(`/api/my/artifacts/${f.doc.id}/annotations`, { actor: strangerSession }), params({ id: f.doc.id }));
  expect(viaSession.status).toBe(404);
  expect(await viaSession.json()).toEqual({ error: 'not_found' });
  const missing = await listAnnotationsRoute(request('/api/artifacts/nope/annotations', { token: stranger.token }), params({ id: 'nope' }));
  expect([missing.status, await missing.json()]).toEqual([404, { error: 'not_found' }]);
  const db = await getDb();
  await db.query('UPDATE artifacts SET deleted_at = now() WHERE id = $1', [f.doc.id]);
  expect(await listAnnotationPageFor(f.tokenActor, f.doc.id, { status: 'open', limit: 10 })).toBeNull();
  expect(await listAnnotationsFor(f.tokenActor, f.doc.id)).toBeNull();
});
