import { expect, it, vi } from 'vitest';
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

it('keeps source metadata and analytics queries out of core while retaining shared search fields', async () => {
  const db = await harness.db(), user = await createUser({ email: 'mxmx_test_slim@example.com' }), other = await createUser({ email: 'mxmx_test_other@example.com' });
  const token = await mintToken('slim');
  await db.query("INSERT INTO artifacts (id,user_id,token_id,format,title,description,content,meta,version) VALUES ('own123',$1,$3,'markup','Owned','owned description','', $4,1),('shr123',$2,$3,'markup','Shared','searchable description','',$4,1)", [user.id, other.id, token.id, JSON.stringify({ unnecessary: 'large source metadata'.repeat(1000) })]);
  await db.query("INSERT INTO artifact_shares (artifact_id,email,role) VALUES ('shr123',$1,'viewer')", [user.email]);
  const query = vi.spyOn(db, 'query');
  try {
    const response = await GET(request('/api/page/home?part=core', { actor: { credential: 'session', userId: user.id, email: user.email!, emailVerified: true } }));
    const core = await response.json();
    expect(core.artifacts[0]).toMatchObject({ id: 'own123', title: 'Owned' });
    expect(core.artifacts[0]).not.toHaveProperty('views');
    expect(core.shared[0]).toMatchObject({ id: 'shr123', description: 'searchable description', role: 'viewer' });
    expect(JSON.stringify(core)).not.toContain('unnecessary');
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some(sql => sql.includes('analytics_events'))).toBe(false);
    expect(statements.filter(sql => sql.includes('FROM artifacts')).some(sql => /\bmeta\b/.test(sql))).toBe(false);
  } finally { query.mockRestore(); }
});
