/**
 * WHO MAY RE-RENDER A CARD. `?refresh=1` re-renders only for an editor of the artifact; anyone else's is answered
 * from the stored image. And a social card is a function of its revision: an unchanged revision is never re-rendered
 * because time passed.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {BrowserService, RenderRequest, RenderResult} from '@artifactbin/contracts';
import {resetExportRenderer} from '@/lib/export';
import {setServices} from '@/lib/platform';
import {EXPORT_PNG} from './export-helpers';
import {mintAccountToken, request, useAppHarness} from './harness';
import {POST} from '@/app/api/artifacts/route';
import {GET as exportRoute} from '@/app/a/[id]/export/route';
import {GET as read, PUT} from '@/app/api/artifacts/[id]/route';

const harness = useAppHarness();
const PNG: RenderResult = {ok: true, mime: 'image/png', bytes: EXPORT_PNG};
function scripted(): BrowserService & {seen: RenderRequest[]} {
  const seen: RenderRequest[] = [];
  return {seen, async render(r) { seen.push(r); return PNG; }};
}
const params = (id: string) => ({params: Promise.resolve({id})});
let browser: ReturnType<typeof scripted>;
beforeEach(async () => { await resetExportRenderer(); browser = scripted(); setServices({browser}); });
afterEach(async () => { await resetExportRenderer(); setServices({browser: undefined}); });

async function publish() {
  const actor = await mintAccountToken('card-owner');
  const res = await POST(request('/api/artifacts', {method: 'POST', token: actor.token, json: {html: '<!doctype html><html><head><title>Card</title></head><body><h1>Card</h1></body></html>', visibility: 'public'}}));
  expect(res.status, await res.clone().text()).toBe(201);
  return {actor, id: (await res.json()).id as string};
}
const card = (id: string, query = '', token?: string) =>
  exportRoute(request(`/a/${id}/export?mode=card${query}`, token ? {token} : {}), params(id));

describe('card refresh', () => {
  it('ignores a non-editor refresh and honours the owner\'s', async () => {
    const {actor, id} = await publish();
    expect((await card(id)).status).toBeLessThan(400);
    expect(browser.seen).toHaveLength(1);
    expect((await card(id, '&refresh=1')).status).toBeLessThan(400);
    const stranger = await mintAccountToken('card-stranger');
    expect((await card(id, '&refresh=1', stranger.token)).status).toBeLessThan(400);
    expect(browser.seen).toHaveLength(1);
    expect((await card(id, '&refresh=1', actor.token)).status).toBeLessThan(400);
    expect(browser.seen).toHaveLength(2);
  });

  it('answers a reader\'s refresh after a new version with that version\'s card, not the stored one', async () => {
    const {actor, id} = await publish();
    const first = await card(id);
    const head = await (await read(request(`/api/artifacts/${id}`, {token: actor.token}), params(id))).json();
    const saved = await PUT(request(`/api/artifacts/${id}`, {method: 'PUT', token: actor.token, json: {html: head.html.replace('Card</h1>', 'Changed</h1>'), expectedVersion: head.version, expectedState: head.state}}), params(id));
    expect(saved.status).toBe(200);
    const refreshed = await card(id, '&refresh=1');
    expect(refreshed.headers.get('location')).toBeTruthy();
    expect(refreshed.headers.get('location')).not.toBe(first.headers.get('location'));
    expect(browser.seen).toHaveLength(2);
    // And the reader's refresh of that now-unchanged revision renders nothing more.
    expect((await card(id, '&refresh=1')).headers.get('location')).toBe(refreshed.headers.get('location'));
    expect(browser.seen).toHaveLength(2);
  });

  it('does not re-render an unchanged revision when its freshness lapses', async () => {
    const {id} = await publish();
    expect((await card(id)).status).toBeLessThan(400);
    await (await harness.db()).query("UPDATE export_image_cache SET expires_at=clock_timestamp()-interval '1 second'");
    expect((await card(id)).status).toBeLessThan(400);
    await resetExportRenderer();
    expect(browser.seen).toHaveLength(1);
  });
});
