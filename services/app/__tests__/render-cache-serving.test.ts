/**
 * THE RENDER CACHE, through the real app server: an anonymous reader's shell (the app page at /a/<id>) and frame
 * (the document on its own origin) are rendered once per version, and never at the cost of an access decision or a
 * fresh nonce. lib/serving/render-cache's own tests pin the bounds; these pin what a reader can observe.
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import * as nativeHtml from '@/lib/serving/native-html.server';
import * as artifacts from '@/lib/artifacts';
import {mintAccountToken, request, useAppHarness} from './harness';
import {POST} from '@/app/api/artifacts/route';
import {GET as read, PUT} from '@/app/api/artifacts/[id]/route';
import {GET as raw} from '@/app/a/[id]/raw/route';
import {createAppServer} from '@/server/app';
import {GUEST_TICKET, PAGES_TICKET_PARAM, pagesOriginFor, pagesSiteFor} from '@/lib/http/pages-origin';
import { flushViews } from '@/lib/analytics';

const harness = useAppHarness();
const APP = 'https://app.example.test';
const site = pagesSiteFor('pages.example.test', APP)!;
const SHELL = '<!doctype html><html><head><title>artifactbin</title></head><body><div id="root"></div></body></html>';
const params = (id: string) => ({params: Promise.resolve({id})});
const source = (text: string) => `<!doctype html><html><head><title>Cached plan</title><script type="module">document.body.dataset.ready="yes"</script></head><body><h1>${text}</h1></body></html>`;

async function publish(visibility: 'public' | 'private' = 'public') {
  const actor = await mintAccountToken('render-cache');
  const response = await POST(request('/api/artifacts', {method: 'POST', token: actor.token, json: {html: source('First version'), visibility}}));
  expect(response.status, await response.clone().text()).toBe(201);
  return {actor, id: (await response.json()).id as string};
}
const app = createAppServer({indexHtml: async () => SHELL, pagesSite: site});
/** The anonymous frame, as the app page draws it for a guest. */
const frame = (id: string) => app.request(`${pagesOriginFor(id, site)}/?${PAGES_TICKET_PARAM}=${GUEST_TICKET}`);
const shell = (id: string) => app.request(`${APP}/a/${id}`, {headers: {accept: 'text/html'}});
const nonceOf = (html: string) => /<script[^>]*data-af="core"[^>]*nonce="([^"]+)"/.exec(html)?.[1] ?? /nonce="([^"]+)"[^>]*data-af="core"/.exec(html)?.[1];

afterEach(() => { vi.restoreAllMocks(); });

describe('an anonymous reader is served a shared render', () => {
  it('renders the frame once, with a fresh nonce in every response', async () => {
    const {id} = await publish();
    const assemble = vi.spyOn(nativeHtml, 'nativeHtmlDocument');
    const first = await frame(id), second = await frame(id);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const [a, b] = [await first.text(), await second.text()];
    expect(a).toContain('First version');
    expect(assemble).toHaveBeenCalledTimes(1);
    const [one, two] = [nonceOf(a), nonceOf(b)];
    expect(one).toMatch(/^[0-9a-f]{32}$/);
    expect(two).toMatch(/^[0-9a-f]{32}$/);
    expect(one).not.toBe(two);
    // The nonce is the only difference, and the CSP meta names the response's own.
    expect(b.replaceAll(two!, one!)).toBe(a);
    expect(b).toContain(`'nonce-${two}'`);
  });

  it('renders the shell once, without reading the row whole again', async () => {
    const {id} = await publish();
    expect((await shell(id)).status).toBe(200);
    const fullRow = vi.spyOn(artifacts, 'getArtifactById');
    const again = await shell(id);
    expect(again.status).toBe(200);
    expect(await again.text()).toContain('data-mx-document-frame');
    expect(fullRow).not.toHaveBeenCalled();
  });

  it('never serves a document that has gone private from the cache, on either surface', async () => {
    const {id} = await publish();
    expect((await shell(id)).status).toBe(200);
    expect((await frame(id)).status).toBe(200);
    // Access moves without a new version or edit: only the access decision can notice.
    await (await harness.db()).query("UPDATE artifacts SET visibility='private' WHERE id=$1", [id]);
    expect((await shell(id)).status).toBe(404);
    expect((await frame(id)).status).toBe(404);
    expect((await raw(request(`/a/${id}/raw`), params(id))).status).toBe(404);
  });

  it('never serves the old body after a new version', async () => {
    const {actor, id} = await publish();
    const before = await (await frame(id)).text();
    expect(before).toContain('First version');
    const shellBefore = await (await shell(id)).text();
    expect(shellBefore).toContain('v=1');
    const head = await (await read(request(`/api/artifacts/${id}`, {token: actor.token}), params(id))).json();
    const saved = await PUT(request(`/api/artifacts/${id}`, {method: 'PUT', token: actor.token, json: {html: head.html.replace('First version', 'Second version'), expectedVersion: head.version, expectedState: head.state}}), params(id));
    expect(saved.status).toBe(200);
    const after = await (await frame(id)).text();
    expect(after).toContain('Second version');
    expect(after).not.toContain('First version');
    expect(await (await shell(id)).text()).toContain('v=2');
  });

  it('keeps signed-in readers on the uncached path', async () => {
    const {actor, id} = await publish('private');
    const assemble = vi.spyOn(nativeHtml, 'nativeHtmlDocument');
    for (let i = 0; i < 2; i++) expect((await raw(request(`/a/${id}/raw`, {token: actor.token}), params(id))).status).toBe(200);
    expect(assemble).toHaveBeenCalledTimes(2);
  });

  it('counts every served view, cached or not', async () => {
    const {id} = await publish();
    for (let i = 0; i < 3; i++) expect((await frame(id)).status).toBe(200);
    await flushViews();
    const {rows} = await (await harness.db()).query<{n: number}>("SELECT count(*)::int AS n FROM analytics_events WHERE artifact_id=$1 AND event='view'", [id]);
    expect(rows[0]!.n).toBe(3);
  });
});
