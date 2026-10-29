/**
 * A FOLDER'S SHELF AT VOLUME.
 *
 * A folder of 100 documents, each with a long view history, read as its page (app chrome) and as its
 * `rows` table (a document's `<Files>`):
 *  - the view counts come from the folded totals (lib/analytics/view-totals), one aggregate over the
 *    children, never a subquery per row and never a read of all-time events: the answer does not
 *    change when old events leave the table, and a view recorded since is added once;
 *  - a viewer who is told no numbers pays for none: no statement reads the view events for them;
 *  - the folder page draws no sparkline (its shelf shows none), so none travels and none is drawn;
 *  - the children table, whose `<Files>` kit does draw one, keeps it.
 */
import { describe, expect, it, vi } from 'vitest';
import { GET as pageRoute } from '@/app/api/page/artifact/[id]/route';
import { identityForUser, createUser, type AccessActor } from '@/lib/accounts';
import { getArtifactById, childrenTableFor } from '@/lib/artifacts';
import { getDb, measureQueries } from '@/lib/platform';
import { folderPageFor } from '@/lib/workspace';
import { mintAccountToken, request, useAppHarness } from './harness';

useAppHarness();

/** Days back that carry view events for every child: today, yesterday, three days ago and far outside the sparkline's 14. */
const DAYS = [0, 1, 3, 40];
const childId = (i: number) => `fv${String(i).padStart(3, '0')}`;
const visitorsOf = (i: number) => i % 7 + 2;
/** Child i is opened by visitorsOf(i) distinct visitors per day, plus two legacy rows without a visitor. */
const expectedViews = (i: number) => DAYS.length * visitorsOf(i) + 2;

async function seed(children: number) {
  const db = await getDb();
  const user = await createUser({ email: 'mxmx_test_folder_volume@example.com' });
  const token = await mintAccountToken('folder-volume', user.id);
  await db.query(
    `INSERT INTO artifacts (id, user_id, token_id, format, title, meta, version, visibility) VALUES ('fvfolder', $1, $2, 'folder', 'Volume', '{}', 1, 'private')`,
    [user.id, token.id],
  );
  await db.query(
    `INSERT INTO artifacts (id, user_id, token_id, format, title, meta, version, visibility, ancestor_ids, updated_at)
     SELECT 'fv' || lpad(i::text, 3, '0'), $1, $2, 'markup', 'Document ' || i, '{}', 1, 'private', ARRAY['fvfolder'], now() - (i || ' minutes')::interval
     FROM generate_series(1, $3::int) i`,
    [user.id, token.id, children],
  );
  await db.query(
    `INSERT INTO analytics_events (event, artifact_id, visitor, created_at)
     SELECT 'view', 'fv' || lpad(i::text, 3, '0'), d || '-' || (j % (i % 7 + 2)), now() - (d || ' days')::interval
     FROM generate_series(1, $1::int) i, unnest($2::int[]) d, generate_series(1, (i % 7 + 2) * 3) j`,
    [children, DAYS],
  );
  await db.query(
    `INSERT INTO analytics_events (event, artifact_id, visitor, created_at)
     SELECT 'view', 'fv' || lpad(i::text, 3, '0'), NULL, now() - interval '5 days' FROM generate_series(1, $1::int) i, generate_series(1, 2)`,
    [children],
  );
  return { user, token, viewer: identityForUser(user.id, token.id, user.email) };
}

const viewsOf = (rows: Array<{ id: string; views?: unknown }>) => Object.fromEntries(rows.map((row) => [row.id, row.views]));
const expectedAll = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, k) => [childId(k + 1), expectedViews(k + 1)]));
const STRANGER = identityForUser(null, null, null);

describe('the folder page at volume', () => {
  it('counts every child\'s views from the folded totals, exactly as the raw events say', async () => {
    const { viewer } = await seed(100);
    const page = await folderPageFor((await getArtifactById('fvfolder'))!, viewer);
    expect(page.rows).toHaveLength(100);
    expect(viewsOf(page.rows)).toEqual(expectedAll(100));
    const db = await getDb();
    const reference = await db.query<{ id: string; views: number }>(
      `SELECT artifact_id AS id, COUNT(DISTINCT COALESCE(visitor, seq::text))::int AS views FROM analytics_events WHERE event = 'view' GROUP BY artifact_id`,
    );
    expect(viewsOf(page.rows)).toEqual(viewsOf(reference.rows));
  });

  it('does not depend on the view events that remain: closed days are folded into a total, once', async () => {
    const { viewer } = await seed(40);
    const folder = (await getArtifactById('fvfolder'))!;
    expect(viewsOf((await folderPageFor(folder, viewer)).rows)).toEqual(expectedAll(40));
    const db = await getDb();
    await db.query("DELETE FROM analytics_events WHERE created_at < (now() AT TIME ZONE 'UTC')::date");
    expect(viewsOf((await folderPageFor(folder, viewer)).rows)).toEqual(expectedAll(40));
    await db.query("INSERT INTO analytics_events (event, artifact_id, visitor) VALUES ('view', $1, 'brand-new-visitor')", [childId(3)]);
    const third = viewsOf((await folderPageFor(folder, viewer)).rows);
    expect(third[childId(3)]).toBe(expectedViews(3) + 1);
    expect(third[childId(4)]).toBe(expectedViews(4));
  });

  it('draws and sends no sparkline: the page\'s shelf shows none', async () => {
    const { viewer } = await seed(100);
    const page = await folderPageFor((await getArtifactById('fvfolder'))!, viewer);
    for (const row of page.rows) expect(row).not.toHaveProperty('sparkline');
    // …and no view event is read per day for one: the only statements that read events are the totals'.
    const db = await getDb();
    const query = vi.spyOn(db, 'query');
    try {
      await folderPageFor((await getArtifactById('fvfolder'))!, viewer);
      const reads = query.mock.calls.map(([sql]) => String(sql)).filter((sql) => /analytics_events/.test(sql));
      expect(reads.filter((sql) => !sql.includes('artifact_view_totals')).map((sql) => sql.slice(0, 60))).toEqual([]);
      expect(reads).toHaveLength(1);
    } finally { query.mockRestore(); }
  });

  it('reads a number of statements that does not grow with the children', async () => {
    const { viewer } = await seed(100);
    const folder = (await getArtifactById('fvfolder'))!;
    await folderPageFor(folder, viewer);
    const db = await getDb();
    await db.query("DELETE FROM artifacts WHERE id > 'fv010' AND id <> 'fvfolder'");
    const small = await measureQueries(() => folderPageFor(folder, viewer));
    expect(small.value.rows).toHaveLength(10);
    await seed100Again(db, viewer);
    // The first read of a child folds its closed days into its total (one more statement, once): read, then measure.
    await folderPageFor(folder, viewer);
    const large = await measureQueries(() => folderPageFor(folder, viewer));
    expect(large.value.rows.length).toBeGreaterThan(50);
    expect(large.stats.count).toBe(small.stats.count);
  });

  it('pays for no view counts when the viewer is told none', async () => {
    const { user } = await seed(30);
    const db = await getDb();
    await db.query("UPDATE artifacts SET visibility = 'public' WHERE id = 'fvfolder' OR ancestor_ids @> ARRAY['fvfolder']");
    const query = vi.spyOn(db, 'query');
    try {
      const page = await folderPageFor((await getArtifactById('fvfolder'))!, STRANGER);
      expect(page.rows).toHaveLength(30);
      for (const row of page.rows) expect(row).not.toHaveProperty('views');
      expect(query.mock.calls.map(([sql]) => String(sql)).filter((sql) => /analytics_events/.test(sql))).toEqual([]);
    } finally { query.mockRestore(); }
    expect(user.id).toBeTruthy();
  });

  it('answers the page endpoint without a per-child picture in its payload', async () => {
    const { user, token } = await seed(100);
    const response = await pageRoute(request('/api/page/artifact/fvfolder', { actor: { userId: user.id, email: user.email, emailVerified: true, credential: 'session' } }), { params: Promise.resolve({ id: 'fvfolder' }) });
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain('<svg');
    expect(text).not.toContain('"sparkline"');
    expect(token.id).toBeTruthy();
  });
});

describe('the children table', () => {
  it('keeps the views and the sparkline the Files kit draws, one picture per distinct history', async () => {
    const { viewer } = await seed(100);
    const { rows } = await childrenTableFor((await getArtifactById('fvfolder'))!, viewer);
    expect(rows).toHaveLength(100);
    expect(viewsOf(rows as Array<{ id: string; views: number }>)).toEqual(expectedAll(100));
    for (const row of rows) expect(String(row.sparkline)).toContain('<svg');
    expect((await childrenTableFor((await getArtifactById('fvfolder'))!, STRANGER)).rows).toHaveLength(0);
  });
});

async function seed100Again(db: Awaited<ReturnType<typeof getDb>>, viewer: AccessActor) {
  await db.query(
    `INSERT INTO artifacts (id, user_id, token_id, format, title, meta, version, visibility, ancestor_ids)
     SELECT 'fx' || lpad(i::text, 3, '0'), $1, $2, 'markup', 'More ' || i, '{}', 1, 'private', ARRAY['fvfolder'] FROM generate_series(1, 90) i`,
    [viewer.userId, viewer.tokenId],
  );
}
