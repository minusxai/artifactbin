/**
 * WHAT AN OWNER HOST'S `/assets/<hash>` COSTS THE DATABASE (lib/user-pages servesWebAsset), on the plan's world:
 * an owner with 200 eligible pages of about 44 KB, each naming its own web image. Observed before the stored set:
 * every answer, hit or miss and for any 64-hex hash an anonymous caller makes up, was one statement reading all 200
 * sources and parsing them (262–269 ms in production). Now a made-up hash costs one primary-key lookup on
 * web_assets, and a served one two statements that read no page source.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { createUser } from '@/lib/accounts';
import { createArtifact } from '@/lib/artifacts';
import { urlHash } from '@/lib/document';
import { getDb, measureQueries } from '@/lib/platform';
import type { Queryable } from '@/lib/platform/db';
import { servesWebAsset, type UserPagesOwner } from '..';

useAppHarness();

const PAGES = 200;
const filler = `<p>${'Forty-four kilobytes of prose about nothing in particular. '.repeat(750)}</p>`;
const image = (n: number | string) => `https://images.example.test/${n}.png`;

/**
 * The statements `work` issues: its count from the request-scoped meter, its text from the database (filtered to
 * the two tables this answer may read, since the harness's own boot work shares the connection).
 */
async function recorded<T>(work: () => Promise<T>) {
  const db = await getDb();
  const query = db.query.bind(db), transaction = db.transaction.bind(db);
  const sql: string[] = [];
  db.query = (async <R,>(text: string, params?: unknown[]) => { sql.push(text); return query<R>(text, params); }) as typeof db.query;
  db.transaction = (async <R,>(fn: (tx: Queryable) => Promise<R>) => transaction((tx) => fn({ query: async <U,>(text: string, params?: unknown[]) => { sql.push(text); return tx.query<U>(text, params); } }))) as typeof db.transaction;
  try {
    const { value, stats } = await measureQueries(work);
    return { value, sql: sql.filter((text) => /\b(artifacts|web_assets)\b/i.test(text)), count: stats.count };
  } finally { db.query = query; db.transaction = transaction; }
}

/** The fastest of five answers, in ms: a regression bound on this fixture, not a production latency. */
async function fastest(work: () => Promise<unknown>): Promise<number> {
  let best = Infinity;
  for (let i = 0; i < 5; i++) { const started = performance.now(); await work(); best = Math.min(best, performance.now() - started); }
  return best;
}

async function world() {
  const db = await getDb();
  const owner = await createUser({ email: 'mxmx_test_asset_budget@example.com' });
  const other = await createUser({ email: 'mxmx_test_asset_budget_other@example.com' });
  const host: UserPagesOwner = { kind: 'user', id: owner.id, handle: 'asset_budget' };
  // 199 pages as the store writes them (their own image named in meta.webAssets), then the last one through the store.
  await db.query(`INSERT INTO artifacts (id, user_id, creator_user_id, format, visibility, source, meta, edit_id)
    SELECT 'page' || lpad(n::text, 4, '0'), $1, $1, 'html', 'public',
      '<img src="https://images.example.test/' || n || '.png">' || $2, jsonb_build_object('webAssets', jsonb_build_array(hash)), 'edit_' || n
    FROM generate_series(1, ${PAGES - 1}) n, LATERAL (SELECT $3::jsonb ->> (n - 1) AS hash) h`,
    [owner.id, filler, JSON.stringify(Array.from({ length: PAGES - 1 }, (_, i) => urlHash(image(i + 1))))]);
  await createArtifact(null, owner.id, { format: 'html', title: 'Last', source: `<img src="${image('last')}">${filler}`, meta: {}, visibility: 'public' });
  await createArtifact(null, other.id, { format: 'html', title: 'Theirs', source: `<img src="${image('theirs')}">`, meta: {}, visibility: 'public' });
  for (const url of [image('last'), image('theirs')])
    await db.query('INSERT INTO web_assets (url_hash, url, object_key, content_type, bytes) VALUES ($1, $2, $3, $4, 1)', [urlHash(url), url, `webasset/${urlHash(url)}`, 'image/png']);
  await db.query('ANALYZE artifacts');
  return host;
}

describe('owner-host /assets/<hash>', () => {
  it('a made-up hash is refused by one web_assets primary-key lookup, reading no page', async () => {
    const host = await world();
    const unknown = await recorded(() => servesWebAsset(host, 'f'.repeat(64)));
    expect(unknown.value).toBe(false);
    expect(unknown.sql).toHaveLength(1);
    expect(unknown.sql[0]).not.toMatch(/\bartifacts\b/i);
    expect(unknown.sql[0]).toMatch(/\bFROM web_assets WHERE url_hash\s*=\s*\$1/i);
    expect(unknown.count).toBe(1);
    expect(await fastest(() => servesWebAsset(host, 'e'.repeat(64)))).toBeLessThan(25);
  });

  it('a served image costs two statements that read no page source, hit or miss', async () => {
    const host = await world();
    const hit = await recorded(() => servesWebAsset(host, urlHash(image('last'))));
    expect(hit.value).toBe(true);
    for (const text of hit.sql) expect(text).not.toMatch(/\b(source|document)\b/i);
    expect(hit.count).toBe(2);
    const lookup = hit.sql.find((text) => /\bFROM artifacts\b/.test(text))!;
    const plan = (await (await getDb()).query<{ 'QUERY PLAN': string }>(`EXPLAIN ${lookup}`, [host.id, urlHash(image('last'))])).rows.map((row) => row['QUERY PLAN']).join('\n');
    expect(plan).toContain('idx_artifacts_web_assets');
    // Another owner's image is known to web_assets but not served here.
    expect(await servesWebAsset(host, urlHash(image('theirs')))).toBe(false);
    expect(await fastest(() => servesWebAsset(host, urlHash(image('last'))))).toBeLessThan(25);
    expect(await fastest(() => servesWebAsset(host, urlHash(image('theirs'))))).toBeLessThan(25);
  });
});
