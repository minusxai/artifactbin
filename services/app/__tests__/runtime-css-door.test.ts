/**
 * A CLASS THE DATA BRINGS, THROUGH THE REAL APP SERVER (lib/serving/runtime-css.server, app/a/[id]/css).
 *
 * `className="{$_row.cls}"` whose rows (from SQL) say `bg-lime-500`: the rows the server draws are styled in the
 * first byte, the page data names the door it asks again at, and the door answers the document's WHOLE sheet with
 * the asked classes compiled in — immutable for its URL, under the page's own read ACL. A document whose classes
 * are all literal carries no door and is served exactly as before.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { attachActor } from '@artifactbin/utils';
import type { Actor } from '@artifactbin/contracts';
import { useAppHarness, request } from '@/__tests__/harness';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { claimToken, createUser } from '@/lib/accounts';
import { drainPreparedPageWarmups } from '@/lib/publish/prepared/prepared-page.server';
import { pagesOriginFor, pagesSiteFor } from '@/lib/http/pages-origin';
import { buildDocumentCsp } from '@/lib/page-styles/document-csp';
import { markupCsp } from '@/lib/page-styles';
import { ISLAND_DATA_ID } from '@/lib/story-runtime/contract';
import { storyCssCompileVersion } from '@/lib/data/story/story-css.server';
import { createAppServer } from '../server/app';

useAppHarness();

const APP = 'https://app.example.test';
const site = pagesSiteFor('pages.example.test', APP)!;
const SHELL = '<!doctype html><html><head><title>artifactbin</title></head><body><div id="root"></div></body></html>';
const framing = () => createAppServer({ indexHtml: async () => SHELL, pagesSite: site });

/** Each row's class from SQL: utilities, a hover variant, a breakpoint and an arbitrary value. */
const DYNAMIC = '<Helmet><Value name="items" type="table" value={[{id: 1, status: "ok"}, {id: 2, status: "late"}]} />'
  + '<Query name="rows">{`select id, status, case when status = \'ok\' then \'bg-lime-500 hover:bg-sky-600\' else \'md:w-64 w-[37%]\' end as cls from items order by id`}</Query></Helmet>'
  + '<h1>Badges</h1><For each={$rows} keyBy="id"><span className="px-2 {$_row.cls}">{$_row.status}</span></For>';
const STATIC = '<h1 className="text-3xl md:w-1/2">Plain</h1>';

let owner: { actor: Actor; publish: (markup: string, visibility: string) => Promise<string> };

async function world() {
  const user = await createUser({ email: 'runtime-css-owner@example.com' });
  const t = await mintToken('runtime-css-owner', user.id);
  await claimToken(user.id, t.token);
  const publish = async (markup: string, visibility: string) => {
    const res = await createRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup, visibility } }));
    expect(res.status, await res.clone().text()).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  const actor: Actor = { credential: 'session', userId: user.id, email: 'runtime-css-owner@example.com', emailVerified: true };
  owner = { actor, publish };
  return owner;
}

const island = (html: string): Record<string, unknown> | null => {
  const match = new RegExp(`<script type="application/json" id="${ISLAND_DATA_ID}">([^<]*)<\\/script>`).exec(html);
  return match ? JSON.parse(match[1]!) as Record<string, unknown> : null;
};
type CssData = { url: string; known: string[]; extras?: string[] };
const rule = (selector: string) => new RegExp(`${selector.replace(/[\\[\]().%:/]/g, (c) => `\\${c}`)}\\s*\\{`);
const as = (url: string, actor: Actor | null, init: RequestInit = {}) => {
  const built = new Request(url, init);
  return actor ? attachActor(built, actor) : built;
};

afterEach(() => { owner = undefined as never; });

describe('a document whose rows bring their classes', () => {
  it('is served with the drawn rows\' classes already in its sheet, and names its door in the page data', async () => {
    const w = await world();
    const id = await w.publish(DYNAMIC, 'public');
    await drainPreparedPageWarmups();
    const self = pagesOriginFor(id, site);
    const res = await framing().request(`${self}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('bg-lime-500 hover:bg-sky-600');
    // The rows the server drew are styled in the first byte: no flash, no request.
    expect(html).toMatch(rule('.bg-lime-500'));
    expect(html).toMatch(rule('.md\\:w-64'));
    const css = island(html)!.css as CssData;
    expect(css.url).toBe(`${self}/a/${id}/css?v=1&k=${storyCssCompileVersion()}`);
    expect(css.known).toContain('px-2');
    expect(css.extras).toEqual(expect.arrayContaining(['bg-lime-500', 'hover:bg-sky-600', 'md:w-64', 'w-[37%]']));
  });

  it('a class a page value fills (`className="{$tone}"`, a Tailwind utility the source never names) is in the first byte, and the door names it for the control that changes it', async () => {
    const w = await world();
    const id = await w.publish('<Helmet><Value name="tone" type="string" default="bg-fuchsia-600" /></Helmet>'
      + '<Select id="pick" value="$tone" options={["bg-fuchsia-600", "bg-teal-700"]} /><p id="toned" className="p-2 {$tone}">Toned</p>', 'public');
    await drainPreparedPageWarmups();
    const self = pagesOriginFor(id, site);
    const html = await (await framing().request(`${self}/`)).text();
    expect(html).toMatch(/class="p-2 bg-fuchsia-600"/);
    expect(html).toMatch(rule('.bg-fuchsia-600'));
    const css = island(html)!.css as CssData;
    expect(css.extras).toEqual(['bg-fuchsia-600']);
    // The control's other choice is asked for at the door when chosen: the whole sheet, with it.
    const door = await framing().request(`${css.url}&x=${encodeURIComponent('bg-teal-700')}`, { headers: { origin: self } });
    expect(door.status).toBe(200);
    expect(await door.text()).toMatch(rule('.bg-teal-700'));
  });

  it('a document whose classes are all literal carries no door and is served as before', async () => {
    const w = await world();
    const id = await w.publish(STATIC, 'public');
    await drainPreparedPageWarmups();
    const html = await (await framing().request(`${pagesOriginFor(id, site)}/`)).text();
    expect(html).toContain('Plain');
    expect(island(html)?.css).toBeUndefined();
  });

  it('the door answers the whole sheet with the asked classes, immutable and validated, with credentialed CORS on its own origin', async () => {
    const w = await world();
    const id = await w.publish(DYNAMIC, 'public');
    await drainPreparedPageWarmups();
    const app = framing();
    const self = pagesOriginFor(id, site);
    const url = `${self}/a/${id}/css?v=1&k=${storyCssCompileVersion()}&x=${encodeURIComponent('bg-rose-500 w-full')}`;
    const res = await app.request(url, { headers: { origin: self } });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('access-control-allow-origin')).toBe(self);
    const css = await res.text();
    expect(css).toMatch(rule('.bg-rose-500'));
    expect(css).toMatch(rule('.w-full'));
    // The whole sheet: the document's own classes and the recipe union are there too.
    expect(css).toMatch(rule('.px-2'));
    const etag = res.headers.get('etag')!;
    expect(etag).toMatch(/^"/);
    const again = await app.request(url, { headers: { origin: self, 'if-none-match': etag } });
    expect(again.status).toBe(304);
    // A page served before a deploy asks under the old environment: answered, never cached under that URL.
    const stale = await app.request(`${self}/a/${id}/css?v=1&k=v-old&x=bg-rose-500`, { headers: { origin: self } });
    expect(stale.status).toBe(200);
    expect(stale.headers.get('cache-control')).toBe('private, no-cache');
  });

  it('refuses what is not a class, more classes than one sheet takes, and a version that does not exist', async () => {
    const w = await world();
    const id = await w.publish(DYNAMIC, 'public');
    const app = framing();
    const door = (search: string) => app.request(as(`${APP}/a/${id}/css?${search}`, w.actor));
    expect((await door(`v=1&x=${encodeURIComponent('a"b')}`)).status).toBe(400);
    expect((await door(`v=1&x=${encodeURIComponent('w-[1px];color:red')}`)).status).toBe(400);
    expect((await door(`v=1&x=${encodeURIComponent(Array.from({ length: 501 }, (_, i) => `w-${i}`).join(' '))}`)).status).toBe(400);
    expect((await door('v=abc&x=w-full')).status).toBe(400);
    expect((await door('v=9&x=w-full')).status).toBe(404);
  });

  it('follows the page\'s read access: a private document is the uniform 404 to a stranger and a private answer to its reader', async () => {
    const w = await world();
    const id = await w.publish(DYNAMIC, 'private');
    const app = framing();
    const url = `${APP}/a/${id}/css?v=1&k=${storyCssCompileVersion()}&x=bg-rose-500`;
    expect((await app.request(url)).status).toBe(404);
    const mine = await app.request(as(url, w.actor));
    expect(mine.status).toBe(200);
    expect(mine.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(mine.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('the document\'s policies admit the door, path-exact', () => {
    expect(buildDocumentCsp({ self: 'https://abc.pages.example.test', app: APP, id: 'abc123' })).toMatch(/connect-src [^;]*https:\/\/app\.example\.test\/a\/abc123\/css( |;)/);
    expect(markupCsp(APP, 'abc123')).toMatch(/connect-src [^;]*https:\/\/app\.example\.test\/a\/abc123\/css /);
  });
});
