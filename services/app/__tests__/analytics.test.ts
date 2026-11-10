/**
 * Fire-and-forget analytics (lib/analytics.ts + the analytics_events table).
 *
 * The properties under test: every read/write surface logs its event through
 * the REAL route/page handlers; a failed insert never surfaces (trackEvent
 * resolves no matter what); the exporter's self-fetch of a page is NOT a view;
 * and the dashboard aggregates (per-artifact totals + daily series) come back
 * right. Events are fired unawaited on the request path, so assertions poll.
 */
/* trackEvent, write events, visitors, totals and sparklines here; read events are in analytics-reads.test.ts (split for
 * the CI shards; ./analytics-fixture.ts). */
import { nativeHtml } from './native-html-fixture';
import { artifactState, getArtifactById, getVersionFor } from '@/lib/artifacts';
import { observedRequest } from '@/__tests__/conditional-request';
import { beforeEach, describe, expect, it } from 'vitest';
import { overrideRequestHeaders } from '@/lib/platform';
import { useAppHarness, request, setSession } from '@/__tests__/harness';
import { DELETE as deleteArtifactRoute, PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { DELETE as deleteMyArtifactRoute } from '@/app/api/my/artifacts/[id]/route';
import { GET as listMyArtifactsRoute } from '@/app/api/my/artifacts/route';
import { trackEvent } from '@/lib/analytics';
import { forkCountByUser, likeSummaryByUser, viewSeriesByUser, VIEW_SERIES_DAYS, listArtifactsByUser } from '@/lib/workspace';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { identityForUser, createUser } from '@/lib/accounts';
import { renderSparklineSvg } from '@/lib/viz';
import { sessionUser, requestHeaders, params, create, eventRows, expectEvent, settle } from './analytics-fixture';

const harness = useAppHarness();
beforeEach(() => setSession(() => sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null));
overrideRequestHeaders(() => (requestHeaders.size === 0 ? null : [...requestHeaders]));
beforeEach(() => {
  sessionUser.id = '';
  sessionUser.email = '';
  requestHeaders.clear();
});

describe('trackEvent', () => {
  it('inserts a row (client NULL outside a request scope)', async () => {
    await trackEvent('view', 'abc123', { userId: 'usr_1' });
    expect(await eventRows('abc123')).toEqual([
      { event: 'view', artifact_id: 'abc123', user_id: 'usr_1', client: null },
    ]);
  });

  it('NEVER rejects, even when the insert fails', async () => {
    const db = await harness.db();
    await db.query('ALTER TABLE analytics_events RENAME TO analytics_events_x');
    try {
      await expect(trackEvent('view', 'abc123')).resolves.toBeUndefined();
    } finally {
      await db.query('ALTER TABLE analytics_events_x RENAME TO analytics_events');
    }
  });
});

describe('write events', () => {
  it('create logs a create row stamped with the token’s user', async () => {
    const user = await createUser({ email: 'mxmx_test_viewer@example.com' });
    const t = await mintToken('laptop', user.id);
    const doc = await create(t.token, { html: nativeHtml('<p>x</p>') });
    expect(await expectEvent(doc.id, 'create')).toMatchObject({ user_id: user.id });
  });

  it('HTML replacement and restore log edits; DELETE logs delete (and does not deadlock)', async () => {
    const t = await mintToken('t');
    const doc = await create(t.token, { html: nativeHtml('<h1>v1</h1>') });

    expect((await putArtifact(await observedRequest(`/api/artifacts/${doc.id}`, { method: 'PUT', token: t.token, json: { html:(await getArtifactById(doc.id))!.source!.replace('v1','v2') } }), params({ id: doc.id }))).status).toBe(200);
    await expectEvent(doc.id, 'edit');

    const archived=await getVersionFor(identityForUser(t.userId, t.id),doc.id,1);
    expect((await putArtifact(await observedRequest(`/api/artifacts/${doc.id}`,{method:'PUT',token:t.token,json:{html:archived!.source!}}),params({id:doc.id}))).status).toBe(200);
    expect((await eventRows(doc.id)).filter(row=>row.event==='edit')).toHaveLength(2);

    // The delete path is transactional: this completing at all proves the
    // event fires OUTSIDE the txn (an inside fire deadlocks PGLite's queue).
    expect((await deleteArtifactRoute(request(`/api/artifacts/${doc.id}`, { method: 'DELETE', token: t.token }), params({ id: doc.id }))).status).toBe(200);
    await expectEvent(doc.id, 'delete');
  });

  it('an applied edit logs edit; a refused edit logs nothing', async () => {
    const t = await mintToken('t');
    const doc = await create(t.token, { html: nativeHtml('<section><p>alpha text</p><p>beta text</p></section>') });

    const row=(await getArtifactById(doc.id))!;
    const prepared={html:row.source!.replace('alpha','gamma'),expectedVersion:row.version,expectedState:artifactState(row)};
    const bad=await putArtifact(request(`/api/artifacts/${doc.id}`,{method:'PUT',token:t.token,json:{...prepared,expectedVersion:999}}),params({id:doc.id}));
    expect(bad.status).toBe(409);
    await settle();
    expect((await eventRows(doc.id)).filter((r) => r.event === 'edit')).toHaveLength(0);

    const good = await putArtifact(
      request(`/api/artifacts/${doc.id}`, { method: 'PUT', token: t.token, json: prepared }),
      params({ id: doc.id }),
    );
    expect(good.status).toBe(200);
    await expectEvent(doc.id, 'edit');
  });

  it('the session (dashboard) delete logs delete with the user', async () => {
    const user = await createUser({ email: 'mxmx_test_viewer@example.com' });
    const t = await mintToken('laptop', user.id);
    const doc = await create(t.token, { html: nativeHtml('<p>x</p>') });
    sessionUser.id = user.id;
    sessionUser.email = user.email;
    expect((await deleteMyArtifactRoute(request(`/api/my/artifacts/${doc.id}`, { method: 'DELETE' }), params({ id: doc.id }))).status).toBe(200);
    expect(await expectEvent(doc.id, 'delete')).toMatchObject({ user_id: user.id });
  });
});
describe('unique daily visitors', () => {
  /** Simulate a request from one browser: same ip+ua = same person today. */
  const asVisitor = (ip: string, ua = 'Mozilla/5.0 test') => {
    requestHeaders.clear();
    requestHeaders.set('x-forwarded-for', ip);
    requestHeaders.set('user-agent', ua);
  };

  it('a refresh is not a new view: same ip+ua on the same day counts once, a new visitor counts', async () => {
    const user = await createUser({ email: 'mxmx_test_viewer@example.com' });
    const t = await mintToken('laptop', user.id);
    const doc = await create(t.token, { html: nativeHtml('<p>x</p>') });
    asVisitor('9.9.9.9');
    await trackEvent('view', doc.id);
    await trackEvent('view', doc.id); // the refresh
    asVisitor('10.0.0.1');
    await trackEvent('view', doc.id);
    expect((await listArtifactsByUser(user.id))[0].views).toBe(2);
    const series = (await viewSeriesByUser(user.id)).get(doc.id)!;
    expect(series[VIEW_SERIES_DAYS - 1]).toBe(2);
  });

  it('a signed-in account disambiguates: two users behind one NAT + browser are two visitors', async () => {
    const user = await createUser({ email: 'mxmx_test_viewer@example.com' });
    const t = await mintToken('laptop', user.id);
    const doc = await create(t.token, { html: nativeHtml('<p>x</p>') });
    asVisitor('9.9.9.9');
    await trackEvent('view', doc.id, { userId: 'usr_a' });
    await trackEvent('view', doc.id, { userId: 'usr_a' }); // refresh, still one
    await trackEvent('view', doc.id, { userId: 'usr_b' }); // same machine, other account
    await trackEvent('view', doc.id); // and a signed-out view from that machine
    expect((await listArtifactsByUser(user.id))[0].views).toBe(3);
  });

  it('legacy rows without a visitor each count — there is nothing to dedupe them on', async () => {
    const user = await createUser({ email: 'mxmx_test_viewer@example.com' });
    const t = await mintToken('laptop', user.id);
    const doc = await create(t.token, { html: nativeHtml('<p>x</p>') });
    const db = await harness.db();
    await db.query(`INSERT INTO analytics_events (event, artifact_id) VALUES ('view', $1), ('view', $1)`, [doc.id]);
    asVisitor('9.9.9.9');
    await trackEvent('view', doc.id);
    await trackEvent('view', doc.id);
    expect((await listArtifactsByUser(user.id))[0].views).toBe(3); // 2 legacy + 1 unique
  });

  it('the visitor key is a salted hash — no raw ip or user-agent lands in the row', async () => {
    asVisitor('9.9.9.9', 'Mozilla/5.0 SecretBrowser');
    await trackEvent('view', 'abc123');
    const db = await harness.db();
    const r = await db.query<{ visitor: string | null; client: string | null }>(
      `SELECT visitor, client FROM analytics_events WHERE artifact_id = 'abc123'`,
    );
    expect(r.rows[0].visitor).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(r.rows)).not.toContain('9.9.9.9');
    expect(JSON.stringify(r.rows)).not.toContain('SecretBrowser');
    expect(r.rows[0].client).toBe('browser'); // Mozilla/ prefix = the browser bucket
  });
});

describe('per-artifact totals', () => {
  it('listArtifactsByUser carries each artifact\'s view total, and the list route reports it', async () => {
    const user = await createUser({ email: 'mxmx_test_viewer@example.com' });
    const t = await mintToken('laptop', user.id);
    const a = await create(t.token, { html: nativeHtml('<p>a</p>'), title: 'a' });
    const b = await create(t.token, { html: nativeHtml('<p>b</p>'), title: 'b' });
    const db = await harness.db();
    await db.query(
      `INSERT INTO analytics_events (event, artifact_id, created_at) VALUES
       ('view', $1, now()), ('view', $1, now()), ('view', $2, now()),
       ('view', $1, now() - interval '2 days'),
       ('export', $1, now())`,
      [a.id, b.id],
    );

    const listed = await listArtifactsByUser(user.id);
    expect(listed.find((r) => r.id === a.id)?.views).toBe(3); // exports don't count
    expect(listed.find((r) => r.id === b.id)?.views).toBe(1);

    sessionUser.id = user.id;
    sessionUser.email = user.email;
    const res = await listMyArtifactsRoute(request('/api/my/artifacts'));
    const body = (await res.json()) as { artifacts: { id: string; views: number }[] };
    expect(body.artifacts.find((r) => r.id === a.id)?.views).toBe(3);
  });

  it('likeSummaryByUser counts and buckets live likes on markup documents only', async () => {
    const user = await createUser({ email: 'likes@minusx.ai' });
    const t = await mintToken('laptop', user.id);
    const document = await create(t.token, { html: nativeHtml('<p>a</p>'), title: 'a' });
    const dataFile = await create(t.token, { html: nativeHtml('<p>b</p>'), title: 'b' });
    const db = await harness.db();
    await db.query(`UPDATE artifacts SET format = 'dataset' WHERE id = $1`, [dataFile.id]);
    await db.query(
      `INSERT INTO relations (subject_kind, subject_id, verb, object_kind, object_id, created_at) VALUES
       ('user', 'reader-1', 'like', 'artifact', $1, now()),
       ('user', 'reader-2', 'like', 'artifact', $1, now()),
       ('user', 'reader-3', 'like', 'artifact', $1, now() - interval '2 days'),
       ('user', 'reader-4', 'like', 'artifact', $2, now())`,
      [document.id, dataFile.id],
    );

    const summary = await likeSummaryByUser(user.id);
    expect(summary.total).toBe(3);
    expect(summary.series).toHaveLength(VIEW_SERIES_DAYS);
    expect(summary.series[VIEW_SERIES_DAYS - 1]).toBe(2);
    expect(summary.series[VIEW_SERIES_DAYS - 3]).toBe(1);
  });

  it('forkCountByUser reads canonical fork events for live markup documents only', async () => {
    const user = await createUser({ email: 'forks@minusx.ai' });
    const t = await mintToken('laptop', user.id);
    const document = await create(t.token, { html: nativeHtml('<p>a</p>'), title: 'a' });
    const dataFile = await create(t.token, { html: nativeHtml('<p>b</p>'), title: 'b' });
    const db = await harness.db();
    await db.query(`UPDATE artifacts SET format = 'dataset' WHERE id = $1`, [dataFile.id]);
    await trackEvent('fork', document.id, { forkId: 'copy-1' });
    await trackEvent('fork', document.id, { forkId: 'copy-2' });
    await trackEvent('fork', dataFile.id, { forkId: 'copy-3' });

    expect(await forkCountByUser(user.id)).toBe(2);
  });
});

describe('sparkline rendering', () => {
  it('renders a series to inline SVG through the headless vega pipeline', async () => {
    const svg = await renderSparklineSvg([0, 1, 4, 2, 7, 3, 0, 0, 5, 9]);
    expect(svg.startsWith('<svg')).toBe(true);
  });


});
