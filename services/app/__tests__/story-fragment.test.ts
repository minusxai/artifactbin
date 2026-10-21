/**
 * THE STORY FRAGMENT (`GET /a/:id/story`, app/a/[id]/story; docs/phase2-architecture.md §2.4): the
 * compiled document's newest version as the page that asks is served it, for the live morph
 * (lib/islands/morph/engine). The raw route answers it, so the admission, the uniform 404 and the
 * sandbox are `/raw`'s; the `app` surface is the app page's story (its one isolated sheet); an anonymous
 * answer is readable from the `/raw` copy's opaque origin; a fragment is never a view and never today's
 * renderer. Real routes, the harness's database, the flag in `shadow` for this file.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { useAppHarness, request, setSession } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { GET as storyRoute } from '@/app/a/[id]/story/route';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { claimToken, createUser, ensureUsername } from '@/lib/accounts';
import { drainPreparedPageWarmups } from '@/lib/publish/prepared/prepared-page.server';
import { READER_MODE_HEADER } from '@/lib/compiled-page/contract';
import { storyFragmentUrl } from '@/lib/story-runtime/story-fragment';

const harness = useAppHarness();
beforeEach(() => setSession(null));
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const FIXTURES = path.resolve(process.cwd(), '../../scripts/fixtures/page-speed');
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');


async function publish(body: Record<string, unknown>): Promise<{ id: string; token: string }> {
  const { token } = await mintToken('story');
  // A private document needs an account behind its token.
  const user = await ensureUsername(await createUser({ email: `mxmx_test_story_${Math.random().toString(36).slice(2, 8)}@example.com` }));
  await claimToken(user.id, token);
  const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { visibility: 'public', ...body } }));
  if (made.status !== 201) throw new Error(await made.text());
  const id = ((await made.json()) as { id: string }).id;
  await drainPreparedPageWarmups();
  return { id, token };
}
const story = (id: string, search: string, surface: 'raw' | 'app' = 'raw', token?: string) =>
  storyRoute(request(storyFragmentUrl(id, search, surface), token ? { token } : {}), params(id));
const views = async (id: string) => Number((await (await harness.db()).query<{ n: string }>(`SELECT count(*) AS n FROM analytics_events WHERE event = 'view' AND artifact_id = $1`, [id])).rows[0]!.n);
const parse = (html: string) => new JSDOM(html).window.document;

describe('the story fragment', () => {
  it('is the /raw copy of the newest version: the same story, the same sandbox, readable by an anonymous opaque origin', async () => {
    const { id } = await publish({ title: 'Kit', markup: fixture('kit.jsx') });
    const [fragment, page] = [await story(id, '?reader=compiled'), await rawRoute(request(`/a/${id}/raw?reader=compiled`), params(id))];
    expect(fragment.status).toBe(200);
    expect(fragment.headers.get(READER_MODE_HEADER)).toBe('compiled');
    expect(fragment.headers.get('content-security-policy')).toBe(page.headers.get('content-security-policy'));
    expect(fragment.headers.get('access-control-allow-origin')).toBe('*');
    expect(fragment.headers.get('cache-control')).toBe('no-store');
    const [a, b] = [parse(await fragment.text()), parse(await page.text())];
    expect(a.getElementById('mx-story-root')!.outerHTML).toBe(b.getElementById('mx-story-root')!.outerHTML);
    expect(a.body.getAttribute('data-mx-live-edit')).toBe(b.body.getAttribute('data-mx-live-edit'));
    expect(a.querySelector('script[type="module"][src^="/islands/d/"]')?.getAttribute('src')).toBe(b.querySelector('script[type="module"][src^="/islands/d/"]')?.getAttribute('src'));
    expect(a.head.querySelector('style[data-mx-tw]'), 'the standalone sheets, as /raw carries them').not.toBeNull();
  });

  it('the app surface is the app page\'s story: its one isolated sheet, not the standalone sheets', async () => {
    const { id } = await publish({ title: 'Kit', markup: fixture('kit.jsx') });
    const doc = parse(await (await story(id, '?reader=compiled', 'app')).text());
    expect(doc.head.querySelector('style[data-mx-story-css]')).not.toBeNull();
    expect(doc.head.querySelector('style[data-mx-tw]')).toBeNull();
    expect(doc.getElementById('mx-story-root')).not.toBeNull();
  });

  it('carries the version\'s own source nodes on both surfaces, which the page itself does not', async () => {
    // The morph hands them to the document's selections and comments in the task it draws the version
    // (lib/islands/morph/engine STORY_VERSION_DRAWN_EVENT): never a window classified against another version.
    const { id } = await publish({ title: 'Kit', markup: fixture('kit.jsx') });
    for (const surface of ['raw', 'app'] as const) {
      const doc = parse(await (await story(id, '?reader=compiled', surface)).text());
      const carried = doc.getElementById('mx-story-nodes');
      expect(carried?.getAttribute('type'), surface).toBe('application/json');
      const nodes = JSON.parse(carried!.textContent!) as Array<{ type: string }>;
      expect(Array.isArray(nodes) && nodes.length > 0, surface).toBe(true);
      expect(nodes.some((node) => node.type === 'element'), surface).toBe(true);
    }
    const page = parse(await (await rawRoute(request(`/a/${id}/raw?reader=compiled`), params(id))).text());
    expect(page.getElementById('mx-story-nodes'), 'the page attaches with them from the app page instead').toBeNull();
  });

  it('draws kit elements at the view state the morph names, and the page itself at its defaults', async () => {
    // The live morph keeps the reader's running tabs and disclosures (lib/islands/morph/engine): the version it draws must show them.
    const markup = '<Tabs defaultValue="x" id="inner"><TabsList><TabsTrigger value="x" id="i-x">X</TabsTrigger><TabsTrigger value="y" id="i-y">Y</TabsTrigger></TabsList>'
      + '<TabsContent value="x" id="i-cx"><p>Panel X</p></TabsContent><TabsContent value="y" id="i-cy"><p>Panel Y</p></TabsContent></Tabs>'
      + '<Collapsible id="more"><CollapsibleTrigger>More</CollapsibleTrigger><CollapsibleContent id="more-body"><p>Details</p></CollapsibleContent></Collapsible>'
      + '<Dialog id="dlg"><DialogTrigger id="dlg-open">Open</DialogTrigger><DialogContent><p>Dialog body</p></DialogContent></Dialog>';
    const { id } = await publish({ title: 'Tabs', markup });
    const view = { 'inner:value': 'y', 'more:open': true };
    const shown = (doc: Document) => ({
      tab: doc.querySelector('[role="tab"][aria-selected="true"]')?.id,
      panel: doc.querySelector('[role="tabpanel"]:not([hidden])')?.id,
      open: doc.getElementById('more')?.getAttribute('data-state'),
    });
    const atView = (await (await storyRoute(request(storyFragmentUrl(id, '?reader=compiled', 'raw', view)), params(id))).text());
    expect(shown(parse(atView))).toEqual({ tab: 'i-y', panel: 'i-cy', open: 'open' });
    expect(shown(parse(await (await story(id, '?reader=compiled')).text()))).toEqual({ tab: 'i-x', panel: 'i-cx', open: 'closed' });
    // The page is served at its defaults, as its tree hydrates; and a view state out of bounds is no view state.
    const page = await rawRoute(request(`/a/${id}/raw?reader=compiled&mx-view=${encodeURIComponent(JSON.stringify(view))}`), params(id));
    expect(shown(parse(await page.text()))).toEqual({ tab: 'i-x', panel: 'i-cx', open: 'closed' });
    // A value of another kind than the element's own is not its state; an open dialog is drawn as the server draws one.
    const mistyped = await storyRoute(request(storyFragmentUrl(id, '?reader=compiled', 'raw', { 'inner:value': 7, 'more:open': 'yes' })), params(id));
    expect(shown(parse(await mistyped.text()))).toEqual({ tab: 'i-x', panel: 'i-cx', open: 'closed' });
    const dialog = await storyRoute(request(storyFragmentUrl(id, '?reader=compiled', 'raw', { 'dlg:open': true })), params(id));
    expect(dialog.status).toBe(200);
    expect(parse(await dialog.text()).querySelector('#dlg dialog')?.getAttribute('role')).toBe('dialog');
    expect(parse(atView).querySelector('#dlg dialog')?.hasAttribute('role'), 'closed when the view state does not name it').toBe(false);
    const unbounded = await storyRoute(request(`/a/${id}/story?surface=raw&reader=compiled&mx-view=${encodeURIComponent('{"inner:value":')}`), params(id));
    expect(shown(parse(await unbounded.text()))).toEqual({ tab: 'i-x', panel: 'i-cx', open: 'closed' });
  });

  it('is never a view (the page it updates already was one)', async () => {
    const { id } = await publish({ title: 'Prose', markup: fixture('prose.jsx') });
    await story(id, '?reader=compiled');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await views(id)).toBe(0);
    await rawRoute(request(`/a/${id}/raw?reader=compiled`), params(id));
    await vi.waitFor(async () => expect(await views(id), 'the page itself counts, as today').toBe(1));
  });

  it('a private document is the uniform 404 to a stranger, and its owner\'s answer carries no open CORS', async () => {
    const { id, token } = await publish({ title: 'Secret', markup: fixture('prose.jsx'), visibility: 'private' });
    const stranger = await story(id, '?reader=compiled');
    expect(stranger.status).toBe(404);
    expect(await stranger.text()).toBe(await (await rawRoute(request('/a/nope00/raw'), params('nope00'))).text());
    const owner = await story(id, '?reader=compiled', 'raw', token);
    expect(owner.status).toBe(200);
    expect(owner.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('always answers with the compiled reader and compiles a missing version inline', async () => {
    const { id } = await publish({ title: 'Prose', markup: fixture('prose.jsx') });
    const ordinary = await story(id, '');
    expect(ordinary.status).toBe(200);
    expect(ordinary.headers.get(READER_MODE_HEADER)).toBe('compiled');
    expect(await ordinary.text()).toContain('A plain prose document');
    const db = await harness.db();
    await db.query(`UPDATE prepared_pages SET compiled = NULL WHERE artifact_id = $1`, [id]);
    const notYet = await story(id, '?reader=compiled');
    expect(notYet.status).toBe(200);
    expect(notYet.headers.get(READER_MODE_HEADER)).toBe('compiled');
  });

  it('is the uniform 404 for an artifact that is not a document', async () => {
    const { id } = await publish({
      title: 'v',
      viz: { description: 'bar', engine: 'vega-lite', bindings: [{ name: 'x', label: 'X', accepts: ['nominal'] }], template: { mark: 'bar', encoding: { x: { field: '{{x}}', type: 'nominal' } } } },
    });
    expect((await story(id, '?reader=compiled')).status).toBe(404);
  });
});
