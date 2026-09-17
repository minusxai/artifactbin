import { expect, it } from 'vitest';
import { createEvents } from '@artifactbin/events/local';
import { GET } from '@/app/api/page/home/route';
import { createUser } from '@/lib/users';
import { mintToken } from '@/lib/tokens';
import { EVENTS_SCHEMA } from '@/lib/config';
import { request, useAppHarness } from './harness';

const harness = useAppHarness();

it('omits activity while retaining account listings, events and view insights', async () => {
  const db = await harness.db();
  const user = await createUser({ email: 'mxmx_test_feed_disabled@example.com' });
  const token = await mintToken('feed-disabled', user.id);
  await db.query("INSERT INTO artifacts (id,user_id,token_id,format,title,content,meta,version) VALUES ('doc123',$1,$2,'markup','Document','','{}',1)", [user.id, token.id]);
  const events = createEvents({ db, schema: EVENTS_SCHEMA });
  await events.emit([{ id: 'feed-disabled-view', at: new Date().toISOString(), source: 'app', subject_kind: 'visitor', subject_id: 'visitor-one', verb: 'viewed', object_kind: 'artifact', object_id: 'doc123', payload: {} }]);
  try {
    const actor = { credential: 'session' as const, userId: user.id, email: user.email!, emailVerified: true };
    for (const suffix of ['', '?part=insights']) {
      const response = await GET(request(`/api/page/home${suffix}`, { actor }));
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).not.toHaveProperty('feed');
      expect(data.viewsOverTime.reduce((sum: number, value: number) => sum + value, 0)).toBe(1);
      if (!suffix) expect(data.artifacts).toEqual([expect.objectContaining({ id: 'doc123' })]);
    }
    expect((await db.query(`SELECT id FROM ${EVENTS_SCHEMA}.events WHERE id = 'feed-disabled-view'`)).rows).toHaveLength(1);
  } finally { await events.close?.(); }
});
