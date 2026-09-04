/**
 * THE EVENTS CONTRACT, run over BOTH transports: the writer in this process,
 * and the same writer behind `serveEvents` reached through `eventsClient`.
 * One suite, two shapes — in-process and remote can never disagree. Then the
 * shell's own guards, the client's batching, and the boot.
 *
 * Seeded RED by the orchestrator: every implementation below is a skeleton
 * that throws `events-svc: implement …`.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { EventEnvelope, EventsService, Queryable } from '@artifactbin/contracts';
import { EVENTS_ROUTES, SERVICE_AUTH_HEADER } from '@artifactbin/contracts';
import { eventsClient, loadEventsConfig, runEvents, serveEvents } from '@artifactbin/events';
import { createEvents, ensureEventsSchema } from '@artifactbin/events/local';

const SCHEMA = 'evt_test';
const pg = new PGlite();
const db: Queryable = {
  query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => ({ rows: (await pg.query<T>(sql, params)).rows }),
};
const count = async (schema = SCHEMA): Promise<number> => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${schema}.events`)).rows[0]!.n;
const until = async (cond: () => Promise<boolean>, ms = 4000): Promise<void> => {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error('until: timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};
const settle = () => new Promise((r) => setTimeout(r, 150));
const envelope = (over: Partial<EventEnvelope> = {}): EventEnvelope => ({
  id: randomUUID(),
  at: new Date().toISOString(),
  source: 'app',
  subject_kind: 'user',
  subject_id: 'usr_1',
  verb: 'viewed',
  object_kind: 'artifact',
  object_id: 'abc123',
  payload: { client: 'test' },
  ...over,
});

const sunk: EventEnvelope[][] = [];
const sink = async (batch: EventEnvelope[]) => { sunk.push(batch); };
const failingSink = async () => { throw new Error('sink down'); };

let local: EventsService;
let remote: EventsService;
let server: ReturnType<typeof serveEvents>;
beforeAll(async () => {
  await ensureEventsSchema(db, SCHEMA);
  local = createEvents({ db, schema: SCHEMA, sinks: [failingSink, sink] });
  server = serveEvents(createEvents({ db, schema: SCHEMA, sinks: [failingSink, sink] }), { serviceSecret: 's3cret' });
  remote = eventsClient(server.listen(0).url, { serviceSecret: 's3cret', batchMs: 10, batchMax: 50, deadlineMs: 2000 });
});
afterAll(async () => { await remote?.close?.(); await server?.close(); await pg.close(); });
beforeEach(async () => { await db.query(`DELETE FROM ${SCHEMA}.events`); sunk.length = 0; });

describe.each<[string, () => EventsService]>([['in-process', () => local], ['over HTTP', () => remote]])('%s', (_name, svc) => {
  it('stores one row per envelope, every column round-tripping', async () => {
    const e = envelope({ subject_kind: 'visitor', subject_id: 'v'.repeat(32), verb: 'forked', payload: { fork_id: 'xyz789' } });
    await svc().emit([e, envelope()]);
    await until(async () => (await count()) === 2);
    const row = (await db.query<Record<string, unknown>>(`SELECT * FROM ${SCHEMA}.events WHERE id = $1`, [e.id])).rows[0]!;
    expect(row).toMatchObject({ source: 'app', subject_kind: 'visitor', subject_id: 'v'.repeat(32), verb: 'forked', object_kind: 'artifact', object_id: 'abc123', payload: { fork_id: 'xyz789' } });
    expect(new Date(row.at as string).toISOString()).toBe(e.at);
  });

  it('a replayed batch stores nothing new (the id is the dedupe key)', async () => {
    const batch = [envelope(), envelope()];
    await svc().emit(batch);
    await svc().emit(batch);
    await until(async () => (await count()) === 2);
    await settle();
    expect(await count()).toBe(2);
  });

  it('every sink receives the stored batch; a throwing sink neither fails emit nor loses the row', async () => {
    const e = envelope();
    await expect(svc().emit([e])).resolves.toBeUndefined();
    await until(async () => sunk.some((b) => b.some((x) => x.id === e.id)));
    expect(await count()).toBe(1);
  });
});

describe('serveEvents (the shell)', () => {
  const received: EventEnvelope[][] = [];
  let calls = 0;
  const recording: EventsService = { emit: async (b) => { calls += 1; received.push(b); } };
  const shell = serveEvents(recording, { serviceSecret: 'shh', maxBody: 4096 });
  const { url } = shell.listen(0);
  afterAll(() => shell.close());
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  it('answers GET /health without the secret — before the guard, so the HEALTHCHECK works', async () => {
    const r = await fetch(`${url}/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });
  it('refuses a POST without the secret (401) and a GET on the route (405)', async () => {
    expect((await post(EVENTS_ROUTES.emit, [envelope()])).status).toBe(401);
    expect((await fetch(`${url}${EVENTS_ROUTES.emit}`, { headers: { [SERVICE_AUTH_HEADER]: 'shh' } })).status).toBe(405);
  });
  it('hands the array to the service and answers { accepted }', async () => {
    const batch = [envelope(), envelope()];
    const r = await post(EVENTS_ROUTES.emit, batch, { [SERVICE_AUTH_HEADER]: 'shh' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ accepted: 2 });
    expect(received.at(-1)).toEqual(batch);
  });
  it('refuses a body that is not an array of envelopes with 400 and the name only', async () => {
    const r = await post(EVENTS_ROUTES.emit, { not: 'an array' }, { [SERVICE_AUTH_HEADER]: 'shh' });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'bad_request' });
  });
  it('caps the body (413)', async () => {
    const big = Array.from({ length: 200 }, () => envelope({ payload: { pad: 'x'.repeat(100) } }));
    expect((await post(EVENTS_ROUTES.emit, big, { [SERVICE_AUTH_HEADER]: 'shh' })).status).toBe(413);
    expect(calls).toBeGreaterThan(0);
  });
});

describe('eventsClient (the batching client)', () => {
  const batches: EventEnvelope[][] = [];
  let failNext = 0;
  const svc: EventsService = { emit: async (b) => { if (failNext > 0) { failNext -= 1; throw new Error('boom'); } batches.push(b); } };
  const shell = serveEvents(svc);
  const { url } = shell.listen(0);
  afterAll(() => shell.close());
  beforeEach(() => { batches.length = 0; failNext = 0; });

  it('emit resolves at once and the batch leaves on the timer', async () => {
    const client = eventsClient(url, { batchMs: 100, batchMax: 50, deadlineMs: 1000 });
    const t0 = Date.now();
    await client.emit([envelope()]);
    expect(Date.now() - t0).toBeLessThan(50);
    expect(batches).toHaveLength(0);
    await until(async () => batches.length === 1);
    await client.close?.();
  });
  it('a burst leaves in batches of batchMax, in order, nothing lost', async () => {
    const client = eventsClient(url, { batchMs: 5_000, batchMax: 50, deadlineMs: 1000 });
    const all = Array.from({ length: 120 }, () => envelope());
    for (const e of all) void client.emit([e]);
    await until(async () => batches.flat().length === 120);
    expect(batches.map((b) => b.length)).toEqual([50, 50, 20]);
    expect(batches.flat().map((e) => e.id)).toEqual(all.map((e) => e.id));
    await client.close?.();
  });
  it('close flushes the tail — what the SIGTERM handler awaits', async () => {
    const client = eventsClient(url, { batchMs: 60_000, batchMax: 50, deadlineMs: 1000 });
    for (let i = 0; i < 10; i += 1) void client.emit([envelope()]);
    await client.close?.();
    expect(batches.flat()).toHaveLength(10);
  });
  it('retries a failed POST once, so a blip loses nothing and a replay stores nothing twice', async () => {
    failNext = 1;
    const client = eventsClient(url, { batchMs: 10, batchMax: 50, deadlineMs: 1000 });
    const e = envelope();
    await client.emit([e]);
    await until(async () => batches.flat().some((x) => x.id === e.id));
    expect(batches.flat().filter((x) => x.id === e.id)).toHaveLength(1);
    await client.close?.();
  });
  it('drops on overflow with ONE warning, never throws, never blocks', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = eventsClient(url, { batchMs: 60_000, batchMax: 50, queueMax: 5, deadlineMs: 1000 });
    for (let i = 0; i < 8; i += 1) await client.emit([envelope()]);
    await client.close?.();
    expect(batches.flat()).toHaveLength(5);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
  it('a dead service costs a log line, not a rejection or a hang', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dead = eventsClient('http://127.0.0.1:1', { batchMs: 5, deadlineMs: 300 });
    const t0 = Date.now();
    await expect(dead.emit([envelope()])).resolves.toBeUndefined();
    await expect(dead.close?.()).resolves.toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(2500);
    error.mockRestore();
  });
});

describe('ensureEventsSchema', () => {
  it('creates the schema and the table when absent, is idempotent, and refuses a schema that is not an identifier', async () => {
    await ensureEventsSchema(db, 'evt_fresh');
    await ensureEventsSchema(db, 'evt_fresh');
    expect(await count('evt_fresh')).toBe(0);
    const cols = (await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema = 'evt_fresh' AND table_name = 'events' ORDER BY ordinal_position")).rows.map((r) => r.column_name);
    expect(cols).toEqual(['id', 'at', 'source', 'subject_kind', 'subject_id', 'verb', 'object_kind', 'object_id', 'payload']);
    await expect(ensureEventsSchema(db, 'bad-name; drop')).rejects.toThrow(/identifier/);
  });
});

describe('loadEventsConfig + runEvents (the boot)', () => {
  it('reads the four names with their defaults, names every missing required setting in one error, and reports unknown EVENTS__ names', () => {
    const c = loadEventsConfig({ DATABASE_URL: 'postgresql://x', INTERNAL__SERVICE_SECRET: 's' });
    expect(c).toMatchObject({ port: 8080, schema: 'events', databaseUrl: 'postgresql://x', serviceSecret: 's', unknownNames: [] });
    expect(loadEventsConfig({ APP__PORT: '0', EVENTS__SCHEMA: 'afbin_prod_events', EVENTS__TYPO: '1' })).toMatchObject({ port: 0, schema: 'afbin_prod_events', unknownNames: ['EVENTS__TYPO'] });
    expect(() => loadEventsConfig({}, { required: ['DATABASE_URL', 'INTERNAL__SERVICE_SECRET'] })).toThrow(/DATABASE_URL[\s\S]*INTERNAL__SERVICE_SECRET/);
    expect(() => loadEventsConfig({ EVENTS__SCHEMA: 'no way' })).toThrow(/identifier/);
    expect(loadEventsConfig({ EVENTS__FORWARD_RULES: 'x=>y' }, { known: ['EVENTS__FORWARD_RULES'] }).unknownNames).toEqual([]);
  });
  it('boots on an injected Queryable, answers /health, stores what the client emits, and closes idempotently', async () => {
    const running = await runEvents({ port: 0, schema: 'evt_boot', unknownNames: [] }, { db });
    expect((await fetch(`${running.url}/health`)).status).toBe(200);
    const client = eventsClient(running.url, { batchMs: 5 });
    await client.emit([envelope()]);
    await until(async () => (await count('evt_boot')) === 1);
    await client.close?.();
    await running.close();
    await running.close();
    await expect(fetch(`${running.url}/health`)).rejects.toThrow();
  });
});
