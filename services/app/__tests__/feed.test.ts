/**
 * lib/feed.ts reads the events schema the events service owns, with the app's
 * own SELECT and a join on artifacts: "what happened to what I own", newest
 * first, including a fork OF my artifact by someone else (its object is the
 * original) — and answers EMPTY, never an error, when there is no table.
 *
 * Seeded RED by the orchestrator. The table is created here the way the
 * service creates it (the same declaration), because in this suite no events
 * service runs. Rows are inserted ON CONFLICT DO NOTHING: the harness owns
 * wiping (harness-rollout.test forbids a DELETE in any other hook), and the
 * artifacts they join are wiped by it, so every test sees the same picture.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ensureTable } from '@artifactbin/utils';
import { EVENTS_TABLES } from '@artifactbin/events';
import { useAppHarness } from '@/__tests__/harness';
import { EVENTS_SCHEMA } from '@/lib/config';
import { eventsTablePresent, ownerFeed } from '@/lib/feed';

const harness = useAppHarness();
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

beforeEach(async () => {
  const db = await harness.db();
  await db.query(`CREATE SCHEMA IF NOT EXISTS ${EVENTS_SCHEMA}`);
  await ensureTable(db, EVENTS_TABLES, { schema: EVENTS_SCHEMA });
  await db.query(`INSERT INTO artifacts (id, token_id, user_id, content) VALUES ('art0a1', 'tok_a', 'usr_a', 'x'), ('art0a2', 'tok_a', 'usr_a', 'x'), ('art0b1', 'tok_b', 'usr_b', 'x')`);
  const rows: Array<[string, string, string | null, string | null, string, string, string, string]> = [
    ['e1', ago(3), 'visitor', 'v'.repeat(32), 'viewed', 'artifact', 'art0a1', '{"client":"browser"}'],
    ['e2', ago(2), 'user', 'usr_b', 'forked', 'artifact', 'art0a1', '{"fork_id":"art0b9"}'],
    ['e3', ago(1), 'visitor', 'w'.repeat(32), 'viewed', 'artifact', 'art0b1', '{}'],
    ['e4', ago(0), 'user', 'usr_a', 'created', 'artifact', 'art0a2', '{"client":"claude-code"}'],
  ];
  for (const r of rows) {
    await db.query(`INSERT INTO ${EVENTS_SCHEMA}.events (id, at, source, subject_kind, subject_id, verb, object_kind, object_id, payload) VALUES ($1, $2, 'app', $3, $4, $5, $6, $7, $8::jsonb) ON CONFLICT (id) DO NOTHING`, r);
  }
});

describe('ownerFeed', () => {
  it('returns the events on MY artifacts, newest first, a fork of mine included', async () => {
    const feed = await ownerFeed('usr_a');
    expect(feed.map((e) => e.id)).toEqual(['e4', 'e2', 'e1']);
    expect(feed[1]).toMatchObject({ verb: 'forked', subject_kind: 'user', subject_id: 'usr_b', object_id: 'art0a1', payload: { fork_id: 'art0b9' } });
    expect(typeof feed[0]!.at).toBe('string');
    expect(await ownerFeed('usr_b')).toHaveLength(1);
  });
  it('honours the limit', async () => {
    expect((await ownerFeed('usr_a', { limit: 2 })).map((e) => e.id)).toEqual(['e4', 'e2']);
  });
  it('is empty, not an error, when the table is absent — a split deployment with no events service', async () => {
    expect(await eventsTablePresent()).toBe(true);
    const db = await harness.db();
    await db.query(`DROP SCHEMA ${EVENTS_SCHEMA} CASCADE`);
    expect(await eventsTablePresent()).toBe(false);
    expect(await ownerFeed('usr_a')).toEqual([]);
  });
});
