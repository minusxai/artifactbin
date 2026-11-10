/**
 * THE FEED POSITION: the events service numbers every row when it durably accepts it, from one counter row, so the
 * public feed (/api/events) can resume after a position and never skip a later commit. On PGLite (one connection)
 * these pin numbering, dedupe, backfill and the job-event door; the concurrent-commit proof needs real PostgreSQL
 * connections and lives in feed-position-postgres.test.ts.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, expect, it } from 'vitest';
import { testDb } from '@artifactbin/test-support/db';
import type { EventEnvelope, Queryable } from '@artifactbin/contracts';
import { EVENTS_ROUTES } from '@artifactbin/contracts';
import { serveEvents } from '@artifactbin/events';
import { createEvents, ensureEventsSchema } from '@artifactbin/events/local';

const SCHEMA = 'feed_position';
const db: Queryable = testDb();
const event = (over: Partial<EventEnvelope> = {}): EventEnvelope => ({
  id: randomUUID(), at: new Date().toISOString(), source: 'app', subject_kind: 'user', subject_id: 'usr_1',
  verb: 'annotated', object_kind: 'artifact', object_id: 'doc', payload: { annotation_id: 'ann_1' }, ...over,
});
const job = (over: Partial<EventEnvelope> = {}): EventEnvelope => event({
  source: 'minusx', subject_kind: 'service', subject_id: 'minusx', object_kind: 'job', object_id: 'sch_1', verb: 'run_started',
  payload: { schedule_id: 'sch_1', occurrence_id: 'occ_1', group_id: 'grp_1' }, ...over,
});
const positions = async () => (await db.query<{ id: string; position: string }>(
  `SELECT e.id, e.position::text AS position FROM ${SCHEMA}.events e ORDER BY e.position`)).rows;

beforeEach(async () => {
  await ensureEventsSchema(db, SCHEMA);
  await db.query(`DELETE FROM ${SCHEMA}.events`);
});

it('numbers each accepted row from one counter: batch order, ascending across batches, a replay keeps its number', async () => {
  const writer = createEvents({ db, schema: SCHEMA });
  const first = [event(), event()], second = [event()];
  await writer.publish(first);
  await writer.publish(second);
  // The emitter's time plays no part: a late, older event is still numbered after everything already accepted.
  const late = event({ at: '2020-01-01T00:00:00.000Z' });
  await writer.publish([late, first[0]!]);
  const rows = await positions();
  expect(rows.map(row => row.id)).toEqual([...first, ...second, late].map(e => e.id));
  const numbers = rows.map(row => BigInt(row.position));
  for (let i = 1; i < numbers.length; i++) expect(numbers[i]! > numbers[i - 1]!).toBe(true);
  // A second writer on the same schema (another process) continues the same counter.
  await createEvents({ db, schema: SCHEMA }).publish([event()]);
  const after = await positions();
  expect(BigInt(after.at(-1)!.position) > numbers.at(-1)!).toBe(true);
});

it('numbers rows stored before positions existed at the next ensure, in emitter order and above the head', async () => {
  await createEvents({ db, schema: SCHEMA }).publish([event()]);
  const head = BigInt((await positions())[0]!.position);
  await db.query(`INSERT INTO ${SCHEMA}.events (id, at, source, verb, object_kind, object_id) VALUES
    ('old_b', '2024-01-02', 'app', 'annotated', 'artifact', 'doc'), ('old_a', '2024-01-01', 'app', 'annotated', 'artifact', 'doc')`);
  await ensureEventsSchema(db, SCHEMA);
  const rows = await positions();
  expect(rows.map(row => row.id).slice(1)).toEqual(['old_a', 'old_b']);
  expect(BigInt(rows[1]!.position)).toBe(head + 1n);
  await createEvents({ db, schema: SCHEMA }).publish([event({ id: 'new' })]);
  expect((await positions()).at(-1)).toEqual({ id: 'new', position: String(head + 3n) });
});

it('accepts a catalogued job event and refuses one the feed could not authorize, in process and over the publish route', async () => {
  const writer = createEvents({ db, schema: SCHEMA });
  await writer.publish([job()]);
  for (const bad of [job({ verb: 'run_exploded' }), job({ payload: { schedule_id: 'sch_1', occurrence_id: 'occ_1' } })])
    await expect(writer.publish([bad])).rejects.toThrow(/Invalid job event/);
  const server = serveEvents(writer, { serviceSecret: 'secret' });
  const { url } = server.listen(0);
  try {
    const post = (body: unknown) => fetch(url + EVENTS_ROUTES.publish, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-artifactbin-service-secret': 'secret' }, body: JSON.stringify(body) });
    const accepted = job({ id: 'job_ok', verb: 'run_succeeded' });
    expect((await post([accepted])).status).toBe(200);
    expect((await post([job({ payload: {} })])).status).toBe(400);
  } finally { await server.close(); }
  expect((await db.query(`SELECT verb FROM ${SCHEMA}.events WHERE object_kind = 'job' ORDER BY position`)).rows)
    .toEqual([{ verb: 'run_started' }, { verb: 'run_succeeded' }]);
});
