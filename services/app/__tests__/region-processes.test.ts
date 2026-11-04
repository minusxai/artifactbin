/**
 * TWO APP PROCESSES, ONE DATABASE (production runs two). Two RegionSessions instances share nothing but the database:
 * each has its own document cache, client-id memory, LISTEN subscriptions, stream registry and timers, exactly what
 * a second process would have. Editors on each type at once; every update is accepted once, in one order, and both
 * streams deliver all of them; saves racing from both make one version.
 *
 * Always run on the harness's PGLite (which serializes whole transactions, so it proves the protocol, not the row
 * locks). With REGION_TEST_DATABASE_URL (a disposable PostgreSQL database) the same scenario also runs on TWO
 * connection pools, each with its own LISTEN connection: concurrent transactions really race on FOR UPDATE and
 * NOTIFY really crosses connections. This is as close to two processes as a test file gets: the code paths are the
 * process's, and nothing in them is shared through memory.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { createUser, identityForUser, type AccessActor } from '@/lib/accounts';
import { createArtifact } from '@/lib/artifacts';
import { canonicalizeHtmlPage } from '@/lib/html-page';
import { editableRegions, openRegionDoc, regionHtml, regionText } from '@/lib/live-regions';
import { createRegionSessions, type RegionSessions } from '@/lib/region-sessions';
import { getDb, PostgresDb, SCHEMA_STATEMENTS, type Db } from '@/lib/platform';
import { nativeHtml } from './native-html-fixture';
import { useAppHarness } from './harness';
import { sseStream } from './sse';

useAppHarness();

const BODY = '<article data-af-editable="rich"><p>Hello world</p></article>';

/** One "process": its own instance over its own database handle. */
function processOn(db: () => Promise<Db>): RegionSessions {
  return createRegionSessions({ db, keepaliveFrame: () => 'event: keepalive\ndata: {}\n\n', subscribe: async (channel, handler, onLost) => (await db()).listen(channel, handler, onLost), leaveGraceMs: 60_000 });
}

interface Scenario { pageId: string; regionId: string; alice: AccessActor; bob: AccessActor; dbs: [() => Promise<Db>, () => Promise<Db>]; headVersion(): Promise<number> }

async function editor(sessions: RegionSessions, actor: AccessActor, scenario: Scenario) {
  const opened = await sessions.open(actor, scenario.pageId, scenario.regionId);
  if (opened.status !== 200) throw new Error(`open ${opened.status} ${JSON.stringify(opened.body)}`);
  const doc = openRegionDoc(Buffer.from(opened.body.state, 'base64'), { clientId: opened.body.clientId });
  return { doc, seq: opened.body.seq, clientId: opened.body.clientId };
}

async function concurrentTyping(scenario: Scenario) {
  const [one, two] = [processOn(scenario.dbs[0]), processOn(scenario.dbs[1])];
  const aborts: AbortController[] = [];
  try {
    const a = await editor(one, scenario.alice, scenario), b = await editor(two, scenario.bob, scenario);
    const watch = async (sessions: RegionSessions, actor: AccessActor) => {
      const abort = new AbortController();
      aborts.push(abort);
      const opened = await sessions.stream(actor, scenario.pageId, `${scenario.regionId}:${b.seq}`, abort.signal);
      if (opened.status !== 'open') throw new Error(opened.status);
      return sseStream(opened.stream);
    };
    const [streamOne, streamTwo] = [await watch(one, scenario.alice), await watch(two, scenario.bob)];
    const ROUNDS = 15;
    const typist = async (sessions: RegionSessions, actor: AccessActor, side: typeof a, letter: string) => {
      const seqs: number[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const before = Y.encodeStateVector(side.doc);
        regionText(side.doc).insert(0, `${letter}${i} `, {});
        const answer = await sessions.update(actor, scenario.pageId, scenario.regionId, { clientId: side.clientId, update: Y.encodeStateAsUpdate(side.doc, before) });
        if (answer.status !== 200) throw new Error(`update ${answer.status} ${JSON.stringify(answer.body)}`);
        seqs.push(answer.body.seq);
      }
      return seqs;
    };
    const [seqsA, seqsB] = await Promise.all([typist(one, scenario.alice, a, 'A'), typist(two, scenario.bob, b, 'B')]);
    const all = [...seqsA, ...seqsB].sort((x, y) => x - y);
    expect(all).toEqual(Array.from({ length: 2 * ROUNDS }, (_unused, i) => b.seq + 1 + i));

    const replay = async (frames: ReturnType<typeof sseStream>) => {
      const replica = openRegionDoc(undefined, { gc: true });
      let to = b.seq;
      const deadline = Date.now() + 10_000;
      while (to < b.seq + 2 * ROUNDS && Date.now() < deadline) {
        for (const event of await frames.next(1, deadline - Date.now())) {
          const frame = event.data as { type?: string; from?: number; to?: number; updates?: string[] };
          if (frame.type !== 'updates') continue;
          expect(frame.from).toBe(to + 1);
          for (const update of frame.updates!) Y.applyUpdate(replica, Buffer.from(update, 'base64'));
          to = frame.to!;
        }
      }
      expect(to).toBe(b.seq + 2 * ROUNDS);
      return replica;
    };
    const base = openRegionDoc(Y.encodeStateAsUpdate(a.doc), { gc: true });
    const [seenOne, seenTwo] = await Promise.all([replay(streamOne), replay(streamTwo)]);
    for (const seen of [seenOne, seenTwo]) {
      Y.applyUpdate(seen, Y.encodeStateAsUpdate(base));
      for (let i = 0; i < ROUNDS; i++) for (const letter of ['A', 'B']) expect(regionText(seen).toString()).toContain(`${letter}${i} `);
    }
    expect(regionHtml('rich', Y.encodeStateAsUpdate(seenOne))).toBe(regionHtml('rich', Y.encodeStateAsUpdate(seenTwo)));

    // Saves racing from both processes make exactly one version, holding everyone's text.
    const before = await scenario.headVersion();
    const flushed = await Promise.all([one.flush(scenario.alice, scenario.pageId), two.flush(scenario.bob, scenario.pageId)]);
    expect(flushed.map((answer) => answer.status)).toEqual([200, 200]);
    expect(await scenario.headVersion()).toBe(before + 1);
    expect(new Set(flushed.map((answer) => answer.status === 200 && answer.body.version))).toEqual(new Set([before + 1]));

    // A process whose cached document predates the other's save still validates against the saved state.
    const after = Y.encodeStateVector(b.doc);
    for (const frame of await streamTwo.next(5, 300)) if ((frame.data as { type?: string }).type === 'updates') for (const update of (frame.data as { updates: string[] }).updates) Y.applyUpdate(b.doc, Buffer.from(update, 'base64'), 'server');
    regionText(b.doc).insert(0, 'after save ', {});
    const late = await two.update(scenario.bob, scenario.pageId, scenario.regionId, { clientId: b.clientId, update: Y.encodeStateAsUpdate(b.doc, after) });
    expect(late.status).toBe(200);
  } finally {
    for (const abort of aborts) abort.abort();
    one.dispose(); two.dispose();
  }
}

describe('two instances over the harness database', () => {
  it('serialize concurrent updates from both into one order that both streams deliver whole', async () => {
    const [alice, bob] = await Promise.all(['alice', 'bob'].map((name) => createUser({ email: `mxmx_test_region_two_${name}@example.com` })));
    const row = await createArtifact(null, alice!.id, { format: 'html', source: nativeHtml(BODY), meta: {}, visibility: 'private' });
    await (await getDb()).query("INSERT INTO artifact_shares (artifact_id, email, role) VALUES ($1, $2, 'editor')", [row.id, bob!.email]);
    await concurrentTyping({
      pageId: row.id, regionId: editableRegions(row.source!)[0]!.id,
      alice: identityForUser(alice!.id, null), bob: identityForUser(bob!.id, null), dbs: [getDb, getDb],
      headVersion: async () => (await (await getDb()).query<{ version: number }>('SELECT version FROM artifacts WHERE id = $1', [row.id])).rows[0]!.version,
    });
  });
});

const postgres = process.env.REGION_TEST_DATABASE_URL;
describe.skipIf(!postgres)('two connection pools over one PostgreSQL database', () => {
  const schema = `regions_${randomBytes(6).toString('hex')}`;
  let admin: pg.Pool, pools: PostgresDb[] = [];
  beforeAll(async () => {
    pg.types.setTypeParser(1184, (value: string) => new Date(value).toISOString());
    admin = new pg.Pool({ connectionString: postgres });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const boot = new pg.Pool({ connectionString: postgres, options: `-c search_path=${schema}` });
    for (const statement of SCHEMA_STATEMENTS) await boot.query(statement);
    await boot.end();
    pools = [0, 1].map(() => new PostgresDb(new pg.Pool({ connectionString: postgres, options: `-c search_path=${schema}`, max: 4 }) as never));
  });
  afterAll(async () => {
    // A pool ends only once its clients are back; the one holding this process's LISTENs never is, so it is destroyed.
    for (const pool of pools) { (pool as unknown as { listenClient: { release(destroy: boolean): void } | null }).listenClient?.release(true); await pool.close(); }
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end();
  });

  it('serialize concurrent updates racing on row locks and deliver every one through NOTIFY across connections', async () => {
    const [first] = pools;
    const page = canonicalizeHtmlPage(nativeHtml(BODY));
    await first!.query("INSERT INTO users (id, email, kind) VALUES ('alice', 'mxmx_test_pg_alice@example.com', 'account'), ('bob', 'mxmx_test_pg_bob@example.com', 'account')");
    await first!.query("INSERT INTO artifacts (id, token_id, user_id, format, visibility, version, source, meta) VALUES ('pgpage', 'tok_pg', 'alice', 'html', 'private', 1, $1, $2)", [page.html, JSON.stringify({ htmlIdentity: page.ledger })]);
    await first!.query("INSERT INTO artifact_shares (artifact_id, email, role) VALUES ('pgpage', 'mxmx_test_pg_bob@example.com', 'editor')");
    await concurrentTyping({
      pageId: 'pgpage', regionId: editableRegions(page.html)[0]!.id,
      alice: identityForUser('alice', null), bob: identityForUser('bob', null),
      dbs: [async () => pools[0]!, async () => pools[1]!],
      headVersion: async () => (await first!.query<{ version: number }>("SELECT version FROM artifacts WHERE id = 'pgpage'")).rows[0]!.version,
    });
  });
});
