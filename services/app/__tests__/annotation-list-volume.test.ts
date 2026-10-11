import { AsyncLocalStorage } from 'node:async_hooks';
import { afterEach, expect, it } from 'vitest';
import { request, useAppHarness, mintAccountToken as mintToken } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as getArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as myCreateAnnotationRoute } from '@/app/api/my/artifacts/[id]/annotations/route';
import { listAnnotationPageFor, listAnnotationsFor } from '@/lib/annotations';
import { GET as listAnnotationsRoute } from '@/app/api/artifacts/[id]/annotations/route';
import { GET as myListAnnotationsRoute } from '@/app/api/my/artifacts/[id]/annotations/route';
import { getDb, measureQueries } from '@/lib/platform';
import { setHostedRemoteAgent } from '@/lib/remote/hosted-interface';
import { hostedAgentClient, hostedAgentSessionId } from '@artifactbin/utils';

useAppHarness();
afterEach(() => setHostedRemoteAgent(undefined));
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const DOC = '<Helmet><title>Report</title></Helmet><p id="intro">An introduction paragraph.</p><div id="findings">Revenue grew 40% in Q3.</div>';

/** A document with `threads` open roots; every third has a reply, every other one remote work. */
async function seed(threads: number) {
  const t = await mintToken('agent');
  const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: DOC } }));
  const doc = (await made.json()) as { id: string; edit_id: string };
  const actor = { credential: 'session' as const, userId: t.userId!, email: t.email!, emailVerified: true };
  const tokenActor = { userId: t.userId!, tokenId: t.id, email: t.email! };
  const db = await getDb();
  const ids: string[] = [];
  for (let i = 0; i < threads; i++) {
    const res = await myCreateAnnotationRoute(request(`/api/my/artifacts/${doc.id}/annotations`, { method: 'POST', actor, json: { node_id: i % 2 ? 'findings' : 'intro', edit_id: doc.edit_id, body: `thread ${i}` } }), params({ id: doc.id }));
    expect(res.status, await res.clone().text()).toBe(201);
    ids.push(((await res.json()) as { id: string }).id);
  }
  const sessionId = hostedAgentSessionId(t.userId!);
  for (const [i, id] of ids.entries()) {
    if (i % 3 === 0) await db.query("INSERT INTO annotations(id,artifact_id,root_id,body,author_kind,author_user_id) VALUES($1,$2,$3,$4,'human',$5)", [`${doc.id}-reply-${i}`, doc.id, id, `reply ${i}`, t.userId]);
    if (i % 2 === 0) await db.query("INSERT INTO remote_work(id,owner,session_id,artifact_id,thread_id,comment_id,phase,data) VALUES($1,$2,$3,$4,$5,$6,'queued',$7)", [`${doc.id}-work-${i}`, t.userId, sessionId, doc.id, id, id, JSON.stringify({ name: 'artifactbin', color: '#123456', payload: {} })]);
  }
  return { t, doc, ids, tokenActor, sessionId, db };
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

it('keeps each thread, reply and remote-work row with its own root', async () => {
  const f = await seed(10);
  const list = (await listAnnotationsFor(f.tokenActor, f.doc.id))!;
  expect(list.map(a => a.id)).toEqual(f.ids);
  list.forEach((a, i) => {
    expect(a.thread.map(c => c.body)).toEqual(i % 3 === 0 ? [`thread ${i}`, `reply ${i}`] : [`thread ${i}`]);
    expect(a.remote_work!.map(w => [w.id, w.threadId, w.artifactId, w.phase, w.sessionId])).toEqual(i % 2 === 0 ? [[`${f.doc.id}-work-${i}`, a.id, f.doc.id, 'queued', f.sessionId]] : []);
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

it('does not ask the hosted agent for status while its snapshot is fresh', async () => {
  const f = await seed(4);
  const id = f.sessionId;
  let calls = 0;
  const session = { id, name: 'artifactbin', harness: 'native', cwd: '/home/runner', machine: 'External', cols: 80, rows: 24, online: true, exitCode: null, controller: 'web' as const, createdAt: new Date().toISOString(), managed: true, activity: 'working' as const };
  setHostedRemoteAgent(hostedAgentClient('https://service.test', async () => { calls++; return Response.json(session); }));
  const first = await listAnnotationsFor(f.tokenActor, f.doc.id);
  const afterFirst = calls;
  expect(afterFirst).toBeGreaterThan(0);
  expect(first![0]!.remote_work![0]).toMatchObject({ connection: 'online', activity: 'working' });
  await listAnnotationsFor(f.tokenActor, f.doc.id);
  await listAnnotationPageFor(f.tokenActor, f.doc.id, { status: 'open', limit: 2 });
  expect(calls).toBe(afterFirst);
});

it('answers the artifact GET with the open count and the inline threads, in a number of statements that does not grow with them', async () => {
  const read = async (f: Awaited<ReturnType<typeof seed>>) => measureQueries(async () => {
    const res = await getArtifactRoute(request(`/api/artifacts/${f.doc.id}`, { token: f.t.token }), params({ id: f.doc.id }));
    return (await res.json()) as { annotations: Array<{ id: string; remote_work: unknown[] }>; open_annotations: number };
  });
  const one = await seed(1), ten = await seed(10);
  const small = await read(one), large = await read(ten);
  expect(large.value.open_annotations).toBe(10);
  expect(large.value.annotations.map(a => a.id)).toEqual(ten.ids);
  expect(large.value.annotations.map(a => a.remote_work.length)).toEqual(ten.ids.map((_, i) => (i % 2 === 0 ? 1 : 0)));
  expect(large.stats.count).toBe(small.stats.count);
});

/** A ~2.5 MB page: the access decision for its comments must not read it. */
const BIG_DOC = `<Helmet><title>Big report</title></Helmet><p id="intro">An introduction paragraph.</p><div id="findings">Revenue grew 40% in Q3.</div>${Array.from({ length: 12000 }, (_, i) => `<p>Filler paragraph number ${i} with enough words to weigh about two hundred bytes of markup, repeated until the page is large.</p>`).join('')}`;

async function seedBig(threads: number) {
  const t = await mintToken('agent');
  const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: BIG_DOC } }));
  const doc = (await made.json()) as { id: string; edit_id: string };
  expect(made.status).toBe(201);
  const actor = { credential: 'session' as const, userId: t.userId!, email: t.email!, emailVerified: true };
  const tokenActor = { userId: t.userId!, tokenId: t.id, email: t.email! };
  for (let i = 0; i < threads; i++) {
    const res = await myCreateAnnotationRoute(request(`/api/my/artifacts/${doc.id}/annotations`, { method: 'POST', actor, json: { node_id: i % 2 ? 'findings' : 'intro', edit_id: doc.edit_id, body: `thread ${i}` } }), params({ id: doc.id }));
    expect(res.status, await res.clone().text()).toBe(201);
  }
  return { t, doc, actor, tokenActor };
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
  const inline = await getArtifactRoute(request(`/api/artifacts/${f.doc.id}`, { token: f.t.token }), params({ id: f.doc.id }));
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
  const strangerActor = { userId: stranger.userId!, tokenId: stranger.id, email: stranger.email! };
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
