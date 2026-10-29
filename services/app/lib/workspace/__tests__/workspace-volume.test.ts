/**
 * HOME'S INSIGHTS AND THE OWNER LISTING AT VOLUME.
 *
 * Two promises, each proven against an account shaped like a real one (many documents, each with a
 * long view history) instead of a fixture that fits in one screen:
 *  - Home's insights answer in a bounded number of statements and carry NUMBERS, never rendered
 *    markup: no document's sparkline travels, so the payload is a few bytes per document;
 *  - a document's view count is read from a per-document total that closed days fold into once, so the
 *    listing's cost does not follow the all-time number of view events (proven by deleting them).
 */
import { describe, expect, it, vi } from 'vitest';
import { GET as homeRoute } from '@/app/api/page/home/route';
import { createUser } from '@/lib/accounts';
import { artifactSummaryToWire } from '@/lib/artifact-wire';
import { getDb, measureQueries, EVENTS_SCHEMA } from '@/lib/platform';
import { accountWorkspaceFor, accountWorkspaceInsightsFor, listDraftsByTokenIds, listOwnedArtifacts } from '@/lib/workspace';
import { ensureEventsSchema } from '@artifactbin/events/local';
import { mintAccountToken, request, useAppHarness } from '@/__tests__/harness';

useAppHarness();

/** Days back that carry view events for every document: today, yesterday, three days ago and far outside the 30-day series. */
const DAYS = [0, 1, 3, 40];
const docId = (i: number, tag = 'vol') => `${tag}${String(i).padStart(3, '0')}`;
/** Document i is opened by min(i % 7 + 2, VISITORS) distinct visitors per day, over (i % 7 + 2) * 3 events. */
const visitorsOf = (i: number) => i % 7 + 2;
const NULL_VISITOR_ROWS = 2;
/** What document i's all-time unique daily visitors are, restated from the rule above. */
const expectedViews = (i: number) => DAYS.length * visitorsOf(i) + NULL_VISITOR_ROWS;

/** An account with `docs` markup documents (6KB of compiled meta each), a dataset, and a long view history for each document. */
async function seed(docs: number, tag = 'vol') {
  const db = await getDb();
  const user = await createUser({ email: `mxmx_test_${tag}@example.com` });
  const token = await mintAccountToken('volume', user.id);
  await db.query(
    `INSERT INTO artifacts (id, user_id, token_id, format, title, meta, version, visibility, updated_at)
     SELECT '${tag}' || lpad(i::text, 3, '0'), $1, $2, 'html', 'Document ' || i,
       jsonb_build_object('theme', 'paper', 'template', 'blank', 'css', repeat('.x{color:red}', 500)), 1, 'private', now() - (i || ' minutes')::interval
     FROM generate_series(1, $3::int) i`,
    [user.id, token.id, docs],
  );
  await db.query(`INSERT INTO artifacts (id, user_id, token_id, format, title, meta, version) VALUES ('${tag}ds1', $1, $2, 'dataset', 'Data', '{"rowCount": 3}', 1)`, [user.id, token.id]);
  await db.query(
    `INSERT INTO analytics_events (event, artifact_id, visitor, created_at)
     SELECT 'view', '${tag}' || lpad(i::text, 3, '0'), d || '-' || (j % (i % 7 + 2)), now() - (d || ' days')::interval
     FROM generate_series(1, $1::int) i, unnest($2::int[]) d, generate_series(1, (i % 7 + 2) * 3) j`,
    [docs, DAYS],
  );
  await db.query(
    `INSERT INTO analytics_events (event, artifact_id, visitor, created_at)
     SELECT 'view', '${tag}' || lpad(i::text, 3, '0'), NULL, now() - interval '5 days' FROM generate_series(1, $1::int) i, generate_series(1, ${NULL_VISITOR_ROWS})`,
    [docs],
  );
  await db.query(`INSERT INTO analytics_events (event, artifact_id, visitor) VALUES ('view', '${tag}ds1', 'x'), ('export', '${tag}001', 'y')`);
  await ensureEventsSchema(db, EVENTS_SCHEMA);
  await db.query(
    `INSERT INTO ${EVENTS_SCHEMA}.events (id, at, source, subject_kind, subject_id, verb, object_kind, object_id, payload)
     SELECT '${tag}e' || i || '_' || d || '_' || v, now() - (d || ' days')::interval, 'app', 'visitor', 'v' || v || 'd' || d, 'viewed', 'artifact', '${tag}' || lpad(i::text, 3, '0'), '{}'::jsonb
     FROM generate_series(1, $1::int) i, generate_series(0, 29) d, generate_series(1, 2) v`,
    [docs],
  );
  return user;
}

const viewsById = (rows: Array<{ id: string; views: number }>) => Object.fromEntries(rows.map((row) => [row.id, row.views]));
const expectedById = (docs: number, tag = 'vol') => Object.fromEntries(Array.from({ length: docs }, (_, k) => [docId(k + 1, tag), expectedViews(k + 1)]));

describe('Home insights', () => {
  it('carry numbers, not drawn sparklines: the payload is a few bytes per document', async () => {
    const docs = 60;
    const user = await seed(docs);
    const insights = await accountWorkspaceInsightsFor(user.id);
    expect(insights).not.toHaveProperty('sparklines');
    expect(JSON.stringify(insights)).not.toContain('<svg');
    expect(insights.views).toMatchObject({ [docId(1)]: expectedViews(1), [docId(60)]: expectedViews(60) });
    expect(insights.stats).toEqual({ artifacts: docs, assets: 1, views: Object.values(expectedById(docs)).reduce((a, b) => a + b, 0) });
    expect(insights.viewsOverTime).toHaveLength(30);
    expect(insights.viewsOverTime.reduce((a, b) => a + b, 0)).toBe(docs * 2 * 30);
    expect(JSON.stringify(insights).length).toBeLessThan(docs * 40 + 2500);
    // The route says the same: the wire has the field nowhere.
    const response = await homeRoute(request('/api/page/home?part=insights', { actor: { credential: 'session', userId: user.id, email: user.email!, emailVerified: true } }));
    const body = await response.json();
    expect(body).not.toHaveProperty('sparklines');
    expect(JSON.stringify(body).length).toBeLessThan(docs * 40 + 2600);
  });

  it('read in a bounded number of statements that does not grow with the documents, and probe the events table once', async () => {
    const small = await seed(10, 'vsm');
    await accountWorkspaceInsightsFor(small.id); // compacts closed days, learns the events table is there
    const db = await getDb();
    const query = vi.spyOn(db, 'query');
    try {
      const cold = await measureQueries(() => accountWorkspaceInsightsFor(small.id));
      expect(query.mock.calls.some(([sql]) => String(sql).includes('to_regclass'))).toBe(false);
      expect(cold.stats.count).toBeLessThanOrEqual(6);
      // 50 more documents, 5x the events: the same statements.
      const big = await seed(60, 'vbg');
      await accountWorkspaceInsightsFor(big.id);
      const warm = await measureQueries(() => accountWorkspaceInsightsFor(big.id));
      expect(warm.stats.count).toBe(cold.stats.count);
    } finally { query.mockRestore(); }
  });

  it('count each document\'s views once, in one place, for the stats and the per-document map', async () => {
    const user = await seed(25);
    const db = await getDb();
    const query = vi.spyOn(db, 'query');
    try {
      await accountWorkspaceInsightsFor(user.id);
      // Before: the per-document counts and the account total each scanned every view event of the account.
      // Now every statement that reads events says it reads them through the folded totals.
      const reads = query.mock.calls.map(([sql]) => String(sql)).filter((sql) => /analytics_events/.test(sql));
      expect(reads.filter((sql) => !sql.includes('artifact_view_totals')).map((sql) => sql.slice(0, 60))).toEqual([]);
      expect(reads).toHaveLength(1);
    } finally { query.mockRestore(); }
  });

  it('keep the full workspace (Home plus a folder page) carrying views per row and no drawn sparkline', async () => {
    const user = await seed(8);
    const workspace = await accountWorkspaceFor(user.id, user.email);
    expect(workspace.artifacts.filter((row) => row.format === 'html').map((row) => row.views).sort()).toEqual(Array.from({ length: 8 }, (_, k) => expectedViews(k + 1)).sort());
    for (const row of workspace.artifacts) expect(row).not.toHaveProperty('sparkline');
  });
});

describe('the owner listing', () => {
  it('counts unique daily visitors per document, exactly as the raw events say, for every document', async () => {
    const docs = 40;
    const user = await seed(docs);
    const rows = await listOwnedArtifacts('user_id', user.id);
    expect(rows).toHaveLength(docs + 1);
    expect(viewsById(rows.filter((row) => row.format === 'html'))).toEqual(expectedById(docs));
    expect(rows.find((row) => row.id === 'volds1')?.views).toBe(1);
    // The reference: what the retired per-row subquery counted.
    const db = await getDb();
    const reference = await db.query<{ id: string; views: number }>(
      `SELECT artifact_id AS id, COUNT(DISTINCT COALESCE(visitor, seq::text))::int AS views FROM analytics_events WHERE event = 'view' GROUP BY artifact_id`,
    );
    expect(viewsById(rows)).toEqual(viewsById(reference.rows));
  });

  it('does not depend on the number of view events that remain: closed days are folded into a total', async () => {
    const docs = 30;
    const user = await seed(docs);
    const first = await listOwnedArtifacts('user_id', user.id);
    expect(viewsById(first.filter((row) => row.format === 'html'))).toEqual(expectedById(docs));
    const db = await getDb();
    // Everything before today leaves the table (retention, or simply a very long history elsewhere).
    await db.query("DELETE FROM analytics_events WHERE created_at < (now() AT TIME ZONE 'UTC')::date");
    const second = await listOwnedArtifacts('user_id', user.id);
    expect(viewsById(second.filter((row) => row.format === 'html'))).toEqual(expectedById(docs));
    // …and a view recorded afterwards is added to the folded total, once.
    await db.query("INSERT INTO analytics_events (event, artifact_id, visitor) VALUES ('view', $1, 'brand-new-visitor')", [docId(3)]);
    const third = await listOwnedArtifacts('user_id', user.id);
    expect(third.find((row) => row.id === docId(3))?.views).toBe(expectedViews(3) + 1);
    expect(third.find((row) => row.id === docId(4))?.views).toBe(expectedViews(4));
  });

  it('folds each closed day exactly once even when several reads race', async () => {
    const docs = 12;
    const user = await seed(docs);
    const racers = await Promise.all([1, 2, 3, 4].map(() => listOwnedArtifacts('user_id', user.id)));
    for (const rows of racers) expect(viewsById(rows.filter((row) => row.format === 'html'))).toEqual(expectedById(docs));
    const again = await listOwnedArtifacts('user_id', user.id);
    expect(viewsById(again.filter((row) => row.format === 'html'))).toEqual(expectedById(docs));
  });

  it('issues a number of statements that does not grow with the documents or their events', async () => {
    const small = await seed(5, 'lsm');
    const big = await seed(60, 'lbg');
    const smallFirst = await measureQueries(() => listOwnedArtifacts('user_id', small.id));
    const bigFirst = await measureQueries(() => listOwnedArtifacts('user_id', big.id));
    expect(bigFirst.stats.count).toBe(smallFirst.stats.count);
    const smallWarm = await measureQueries(() => listOwnedArtifacts('user_id', small.id));
    const bigWarm = await measureQueries(() => listOwnedArtifacts('user_id', big.id));
    expect(bigWarm.stats.count).toBe(smallWarm.stats.count);
    expect(bigWarm.stats.count).toBeLessThanOrEqual(2);
  });

  it('selects no more of a document\'s meta than its summary wire shows', async () => {
    const user = await seed(6);
    const rows = await listOwnedArtifacts('user_id', user.id);
    const markup = rows.find((row) => row.id === docId(1))!;
    expect(markup.meta).toEqual({});
    expect(JSON.stringify(rows).length).toBeLessThan(6 * 1200);
    // The dataset's listed facts survive; the wire is what it always was.
    expect(artifactSummaryToWire(rows.find((row) => row.id === 'volds1')!, 'http://app.test').meta).toEqual({ rowCount: 3 });
    expect(artifactSummaryToWire(markup, 'http://app.test').meta).toEqual({});
  });

  it('serves a browser\'s unclaimed drafts the same way', async () => {
    const db = await getDb();
    const token = await mintAccountToken('draft-holder', null);
    await db.query("INSERT INTO artifacts (id, token_id, user_id, format, title, meta, version) VALUES ('draft1', $1, NULL, 'html', 'Draft', '{\"css\":\"x\"}', 1)", [token.id]);
    await db.query("INSERT INTO analytics_events (event, artifact_id, visitor, created_at) VALUES ('view','draft1','a', now() - interval '2 days'),('view','draft1','b-old', now() - interval '2 days'),('view','draft1','b-new', now())");
    const drafts = await listDraftsByTokenIds([token.id]);
    expect(drafts.map((draft) => [draft.id, draft.views])).toEqual([['draft1', 3]]);
    const token2 = await listOwnedArtifacts('token_id', token.id);
    expect(token2.map((row) => [row.id, row.views])).toEqual([['draft1', 3]]);
  });
});
