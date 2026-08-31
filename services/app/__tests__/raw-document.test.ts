/**
 * /a/<id>/raw for markup rows: the SSR'd
 * standalone document, not the source. The response headers ARE the sandbox —
 * the exact CSP string and the sandbox flag set are contract, not detail.
 * Source read-back lives on the API (`markup:` in the wire), not here.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { GET as serveArtifact } from '@/app/a/[id]/raw/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { mintToken } from '@/lib/tokens';
import { STORY_ISLAND_ID } from '@/lib/story-runtime/contract';
import { storyRuntimeSrc } from '@/lib/story/runtime-asset';

const BASE = 'http://localhost:3000';
const harness = useAppHarness();

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const HELMET =
  '<Helmet><title>Scripted doc</title><script>{`document.body.dataset.ran = "1";`}</script></Helmet>';

/**
 * The exact policy, per document: every directive content-independent, plus a
 * `connect-src` admitting exactly this document's own endpoints — the
 * query it runs its data through, and the stream it hears its author's edits
 * on — plus the static /geojson/ boundary directory the geo charts fetch.
 * Absolute and path-exact (a trailing slash = that directory), never 'self',
 * which would open every /api route to the author's script.
 * lib/story/markup-csp is the one builder.
 */
const markupCspFor = (id: string) => [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'self'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  `connect-src ${BASE}/a/${id}/query ${BASE}/a/${id}/events ${BASE}/a/${id}/events/frame ${BASE}/a/${id}/mutate ${BASE}/geojson/`,
  "form-action 'none'",
  "base-uri 'none'",
  // Only this origin's own pages may FRAME a document. A third-party framer
  // becomes `window.parent`, and the parent is who the runtime takes edit-mode
  // and document-replacement commands from.
  "frame-ancestors 'self'",
  'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation',
].join('; ');

const publish = async (markup: string): Promise<string> => {
  const t = await mintToken('t');
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup } }));
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
};

describe('/a/<id>/raw for markup rows', () => {
  it('serves the SSR document: text/html, root + island + runtime + author script', async () => {
    // A component in the body, so this document actually hydrates — a
    // plain-tag document ships no runtime at all (see document.test.ts).
    const id = await publish(HELMET + '<h1 className="text-4xl">Hello</h1><Card><CardContent>c</CardContent></Card>');
    const res = await serveArtifact(request(`/a/${id}/raw`), params({ id }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain(`id="${STORY_ISLAND_ID}"`);
    // The URL comes from the build's manifest, not a literal: everything under
    // /story/ is cached `immutable` for a year, which is only safe while a new
    // build means a new name (lib/story/runtime-asset).
    expect(html).toContain(`src="${storyRuntimeSrc()}"`);
    expect(storyRuntimeSrc()).toMatch(/^\/story\/entry-[A-Z0-9]+\.js$/);
    // Parked for the runtime to execute after hydration (AUTHOR_SCRIPT_TYPE).
    expect(html).toContain('document.body.dataset.ran');
    expect(html).toContain('type="text/mx-author"');
    expect(html).toContain('Hello');
    expect(html).toContain('<title>Scripted doc</title>');
  });

  it('carries the exact markup CSP header, sandbox flags included — connect-src scoped to THIS document\'s query url', async () => {
    const id = await publish(HELMET + '<p>x</p>');
    const res = await serveArtifact(request(`/a/${id}/raw`), params({ id }));
    expect(res.headers.get('Content-Security-Policy')).toBe(markupCspFor(id));
    // The connect-src is this document's own two endpoints plus the static
    // boundary-geometry directory, and nothing else: nothing under /api, no
    // other document, no /a/<id>/start — the author's script can reach exactly
    // what the runtime reaches: its own data, its own live stream, and the
    // public /geojson/ files the geo charts draw their basemaps from.
    const csp = res.headers.get('Content-Security-Policy')!;
    expect(csp.match(/connect-src [^;]*/g)).toEqual([`connect-src ${BASE}/a/${id}/query ${BASE}/a/${id}/events ${BASE}/a/${id}/events/frame ${BASE}/a/${id}/mutate ${BASE}/geojson/`]);
    expect(csp).not.toMatch(/connect-src[^;]*'self'/);
    // Behind the proxy the origin is the PUBLIC one (forwarding headers), so
    // the policy names the host the browser actually fetches from.
    const fwd = await serveArtifact(new Request(`${BASE}/a/${id}/raw`, { headers: { 'x-forwarded-host': 'artifactbin.dev', 'x-forwarded-proto': 'https' } }), params({ id }));
    expect(fwd.headers.get('Content-Security-Policy')).toContain(`connect-src https://artifactbin.dev/a/${id}/query`);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('names its own query url in the island, so the top-level document can fetch its re-runs — and a document that declares data hydrates even with no component (its bound control needs the store)', async () => {
    const t = await mintToken('t');
    const ds = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { dataset: [{ region: 'EU' }, { region: 'NA' }] } })).then((r) => r.json());
    const boundOnly = `<Helmet><Value name="region" type="string" /><Query name="regions">{\`select distinct region from ref_${ds.id} order by 1\`}</Query></Helmet><div><select aria-label="Region" value="$region" options="$regions" /></div>`;
    const id = (await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: boundOnly } })).then((r) => r.json())).id as string;
    const html = await (await serveArtifact(request(`/a/${id}/raw`), params({ id }))).text();
    const m = html.match(/<script type="application\/json" id="mx-story-data">(.*?)<\/script>/s);
    expect(m).not.toBeNull();
    const island = JSON.parse(m![1]) as { queryUrl?: string; dataflow?: unknown };
    expect(island.queryUrl).toBe(`/a/${id}/query`);
    expect(island.dataflow).toBeTruthy();
    // Plain prose still ships no island at all — nothing to hydrate, nothing to fetch.
    const prose = await publish('<div><h1>Hello</h1></div>');
    expect(await (await serveArtifact(request(`/a/${prose}/raw`), params({ id: prose }))).text()).not.toContain('id="mx-story-data"');
  });

  /*
   * PAINT FIRST. The reader's copy carries the DECLARATIONS and no rows: the
   * server neither runs the queries nor inlines their results, so the document
   * arrives at final geometry immediately and fills itself in through the
   * transport it already owns. Measured on production, inlining was 231 KB of
   * a 365 KB page and ~90ms of a ~100ms render — all of it spent before the
   * reader saw anything.
   *
   * The CAPTURE render is the exception and must stay one: /export screenshots
   * that frame, and a photograph of a skeleton is not a preview of anything.
   */
  const publishQueryDoc = async (): Promise<string> => {
    const t = await mintToken('t');
    const ds = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { dataset: [{ month: '2026-01', revenue: 10 }, { month: '2026-02', revenue: 20 }], title: 'rev' } }));
    const { id: dsId } = (await ds.json()) as { id: string };
    const doc = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: `<Helmet><Query name="rows">{\`select * from ref_${dsId}\`}</Query></Helmet><p>n: <Number data="$rows" col="revenue" agg="sum" /></p>` } }));
    expect(doc.status).toBe(201);
    return ((await doc.json()) as { id: string }).id;
  };

  it("sends the reader the declarations and NOT the rows — the document fetches its own", async () => {
    const id = await publishQueryDoc();
    const html = await serveArtifact(request(`/a/${id}/raw`), params({ id })).then((r) => r.text());
    const island = JSON.parse(/<script type="application\/json" id="[^"]+">([\s\S]*?)<\/script>/.exec(html)![1]) as
      { dataflow?: { flow?: unknown; state?: unknown }; queryUrl?: string };
    // The declarations ride along: without them the runtime has nothing to run.
    expect(island.dataflow?.flow).toBeTruthy();
    // The rows do not, in any form.
    expect(island.dataflow?.state).toBeUndefined();
    expect(html).not.toContain('"revenue":20');
    // And it knows where to go and get them.
    expect(island.queryUrl).toBe(`/a/${id}/query`);
  });

  it('sends the CAPTURE render its rows, and the resolved figure with them', async () => {
    const id = await publishQueryDoc();
    const html = await serveArtifact(request(`/a/${id}/raw?chrome=0`), params({ id })).then((r) => r.text());
    const island = JSON.parse(/<script type="application\/json" id="[^"]+">([\s\S]*?)<\/script>/.exec(html)![1]) as
      { dataflow?: { state?: unknown } };
    expect(island.dataflow?.state).toBeTruthy();
    expect(html).toContain('"revenue":20');
    // SSR resolved the number, because the exporter photographs this frame.
    expect(html).toContain('30');
  });

  /*
   * The glyph wiring has THREE surfaces here that must all carry it — the SSR
   * body, the island the client hydrates from, and the capture render — and a
   * new render path that forgets it is a document whose icons vanish.
   */
  it('resolves the icons a document uses into both the SSR body and the island, and nothing more', async () => {
    const id = await publish('<div><Icon name="chart-column" /><Icon name="grid-2x2" /></div>');
    const html = await (await serveArtifact(request(`/a/${id}/raw`), params({ id }))).text();

    // Server-rendered, so the icon is in the document a crawler and a capture see.
    expect(html).toContain('lucide-chart-column');
    // grid-2x2 carries TWO lucide classes; dropping the second is a hydration
    // mismatch, which is invisible until React repaints the whole document.
    expect(html).toContain('lucide-grid2x2 lucide-grid-2x2');

    // …and the island carries the same glyphs, or the client hydrates a different
    // tree than the server sent.
    // `<` is a valid JSON escape, so the island parses as written — but the
    // glyph markup carries raw `>`, so the script body has to be cut by index.
    const after = html.split(`id="${STORY_ISLAND_ID}"`)[1];
    const island = JSON.parse(after.slice(after.indexOf('>') + 1, after.indexOf('</script>')));
    expect(Object.keys(island.glyphs).sort()).toEqual(['ChartColumn', 'CircleQuestionMark', 'Grid2x2']);
    // The whole point: the map is the size of the document, not of lucide.
    expect(Object.keys(island.glyphs).length).toBeLessThan(5);
  });

  it('the deck rail draws its slides icons too, not just their text', async () => {
    // The rail re-renders each slide's OWN nodes rather than capturing them, so a
    // slide's content appears twice in the document. Glyphs have to reach that
    // second render as well: the rail is deck chrome and sits outside the body,
    // so a provider wrapped around the body alone left every rail preview with the
    // text but a hole where its icon goes.
    const id = await publish(
      '<SlideDeck><Slide title="A"><h1>One</h1><Icon name="chart-column" /></Slide>'
      + '<Slide title="B"><h1>Two</h1></Slide></SlideDeck>',
    );
    const html = await (await serveArtifact(request(`/a/${id}/raw`), params({ id }))).text();
    const count = (needle: string) => html.split(needle).length - 1;

    expect(count('>One<')).toBe(2); // the slide, and its rail preview
    expect(count('class="lucide lucide-chart-column')).toBe(2); // …and so its icon
  });

  it('a document that draws no icon carries no glyphs at all', async () => {
    const id = await publish('<Card><CardContent>no icons here</CardContent></Card>');
    const html = await (await serveArtifact(request(`/a/${id}/raw`), params({ id }))).text();
    expect(html).not.toContain('"glyphs"');
  });

  it('?chrome=0 serves the document without its own navigation chrome (capture renders)', async () => {
    const id = await publish('<SlideDeck><Slide title="A"><h1>One</h1></Slide><Slide title="B"><h1>Two</h1></Slide></SlideDeck>');
    const withChrome = await (await serveArtifact(request(`/a/${id}/raw`), params({ id }))).text();
    expect(withChrome).toContain('Slide controls');

    const bare = await (await serveArtifact(request(`/a/${id}/raw?chrome=0`), params({ id }))).text();
    expect(bare).not.toContain('Slide controls');
    expect(bare).toContain('One');
  });

});

/**
 * A row stored under a RETIRED format is not a supported case — it is nothing.
 *
 * Production still held html-tier rows when unification shipped, and the switch
 * here covers markup/dataset/viz/image only, so they fell off the end of the
 * handler and Next answered 500. That is a crash, not a policy: the fix is the
 * uniform 404 an unknown id already gets, NOT a compatibility path. Nothing
 * here knows what `html` was, and nothing should.
 *
 * TypeScript could not catch it — `format` arrives from the database as a
 * plain string, so the switch had nothing to be exhaustive against.
 */
describe('/a/<id>/raw for a row from a retired tier', () => {
  const storeRetiredRow = async (format: string) => {
    const db = await harness.db();
    const t = await mintToken('legacy');
    const res = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: '<p>placeholder</p>' } }),
    );
    const { id } = (await res.json()) as { id: string };
    // Force the row into the shape production actually holds.
    await db.query(`UPDATE artifacts SET format = $1, content = $2, source = NULL WHERE id = $3`,
      [format, '<!doctype html><title>old</title><p>an html-tier document</p>', id]);
    return id;
  };

  it.each(['html', 'markdown'])('is a uniform 404, not a crash, for a %s row', async (format) => {
    const id = await storeRetiredRow(format);
    const res = await serveArtifact(request(`/a/${id}/raw`), params({ id }));
    expect(res.status).toBe(404);
    // byte-identical to an id that never existed: no tier named, nothing
    // explaining what used to be here, nothing to maintain
    const missing = await serveArtifact(request('/a/zzzzzz/raw'), params({ id: 'zzzzzz' }));
    expect(await res.text()).toBe(await missing.text());
  });
});
