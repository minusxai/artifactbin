import { afterEach, expect, it } from 'vitest';
import { request, useAppHarness, mintAccountToken as mintToken } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as getArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as myCreateAnnotationRoute } from '@/app/api/my/artifacts/[id]/annotations/route';
import { listAnnotationPageFor, listAnnotationsFor } from '@/lib/annotations';
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
