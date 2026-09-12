import { expect, it, vi } from 'vitest';
import { GET as assetsPage } from '@/app/api/page/assets/route';
import { GET } from '@/app/api/page/home/route';
import { createUser } from '@/lib/users';
import { request, useAppHarness } from './harness';
import * as feed from '@/lib/feed';
import { accountWorkspaceInsightsFor } from '@/lib/workspace';
import { mintToken } from '@/lib/tokens';
import { EVENTS_SCHEMA } from '@/lib/config';
import { ensureEventsSchema } from '@artifactbin/events/local';
const harness = useAppHarness();

it('workspace view totals exclude non-markup artifacts', async () => {
  const db = await harness.db();
  const user = await createUser({ email: 'mxmx_test_views@example.com' });
  const token = await mintToken('views');
  await db.query("INSERT INTO artifacts (id, user_id, token_id, format, title, content, meta, version) VALUES ('doc123', $1, $2, 'markup', 'Document', '', '{}', 1), ('data12', $1, $2, 'dataset', 'Data', '', '{}', 1)", [user.id, token.id]);
  await ensureEventsSchema(db, EVENTS_SCHEMA);
  await db.query(`INSERT INTO ${EVENTS_SCHEMA}.events (id, at, source, verb, object_kind, object_id, subject_kind, subject_id, payload) VALUES ('view_doc', now(), 'app', 'viewed', 'artifact', 'doc123', 'visitor', 'a', '{}'), ('view_data', now(), 'app', 'viewed', 'artifact', 'data12', 'visitor', 'b', '{}')`);
  const insights = await accountWorkspaceInsightsFor(user.id);
  expect(insights.viewsOverTime.reduce((a, b) => a + b, 0)).toBe(1);
  expect(insights.sparklines).not.toHaveProperty('data12');
});

it('core is independently authorized and finishes without executing the blocked insights work', async () => {
  const user = await createUser({ email: 'mxmx_test_progressive@example.com' });
  const slow = vi.spyOn(feed, 'ownerFeed').mockImplementation(() => new Promise(() => {}));
  try {
    const result = await GET(request('/api/page/home?part=core', { actor: { credential: 'session', userId: user.id, email: user.email!, emailVerified: true } }));
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(await result.json()).toMatchObject({ signedIn: true, accountId: user.id, artifacts: [], shared: [] });
    expect(slow).not.toHaveBeenCalled();
  } finally { slow.mockRestore(); }
}, 2000);

it('anonymous insights requests do not expose account activity and are never cached', async () => {
  const result = await GET(request('/api/page/home?part=insights'));
  expect(result.headers.get('cache-control')).toBe('no-store');
  expect(await result.json()).toEqual({ signedIn: false });
});

// Old documents must survive a newer upload burst; counts cover the entire account.
it('separates the 1000-document shelf, aggregate totals and paginated assets', async () => {
  const db = await harness.db();
  const user = await createUser({ email: 'mxmx_test_inventory@example.com' });
  const other = await createUser({ email: 'mxmx_test_other_inventory@example.com' });
  const token = await mintToken('inventory');
  await db.query(`INSERT INTO artifacts (id, user_id, token_id, format, title, content, meta, version, updated_at)
    SELECT 'doc' || n, $1, $2, 'markup', 'Document ' || n, '', '{}', 1, '2020-01-01'::timestamptz FROM generate_series(1, 1005) n`, [user.id, token.id]);
  await db.query(`INSERT INTO artifacts (id, user_id, token_id, format, title, content, meta, version, updated_at)
    SELECT 'asset' || lpad(n::text, 4, '0'), $1, $2, 'image', 'Image ' || n, '', '{}', 1, now() FROM generate_series(1, 205) n`, [user.id, token.id]);
  await db.query(`INSERT INTO artifacts (id, user_id, token_id, format, title, content, meta, version)
    VALUES ('foreign', $1, $2, 'image', 'Foreign', '', '{}', 1)`, [other.id, token.id]);
  await db.query("UPDATE artifacts SET deleted_at = now() WHERE id IN ('doc1005', 'asset0205')");
  await db.query("INSERT INTO analytics_events (artifact_id, event, visitor) VALUES ('doc1004', 'view', 'v'), ('doc1004', 'view', 'v'), ('doc1', 'view', 'v'), ('doc1005', 'view', 'v'), ('asset0001', 'view', 'v')");
  const actor = { credential: 'session' as const, userId: user.id, email: user.email!, emailVerified: true };
  const core = await (await GET(request('/api/page/home?part=core', { actor }))).json();
  expect(core.artifacts).toHaveLength(1000);
  expect(core.artifacts.every((a: { format: string }) => a.format === 'markup')).toBe(true);
  expect(core).not.toHaveProperty('stats');
  const insights = await (await GET(request('/api/page/home?part=insights', { actor }))).json();
  expect(insights.stats).toEqual({ artifacts: 1004, assets: 204, views: 2 });
  const first = await (await assetsPage(request('/api/page/assets', { actor }))).json();
  const second = await (await assetsPage(request('/api/page/assets?page=1', { actor }))).json();
  expect(first.assets).toHaveLength(50);
  expect(first.total).toBe(204);
  expect(first.page).toBe(0);
  expect(second.assets).toHaveLength(50);
  expect(new Set([...first.assets, ...second.assets].map(a => a.id)).size).toBe(100);
  const search = await (await assetsPage(request('/api/page/assets?q=Image%20204', { actor }))).json();
  expect(search.assets.map((a: { id: string }) => a.id)).toEqual(['asset0204']);
  expect(search.total).toBe(1);
  const filtered = await (await assetsPage(request('/api/page/assets?formats=dataset', { actor }))).json();
  expect(filtered.total).toBe(0);
  expect(filtered.assets).toEqual([]);
  const last = await (await assetsPage(request('/api/page/assets?page=99999', { actor }))).json();
  expect(last.page).toBe(4);
  expect(last.assets).toHaveLength(4);
  expect((await assetsPage(request('/api/page/assets?page=-1', { actor }))).status).toBe(400);
});
