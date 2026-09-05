/**
 * Fire-and-forget analytics (lib/analytics.ts + the analytics_events table).
 *
 * The properties under test: every read/write surface logs its event through
 * the REAL route/page handlers; a failed insert never surfaces (trackEvent
 * resolves no matter what); the exporter's self-fetch of a page is NOT a view;
 * and the dashboard aggregates (per-artifact totals + daily series) come back
 * right. Events are fired unawaited on the request path, so assertions poll.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { artifactPage as ArtifactPage, artifactMetadata as artifactPageMetadata, profilePage as UserPage } from '@/test/helpers/pages';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { GET as exportRoute } from '@/app/a/[id]/export/route';
import {
  DELETE as deleteArtifactRoute,
  PUT as putArtifact,
} from '@/app/api/artifacts/[id]/route';
import { POST as editRoute } from '@/app/api/artifacts/[id]/edits/route';
import { POST as revertRoute } from '@/app/api/artifacts/[id]/revert/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { DELETE as deleteMyArtifactRoute } from '@/app/api/my/artifacts/[id]/route';
import { GET as listMyArtifactsRoute } from '@/app/api/my/artifacts/route';
import { trackEvent } from '@/lib/analytics';
import { forkCountByUser, likeSummaryByUser, viewSeriesByUser, VIEW_SERIES_DAYS } from '@/lib/feed';
import { mintExportKey } from '@/lib/export-key';
import { resetLiveSubscriptions } from '@/lib/story/live';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, listArtifactsByUser } from '@/lib/users';
import { renderSparklineSvg } from '@/lib/viz/sparkline';

const BASE = 'http://localhost:3000';
const harness = useAppHarness();

// Owns the session mock for this file: id + email, settable per test.
const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({
  auth: async () =>
    sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null,
}));

// Owns the request-headers mock: empty = called OFF a request (the server is
// holding none — exactly like production code called from a test), populated =
// a request carrying these headers (lib/request-context).
const requestHeaders = new Map<string, string>();
vi.mock('@/lib/request-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/request-context')>()),
  currentHeaders: async () => (requestHeaders.size === 0 ? null : { get: (k: string) => requestHeaders.get(k.toLowerCase()) ?? null }),
}));

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const pageProps = (id: string, key?: string) => ({
  params: Promise.resolve({ id }),
  searchParams: Promise.resolve(key ? { key } : {}),
});

/** Run a page function, mapping notFound/redirect throws to outcomes. */
async function outcome(p: Promise<unknown>): Promise<'render' | 'redirect' | 'notFound'> {
  try {
    // The pages answer as data now (test/helpers/pages): the outcome IS the value.
    const value = await p;
    if (value && typeof value === 'object' && 'kind' in (value as Record<string, unknown>)) return (value as { kind: 'render' | 'redirect' | 'notFound' }).kind;
    return 'render';
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? '';
    if (digest.startsWith('NEXT_REDIRECT')) return 'redirect';
    return 'notFound';
  }
}

interface Wire { id: string; edit_id: string; version: number }

async function create(token: string, body: Record<string, unknown>): Promise<Wire> {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: body }));
  expect(res.status).toBe(201);
  return res.json() as Promise<Wire>;
}

async function eventRows(artifactId?: string): Promise<{ event: string; artifact_id: string; user_id: string | null; client: string | null }[]> {
  const db = await harness.db();
  const r = await db.query<{ event: string; artifact_id: string; user_id: string | null; client: string | null }>(
    `SELECT event, artifact_id, user_id, client FROM analytics_events ${artifactId ? 'WHERE artifact_id = $1' : ''} ORDER BY seq`,
    artifactId ? [artifactId] : [],
  );
  return r.rows;
}

/** Events are fired unawaited — poll until the expected row lands. */
async function expectEvent(artifactId: string, event: string): Promise<{ user_id: string | null; client: string | null }> {
  let match: { user_id: string | null; client: string | null } | undefined;
  await vi.waitFor(async () => {
    match = (await eventRows(artifactId)).find((r) => r.event === event);
    expect(match).toBeDefined();
  }, { timeout: 3000 });
  return match!;
}

/** Give any stray unawaited insert time to land before asserting absence. */
const settle = () => new Promise((r) => setTimeout(r, 150));

beforeEach(async () => {
  await resetLiveSubscriptions();
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
    const user = await createUser({ email: 'v@minusx.ai' });
    const t = await mintToken('laptop', user.id);
    const doc = await create(t.token, { markup: '<p>x</p>' });
    expect(await expectEvent(doc.id, 'create')).toMatchObject({ user_id: user.id });
  });

  it('PUT logs update; revert logs revert; DELETE logs delete (and does not deadlock)', async () => {
    const t = await mintToken('t');
    const doc = await create(t.token, { markup: '<h1>v1</h1>' });

    expect((await putArtifact(request(`/api/artifacts/${doc.id}`, { method: 'PUT', token: t.token, json: { markup: '<h1>v2</h1>' } }), params({ id: doc.id }))).status).toBe(200);
    await expectEvent(doc.id, 'update');

    expect((await revertRoute(request(`/api/artifacts/${doc.id}/revert`, { method: 'POST', token: t.token, json: { version: 1 } }), params({ id: doc.id }))).status).toBe(200);
    await expectEvent(doc.id, 'revert');

    // The delete path is transactional: this completing at all proves the
    // event fires OUTSIDE the txn (an inside fire deadlocks PGLite's queue).
    expect((await deleteArtifactRoute(request(`/api/artifacts/${doc.id}`, { method: 'DELETE', token: t.token }), params({ id: doc.id }))).status).toBe(200);
    await expectEvent(doc.id, 'delete');
  });

  it('an applied edit logs edit; a refused edit logs nothing', async () => {
    const t = await mintToken('t');
    const doc = await create(t.token, { markup: '<section><p>alpha text</p><p>beta text</p></section>' });

    const bad = await editRoute(
      request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: t.token, json: { edit_id: 'bogus', old_string: 'alpha', new_string: 'gamma' } }),
      params({ id: doc.id }),
    );
    expect(bad.status).toBe(409);
    await settle();
    expect((await eventRows(doc.id)).filter((r) => r.event === 'edit')).toHaveLength(0);

    const good = await editRoute(
      request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: t.token, json: { edit_id: doc.edit_id, old_string: 'alpha', new_string: 'gamma' } }),
      params({ id: doc.id }),
    );
    expect(good.status).toBe(200);
    await expectEvent(doc.id, 'edit');
  });

  it('the session (dashboard) delete logs delete with the user', async () => {
    const user = await createUser({ email: 'v@minusx.ai' });
    const t = await mintToken('laptop', user.id);
    const doc = await create(t.token, { markup: '<p>x</p>' });
    sessionUser.id = user.id;
    sessionUser.email = user.email;
    expect((await deleteMyArtifactRoute(request(`/api/my/artifacts/${doc.id}`, { method: 'DELETE' }), params({ id: doc.id }))).status).toBe(200);
    expect(await expectEvent(doc.id, 'delete')).toMatchObject({ user_id: user.id });
  });
});

describe('read events', () => {
  /*
   * A view is counted where the document is SERVED (/a/<id>/raw), not where a
   * page happens to render. A reader is rewritten straight to that route
   * (proxy.ts) and never reaches the page at all, while an owner's shell
   * fetches it once from inside the frame — so this is both the only place
   * that sees every view and the only place that sees each one once.
   */
  const serveDocument = (id: string, query = '') =>
    rawRoute(new Request(`${BASE}/a/${id}/raw${query}`), params({ id }));

  it('serving the document logs one view; rendering the page or its metadata logs none', async () => {
    const t = await mintToken('anon');
    const doc = await create(t.token, { markup: '<p>x</p>' });
    await settle(); // let the create event land so counts below are stable

    await artifactPageMetadata(doc.id);
    expect(await outcome(ArtifactPage(doc.id))).toBe('render');
    await settle();
    expect((await eventRows(doc.id)).filter((r) => r.event === 'view')).toHaveLength(0);

    await serveDocument(doc.id);
    await expectEvent(doc.id, 'view');
    expect((await eventRows(doc.id)).filter((r) => r.event === 'view')).toHaveLength(1);
  });

  it('the exporter’s keyed self-fetch is NOT a view, on either surface', async () => {
    const t = await mintToken('anon');
    const doc = await create(t.token, { markup: '<p>x</p>' });
    expect(await outcome(ArtifactPage(doc.id, { key: mintExportKey(doc.id) }))).toBe('render');
    await serveDocument(doc.id, `?chrome=0&key=${mintExportKey(doc.id)}`);
    await settle();
    expect((await eventRows(doc.id)).filter((r) => r.event === 'view')).toHaveLength(0);
  });

  it('a denied viewer logs nothing; the owner’s pretty-URL render logs a view with their id', async () => {
    const owner = await createUser({ email: 'owner@example.com' });
    const t = await mintToken('owned');
    await claimToken(owner.id, t.token);
    const doc = await create(t.token, { markup: '<p>x</p>', visibility: 'private', title: 'secret' });

    expect(await outcome(ArtifactPage(doc.id))).toBe('notFound');
    await settle();
    expect((await eventRows(doc.id)).filter((r) => r.event === 'view')).toHaveLength(0);

    sessionUser.id = owner.id;
    sessionUser.email = owner.email;
    const { username } = await (await import('@/lib/users')).ensureUsername(owner);
    const rendered = await outcome(
      UserPage(`@${username}`, [`${doc.id}-secret`]),
    );
    expect(rendered).toBe('render');
    // The page renders; the view lands when its frame fetches the document.
    await serveDocument(doc.id);
    expect(await expectEvent(doc.id, 'view')).toMatchObject({ user_id: owner.id });
  });

  it('the export route logs export; the SSE connect logs sse_connect once', async () => {
    const t = await mintToken('anon');
    const doc = await create(t.token, { markup: '<p>x</p>' });

    await exportRoute(request(`/a/${doc.id}/export`), params({ id: doc.id }));
    await expectEvent(doc.id, 'export');

    const res = await eventsRoute(request(`/a/${doc.id}/events`), params({ id: doc.id }));
    expect(res.status).toBe(200);
    await expectEvent(doc.id, 'sse_connect');
    await res.body?.cancel();
    expect((await eventRows(doc.id)).filter((r) => r.event === 'sse_connect')).toHaveLength(1);
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
    const user = await createUser({ email: 'v@minusx.ai' });
    const t = await mintToken('laptop', user.id);
    const doc = await create(t.token, { markup: '<p>x</p>' });
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
    const user = await createUser({ email: 'v@minusx.ai' });
    const t = await mintToken('laptop', user.id);
    const doc = await create(t.token, { markup: '<p>x</p>' });
    asVisitor('9.9.9.9');
    await trackEvent('view', doc.id, { userId: 'usr_a' });
    await trackEvent('view', doc.id, { userId: 'usr_a' }); // refresh, still one
    await trackEvent('view', doc.id, { userId: 'usr_b' }); // same machine, other account
    await trackEvent('view', doc.id); // and a signed-out view from that machine
    expect((await listArtifactsByUser(user.id))[0].views).toBe(3);
  });

  it('legacy rows without a visitor each count — there is nothing to dedupe them on', async () => {
    const user = await createUser({ email: 'v@minusx.ai' });
    const t = await mintToken('laptop', user.id);
    const doc = await create(t.token, { markup: '<p>x</p>' });
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
    const user = await createUser({ email: 'v@minusx.ai' });
    const t = await mintToken('laptop', user.id);
    const a = await create(t.token, { markup: '<p>a</p>', title: 'a' });
    const b = await create(t.token, { markup: '<p>b</p>', title: 'b' });
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
    const document = await create(t.token, { markup: '<p>a</p>', title: 'a' });
    const dataFile = await create(t.token, { markup: '<p>b</p>', title: 'b' });
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
    const document = await create(t.token, { markup: '<p>a</p>', title: 'a' });
    const dataFile = await create(t.token, { markup: '<p>b</p>', title: 'b' });
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
