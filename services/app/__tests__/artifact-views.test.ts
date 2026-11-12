import { beforeEach, expect, it } from 'vitest';
import { createEvents } from '@artifactbin/events/local';
import { POST } from '@/app/api/page/artifact/[id]/view/route';
import { request, useAppHarness } from '@/__tests__/harness';
import { EVENTS_SCHEMA } from '@/lib/platform';
import { viewSeriesByUser } from '@/lib/workspace';
import { runWithRequest } from '@/lib/platform';
import { setServices } from '@/lib/platform';
import { createUser } from '@/lib/accounts';

const harness = useAppHarness();
let owner: Awaited<ReturnType<typeof createUser>>;
beforeEach(async () => {
  const db = await harness.db();
  setServices({ events: createEvents({ db, schema: EVENTS_SCHEMA }) });
  owner = await createUser({ email: 'mxmx_test_views@example.com' });
  await db.query(`INSERT INTO artifacts (id, token_id, user_id, format, visibility) VALUES
    ('viewpu', 'tok_v', $1, 'html', 'public'),
    ('viewpr', 'tok_v', $1, 'html', 'private'),
    ('viewun', 'tok_v', $1, 'html', 'unlisted'),
    ('viewfo', 'tok_v', $1, 'folder', 'public')`, [owner.id]);
});
const open = (id: string, options: Parameters<typeof request>[1] = {}, query = '') => {
  const req = request(`/api/page/artifact/${id}/view${query}`, { method: 'POST', origin: 'same', headers: { 'user-agent': 'Mozilla/5.0 view-test' }, ...options });
  return runWithRequest(req, () => POST(req, { params: Promise.resolve({ id }) }));
};

it('records real inline opens only in canonical storage and deduplicates dashboard visitors', async () => {
  expect((await open('viewpu')).status).toBe(204);
  expect((await open('viewpu')).status).toBe(204);
  expect((await open('viewpu', { actor: { credential: 'session', userId: owner.id, email: owner.email, emailVerified: true } })).status).toBe(204);
  const db = await harness.db();
  const canonical = await db.query<{ visitor: string; user_id: string | null }>(`SELECT subject_id AS visitor, payload->>'user_id' AS user_id FROM ${EVENTS_SCHEMA}.events WHERE object_kind='artifact' AND verb='viewed' ORDER BY position`);
  expect(canonical.rows).toHaveLength(3);
  expect((await db.query('SELECT * FROM analytics_events')).rows).toEqual([]);
  expect(canonical.rows[0].visitor).toMatch(/^[a-f0-9]{32}$/);
  expect(canonical.rows[0].visitor).toBe(canonical.rows[1].visitor);
  expect(canonical.rows[2].user_id).toBe(owner.id);
  expect((await db.query(`SELECT id FROM ${EVENTS_SCHEMA}.events WHERE verb = 'viewed'`)).rows).toHaveLength(3);
  expect((await viewSeriesByUser(owner.id)).get('viewpu')?.at(-1)).toBe(2);
});

it('allows unlisted readers and private owners, refuses unreadable, missing and non-document targets', async () => {
  expect((await open('viewun')).status).toBe(204);
  expect((await open('viewpr')).status).toBe(404);
  expect((await open('absent')).status).toBe(404);
  expect((await open('viewfo')).status).toBe(404);
  expect((await open('viewpr', { actor: { credential: 'session', userId: owner.id, email: owner.email, emailVerified: true } })).status).toBe(204);
  const rows = await (await harness.db()).query<{ artifact_id: string }>(`SELECT object_id AS artifact_id FROM ${EVENTS_SCHEMA}.events WHERE object_kind='artifact' AND verb='viewed' ORDER BY position`);
  expect(rows.rows.map(row => row.artifact_id)).toEqual(['viewun', 'viewpr']);
});

it('rejects cross-site reports even anonymously and ignores capture requests', async () => {
  expect((await open('viewpu', { origin: 'https://elsewhere.example' })).status).toBe(403);
  expect((await open('viewpu', {}, '?key=capture')).status).toBe(204);
  expect((await (await harness.db()).query(`SELECT id FROM ${EVENTS_SCHEMA}.events WHERE object_kind='artifact' AND verb='viewed'`)).rows).toHaveLength(0);
});
