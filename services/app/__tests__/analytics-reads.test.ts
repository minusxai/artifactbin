/**
 * Analytics READ events (analytics.test.ts has the rest): which reads log a view, and which never do.
 */
import { nativeHtml } from './native-html-fixture';
import { beforeEach, describe, expect, it } from 'vitest';
import { overrideRequestHeaders } from '@/lib/platform';
import { useAppHarness, request, setSession } from '@/__tests__/harness';
import { artifactPage as ArtifactPage, artifactMetadata as artifactPageMetadata, profilePage as UserPage } from '@/test/helpers/pages';
import { GET as eventsRoute } from '@/app/a/[id]/events/route';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { GET as exportRoute } from '@/app/a/[id]/export/route';
import { mintExportKey } from '@/lib/export';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { createUser } from '@/lib/accounts';
import { BASE, sessionUser, requestHeaders, params, outcome, create, eventRows, expectEvent, settle } from './analytics-fixture';

useAppHarness();
beforeEach(() => setSession(() => sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null));
overrideRequestHeaders(() => (requestHeaders.size === 0 ? null : [...requestHeaders]));
beforeEach(() => {
  sessionUser.id = '';
  sessionUser.email = '';
  requestHeaders.clear();
});

describe('read events', () => {
  /*
   * Explicit raw reads count here. Page-data/metadata reads alone do not:
   * inline readers report their mounted document through the view endpoint,
   * covered by artifact-views.test.ts and artifact-views.ui.test.tsx.
   */
  const serveDocument = (id: string, query = '') =>
    rawRoute(new Request(`${BASE}/a/${id}/raw${query}`), params({ id }));

  it('an explicit raw read logs one view; fetching page data or metadata logs none', async () => {
    const t = await mintToken('public-reader-owner');
    const doc = await create(t.token, { html: nativeHtml('<p>x</p>'), visibility: 'public' });
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
    const doc = await create(t.token, { html: nativeHtml('<p>x</p>') });
    expect(await outcome(ArtifactPage(doc.id, { key: mintExportKey(doc.id) }))).toBe('render');
    await serveDocument(doc.id, `?chrome=0&key=${mintExportKey(doc.id)}`);
    await settle();
    expect((await eventRows(doc.id)).filter((r) => r.event === 'view')).toHaveLength(0);
  });

  it('a denied viewer logs nothing; the owner’s pretty-URL render logs a view with their id', async () => {
    const owner = await createUser({ email: 'owner@example.com' });
    const t = await mintToken('owned', owner.id);
    const doc = await create(t.token, { html: nativeHtml('<p>x</p>'), visibility: 'private', title: 'secret' });

    expect(await outcome(ArtifactPage(doc.id))).toBe('notFound');
    await settle();
    expect((await eventRows(doc.id)).filter((r) => r.event === 'view')).toHaveLength(0);

    sessionUser.id = owner.id;
    sessionUser.email = owner.email;
    const { username } = await (await import('@/lib/accounts')).ensureUsername(owner);
    const rendered = await outcome(
      UserPage(`@${username}`, [`${doc.id}-secret`]),
    );
    expect(rendered).toBe('render');
    // The page renders; the view lands when its frame fetches the document.
    await serveDocument(doc.id);
    expect(await expectEvent(doc.id, 'view')).toMatchObject({ user_id: owner.id });
  });

  it('the export route logs export; the SSE connect logs sse_connect once', async () => {
    const t = await mintToken('public-reader-owner');
    const doc = await create(t.token, { html: nativeHtml('<p>x</p>'), visibility: 'public' });

    await exportRoute(request(`/a/${doc.id}/export`), params({ id: doc.id }));
    await expectEvent(doc.id, 'export');

    const res = await eventsRoute(request(`/a/${doc.id}/events`), params({ id: doc.id }));
    expect(res.status).toBe(200);
    await expectEvent(doc.id, 'sse_connect');
    await res.body?.cancel();
    expect((await eventRows(doc.id)).filter((r) => r.event === 'sse_connect')).toHaveLength(1);
  });
});
