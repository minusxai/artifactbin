/**
 * PRERENDERED MERMAID DRAWINGS, through the real routes on isolated state: a
 * publish queues a harvest after its commit; the harvester has the browser draw
 * the version on each reader surface in each mode with the engine forced, and
 * stores what is inert and reproducible; the served document and the app's
 * page then carry the stored drawings instead of the engine's code. The browser
 * is a fake that answers the way the real one does (services/browser harvest).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BrowserService, SvgHarvestRequest, SvgHarvestResult } from '@artifactbin/contracts';
import { useAppHarness, request } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { PUT as replaceRoute } from '@/app/api/artifacts/[id]/route';
import { GET as serveArtifact } from '@/app/a/[id]/raw/route';
import { GET as pageData } from '@/app/api/page/artifact/[id]/route';
import { GET as mermaidAsset } from '@/app/assets/mermaid/[file]/route';
import { artifactPageAnswer } from '@/lib/artifact-page';
import { getArtifactById } from '@/lib/artifacts';
import { getDb } from '@/lib/db';
import { mintToken } from '@/lib/tokens';
import { services, setServices } from '@/lib/services';
import { verifyExportKey } from '@/lib/export-key';
import { mermaidImageKey } from '@/lib/story-ui/mermaid-source';
import { runNextMermaidHarvest, startMermaidHarvester } from '@/lib/mermaid-images/harvester';
import { MERMAID_RENDER_ENGINE } from '@/lib/mermaid-images/engine';
import { queueMermaidBackfill } from '@/lib/mermaid-images/store';
import { documentEditBody } from './prepared-document';

useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const FLOW = 'flowchart LR\n  a[Request] --> b[Read]';
const SEQ = 'sequenceDiagram\n  A->>B: hi';
const PIE = 'pie\n  "a" : 1';
const GANTT = 'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section A\n  One :a1, 2024-01-01, 3d';
const markup = (codes: string[]) => `<div>${codes.map((code, i) => `<Mermaid title="D${i}" code={${JSON.stringify(code)}} />`).join('')}</div>`;
const PALETTE = { document: 'a'.repeat(32), inline: 'b'.repeat(32) } as const;
/** What the harvest's (unhinted) browser measured the palette's faces as (lib/mermaid-images/match). */
const METRICS = [855.9375, 20, -16, 646.796875, 14, -11];
/**
 * Readers, by what the server knows of them: Blink on macOS measures as the
 * harvest does; Blink on Linux rounds its glyph advances, and WebKit draws its
 * line boxes shorter, so neither can use a stored drawing.
 */
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const LINUX_CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const reader = (path: string, ua = MAC_CHROME, headers: Record<string, string> = {}) => request(path, { headers: { 'user-agent': ua, ...headers } });

/**
 * A browser that draws like the kit: per surface and mode, one figure per
 * code, each carrying the key and palette the component would set. `vary`
 * makes a code's drawing differ per load; `unsafe` makes it carry a script.
 */
function drawingBrowser(codes: string[], opts: { vary?: string; unsafe?: string; down?: boolean; forged?: string; system?: string; unmeasured?: string } = {}) {
  const calls: SvgHarvestRequest[] = [];
  let loads = 0;
  const browser: BrowserService = {
    render: async () => ({ ok: false, reason: 'unavailable' }),
    async harvestSvg(req): Promise<SvgHarvestResult> {
      calls.push(req);
      if (opts.down) return { ok: false, reason: 'unavailable' };
      const url = new URL(req.url);
      const surface = url.pathname.endsWith('/raw') ? 'document' : 'inline';
      const mode = url.searchParams.get('color') as 'light' | 'dark';
      loads += 1;
      return { ok: true, loads: [codes.map((code, i) => ({
        attributes: {
          'data-mx-mermaid-key': mermaidImageKey(code, mode), 'data-mx-mermaid-palette': PALETTE[surface], 'data-mermaid-type': 'flowchart-v2', 'data-mx-mermaid-state': 'ready',
          // `system`: drawn in a face that is not one of the document's loaded web fonts; `unmeasured`: no text boxes.
          ...(code === opts.unmeasured ? {} : { 'data-mx-mermaid-metrics': METRICS.join(',') }),
          ...(code === opts.system ? {} : { 'data-mx-mermaid-portable': '' }),
        },
        width: 120, height: 80,
        // Ids are numbered per page load, as the kit's are (`mx-mermaid-N`).
        svg: `<svg xmlns="http://www.w3.org/2000/svg" id="mx-mermaid-${loads * 10 + i}" viewBox="0 0 10 10"><text>${surface} ${mode} ${i}${code === opts.vary ? ` ${loads}` : ''}${opts.forged ?? ''}</text>${code === opts.unsafe ? '<script>alert(1)</script>' : ''}</svg>`,
      }))] };
    },
  };
  return { browser, calls };
}

let original: BrowserService;
beforeEach(() => { original = services().browser; });
afterEach(() => { setServices({ browser: original }); });

async function publish(codes: string[], visibility = 'public') {
  const owner = await mintToken('mermaid-prerender');
  const created = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: owner.token, json: { markup: markup(codes), visibility } }));
  expect(created.status, await created.clone().text()).toBe(201);
  return { owner, id: (await created.json()).id as string };
}
const jobs = async (id: string) => (await (await getDb()).query<{ version: number; state: string; attempts: number; retry_after: string | null; images: Record<string, Record<string, string>> | null }>(
  'SELECT version,state,attempts,retry_after,images FROM mermaid_harvests WHERE artifact_id=$1 ORDER BY version', [id])).rows;
const raw = async (id: string, query = '', ua = MAC_CHROME) => (await serveArtifact(reader(`/a/${id}/raw${query}`, ua), params({ id }))).text();
const island = (html: string) => JSON.parse(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/.exec(html)![1].replace(/\\u003c/g, '<')) as { mermaidImages?: Record<string, { src: string; palette: string; type: string; width?: number; height?: number; metrics?: number[] }> };
const head = (html: string) => html.split('</head>')[0];

describe('a published Mermaid document', () => {
  it('carries its stored drawings AND a data document\'s first results in one overlay, rendered fresh and never stored', async () => {
    const { browser } = drawingBrowser([FLOW]);
    setServices({ browser });
    const owner = await mintToken('mermaid-with-data');
    const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: owner.token, json: { visibility: 'public',
      markup: `<Helmet><Value name="n" type="number" default={2} /><Query name="q">{\`select $n * 21 as n\`}</Query></Helmet><div><p>Answer <Number data="$q" col="n" /></p><Mermaid title="D0" code={${JSON.stringify(FLOW)}} /></div>` } }));
    expect(made.status, await made.clone().text()).toBe(201);
    const id = (await made.json()).id as string;
    while (await runNextMermaidHarvest()) { /* drain */ }
    const answer = await artifactPageAnswer(request(`/a/${id}`), id);
    const data = (answer.body as { surface: { runtime: { data: { mermaidImages?: Record<string, { src: string }>; dataflow?: { results?: { tables: Record<string, { rows: unknown[] }> } } } } } }).surface.runtime.data;
    expect(data.dataflow?.results?.tables.q?.rows).toEqual([{ n: 42 }]);
    const drawing = data.mermaidImages?.[mermaidImageKey(FLOW, 'light')];
    expect(drawing?.src).toMatch(/^\/assets\/mermaid\//);
    const html = answer.story!.html();
    expect(html).toContain('aria-label="Live number">42<');
    expect(html).toContain(`src="${drawing!.src}"`);
    const stored = (await (await getDb()).query<{ page: { ssr: { html: string } } }>(`SELECT page FROM prepared_pages WHERE artifact_id = $1 AND slot = 'head'`, [id])).rows[0]!;
    expect(stored.page.ssr.html).not.toContain('aria-label="Live number">42<');
  });

  it('queues a harvest after its commit, and the harvested version is drawn from stored SVG on both reader paths', async () => {
    const { browser, calls } = drawingBrowser([FLOW, SEQ]);
    setServices({ browser });
    const { id } = await publish([FLOW, SEQ]);
    expect(await jobs(id)).toEqual([expect.objectContaining({ version: 1, state: 'pending', attempts: 0 })]);

    // Before the harvest: today's page, the engine's chunks preloaded and nothing stored.
    const before = await raw(id);
    expect(head(before)).toMatch(/modulepreload" href="[^"]*mermaid-render-/);
    expect(island(before).mermaidImages).toBeUndefined();

    expect(await runNextMermaidHarvest()).toBe(true);
    expect(await runNextMermaidHarvest()).toBe(false);
    const [job] = await jobs(id);
    expect(job.state).toBe('done');
    // Two surfaces × two modes, each drawn with the engine forced under a capture key.
    expect(calls.map((c) => { const u = new URL(c.url); return `${u.pathname.endsWith('/raw') ? 'document' : 'inline'}/${u.searchParams.get('color')}`; }))
      .toEqual(expect.arrayContaining(['document/light', 'document/dark', 'inline/light', 'inline/dark']));
    for (const call of calls) {
      const u = new URL(call.url);
      expect(u.searchParams.get('mermaid')).toBe('engine');
      expect(verifyExportKey(id, u.searchParams.get('key') ?? undefined)).toBe(true);
      expect(call.sameOriginOnly).toBe(true);
    }

    // The served document: stored drawings in the SSR and the island, both modes, no engine code named.
    const after = await raw(id);
    const images = island(after).mermaidImages!;
    expect(Object.keys(images).sort()).toEqual([FLOW, SEQ].flatMap((code) => [mermaidImageKey(code, 'light'), mermaidImageKey(code, 'dark')]).sort());
    const flow = images[mermaidImageKey(FLOW, 'light')]!;
    expect(flow).toEqual({ src: expect.stringMatching(/^\/assets\/mermaid\/[0-9a-f]{64}\.svg$/), type: 'flowchart-v2', palette: PALETTE.document, metrics: METRICS, width: 120, height: 80 });
    expect(after).toContain(`src="${flow.src}"`);
    expect(head(after)).not.toMatch(/mermaid-render-|flowDiagram|sequenceDiagram|elk-/);
    expect(head(after)).toContain(`<link rel="preload" href="${flow.src}" as="image">`);

    // The app's inline reader gets its OWN surface's drawings.
    const page = await (await pageData(reader(`/api/page/artifact/${id}`), params({ id }))).json();
    const inline = page.surface.runtime.data.mermaidImages[mermaidImageKey(FLOW, 'light')];
    expect(inline.palette).toBe(PALETTE.inline);
    expect(inline.src).not.toBe(flow.src);

    // The bytes: immutable, typed, inert.
    const file = flow.src.split('/').pop()!;
    const served = await mermaidAsset(request(flow.src), params({ file }));
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(served.headers.get('content-security-policy')).toBe('sandbox');
    expect(served.headers.get('cache-control')).toContain('immutable');
    expect(await served.text()).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" id="mx-mermaid-\d+" viewBox="0 0 10 10"><text>document light 0<\/text><\/svg>$/);
    expect((await mermaidAsset(request('/assets/mermaid/x.svg'), params({ file: `${'0'.repeat(64)}.svg` }))).status).toBe(404);

    // Asked for by name, the engine draws as before: nothing stored reaches the page.
    const engine = await raw(id, '?mermaid=engine');
    expect(island(engine).mermaidImages).toBeUndefined();
    expect(head(engine)).toMatch(/mermaid-render-/);
  });

  it('a harvest that lands after the reader page was prepared is served on the next read, and its preloads drop the engine', async () => {
    setServices({ browser: drawingBrowser([FLOW]).browser });
    const { id } = await publish([FLOW]);
    // The app's reader page is prepared (and stored) before any drawing exists.
    const first = await artifactPageAnswer(reader(`/a/${id}`, MAC_CHROME, { accept: 'text/html' }), id);
    expect(first.status).toBe(200);
    expect((first.body as { surface: { runtime: { data: Record<string, unknown> } } }).surface.runtime.data.mermaidImages).toBeUndefined();
    expect(first.story?.lazyCode.mermaid).toEqual(['flowchart']);
    const db = await getDb();
    expect(Number((await db.query<{ n: string }>('SELECT count(*) AS n FROM prepared_pages WHERE artifact_id=$1', [id])).rows[0].n)).toBe(1);

    expect(await runNextMermaidHarvest()).toBe(true);
    const next = await artifactPageAnswer(reader(`/a/${id}`, MAC_CHROME, { accept: 'text/html' }), id);
    const images = (next.body as { surface: { runtime: { data: { mermaidImages?: Record<string, { src: string; palette: string }> } } } }).surface.runtime.data.mermaidImages;
    const stored = images?.[mermaidImageKey(FLOW, 'light')];
    expect(stored?.palette).toBe(PALETTE.inline);
    // The served story itself carries the stored drawing, and the page names no engine code for it.
    expect(next.story!.html()).toContain(`src="${stored!.src}"`);
    expect(next.story!.lazyCode.mermaid).toEqual([]);
    expect(next.story!.lazyCode.mermaidImages).toEqual([stored!.src]);
    // Asked for by name, the engine draws as before.
    const engine = await artifactPageAnswer(reader(`/a/${id}?mermaid=engine`, MAC_CHROME, { accept: 'text/html' }), id);
    expect((engine.body as { surface: { runtime: { data: Record<string, unknown> } } }).surface.runtime.data.mermaidImages).toBeUndefined();
    expect(engine.story!.html()).not.toContain('/assets/mermaid/');
  });

  it('shares stored drawings across documents that draw the same thing, and verifies only what is new', async () => {
    const first = drawingBrowser([FLOW]);
    setServices({ browser: first.browser });
    const a = await publish([FLOW]);
    await runNextMermaidHarvest();
    // Four surfaces/modes, each drawn twice: a drawing never stored before must reproduce.
    expect(first.calls).toHaveLength(8);
    const second = drawingBrowser([FLOW]);
    setServices({ browser: second.browser });
    const b = await publish([FLOW]);
    await runNextMermaidHarvest();
    expect(second.calls).toHaveLength(4);
    expect(island(await raw(b.id)).mermaidImages).toEqual(island(await raw(a.id)).mermaidImages);
    expect(Number((await (await getDb()).query<{ n: string }>('SELECT count(*) AS n FROM mermaid_images')).rows[0].n)).toBe(4);
  });

  it('a page claiming another drawing for the same code only ever names its own bytes', async () => {
    setServices({ browser: drawingBrowser([FLOW]).browser });
    const honest = await publish([FLOW]);
    await runNextMermaidHarvest();
    // Another document's page hands the harvest a different drawing under the same key and palette.
    setServices({ browser: drawingBrowser([FLOW], { forged: ' planted' }).browser });
    const forger = await publish([FLOW]);
    await runNextMermaidHarvest();
    const src = (id: string) => async () => island(await raw(id)).mermaidImages![mermaidImageKey(FLOW, 'light')]!.src;
    const [honestSrc, forgerSrc] = [await src(honest.id)(), await src(forger.id)()];
    expect(forgerSrc).not.toBe(honestSrc);
    const file = honestSrc.split('/').pop()!;
    expect(await (await mermaidAsset(request(honestSrc), params({ file }))).text()).not.toContain('planted');
  });

  it('a private document is never harvested or served stored drawings (they are served to anyone with the address)', async () => {
    const { calls, browser } = drawingBrowser([FLOW]);
    setServices({ browser });
    const { owner, id } = await publish([FLOW]);
    await (await getDb()).query("UPDATE artifacts SET visibility='private' WHERE id=$1", [id]);
    // Queued while public, harvested once private: nothing is drawn or stored.
    expect(await runNextMermaidHarvest()).toBe(true);
    expect(calls).toHaveLength(0);
    expect((await jobs(id))[0].state).toBe('superseded');
    await (await getDb()).query('DELETE FROM mermaid_harvests');
    expect(island(await (await serveArtifact(request(`/a/${id}/raw`, { token: owner.token, headers: { 'user-agent': MAC_CHROME } }), params({ id }))).text()).mermaidImages).toBeUndefined();
    // …and reading it queues nothing either.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await jobs(id)).toEqual([]);
  });

  it('never stores a drawing that differs between loads, carries a script, or is of an excluded kind', async () => {
    const { browser } = drawingBrowser([FLOW, SEQ, GANTT], { vary: FLOW, unsafe: SEQ });
    setServices({ browser });
    const { id } = await publish([FLOW, SEQ, GANTT]);
    await runNextMermaidHarvest();
    expect((await jobs(id))[0].state).toBe('done');
    expect(island(await raw(id)).mermaidImages).toBeUndefined();
    expect(Number((await (await getDb()).query<{ n: string }>('SELECT count(*) AS n FROM mermaid_images')).rows[0].n)).toBe(0);
  });

  it('harvests only the head: a version already replaced is superseded, and the new head is harvested', async () => {
    const { browser } = drawingBrowser([SEQ]);
    setServices({ browser });
    const { owner, id } = await publish([FLOW]);
    const row = (await getArtifactById(id))!;
    const replaced = await replaceRoute(request(`/api/artifacts/${id}`, { method: 'PUT', token: owner.token, json: documentEditBody(row, { source: markup([SEQ]), whole: true }) }), params({ id }));
    expect(replaced.status, await replaced.clone().text()).toBe(200);
    while (await runNextMermaidHarvest());
    expect((await jobs(id)).map((j) => [j.version, j.state])).toEqual([[1, 'superseded'], [2, 'done']]);
    expect(Object.keys(island(await raw(id)).mermaidImages!)).toContain(mermaidImageKey(SEQ, 'light'));
  });

  it('a reader of a head nobody queued queues it (the backstop for every write path and for older documents)', async () => {
    setServices({ browser: drawingBrowser([FLOW]).browser });
    const { id } = await publish([FLOW]);
    await (await getDb()).query('DELETE FROM mermaid_harvests');
    await raw(id);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await jobs(id)).toEqual([expect.objectContaining({ version: 1, state: 'pending' })]);
  });

  it('serves no drawing made by another engine (a Mermaid upgrade makes every older drawing invisible)', async () => {
    setServices({ browser: drawingBrowser([FLOW]).browser });
    const { id } = await publish([FLOW]);
    await runNextMermaidHarvest();
    expect(island(await raw(id)).mermaidImages).toBeDefined();
    await (await getDb()).query("UPDATE mermaid_images SET engine='mermaid@11.0.0+kit1'");
    expect(island(await raw(id)).mermaidImages).toBeUndefined();
    expect(MERMAID_RENDER_ENGINE).not.toBe('mermaid@11.0.0+kit1');
  });

  it('serves a reader whose browser cannot measure as the harvest did no stored drawing: no image, no image preload, the engine\'s code named', async () => {
    setServices({ browser: drawingBrowser([FLOW]).browser });
    const { id } = await publish([FLOW]);
    await runNextMermaidHarvest();
    // The reader the harvest measured like: the drawing, preloaded, and no engine code.
    const mac = await raw(id);
    const src = island(mac).mermaidImages![mermaidImageKey(FLOW, 'light')]!.src;
    expect(head(mac)).toContain(`<link rel="preload" href="${src}" as="image">`);
    expect(head(mac)).not.toMatch(/mermaid-render-/);
    for (const ua of [LINUX_CHROME, MAC_SAFARI, '']) {
      // The served document: nothing stored in it, the engine's chunks preloaded — the decision and its preloads agree.
      const html = await raw(id, '', ua);
      expect(island(html).mermaidImages, ua).toBeUndefined();
      expect(html, ua).not.toContain('/assets/mermaid/');
      expect(head(html), ua).toMatch(/modulepreload" href="[^"]*mermaid-render-/);
      // The app's reader: the same decision, on its own surface.
      const page = await artifactPageAnswer(reader(`/a/${id}`, ua, { accept: 'text/html' }), id);
      expect((page.body as { surface: { runtime: { data: Record<string, unknown> } } }).surface.runtime.data.mermaidImages, ua).toBeUndefined();
      expect(page.story!.html(), ua).not.toContain('/assets/mermaid/');
      expect(page.story!.lazyCode, ua).toEqual(expect.objectContaining({ mermaid: ['flowchart'], mermaidImages: [] }));
    }
    const macPage = await artifactPageAnswer(reader(`/a/${id}`, MAC_CHROME, { accept: 'text/html' }), id);
    expect(macPage.story!.lazyCode).toEqual(expect.objectContaining({ mermaid: [], mermaidImages: [expect.stringMatching(/^\/assets\/mermaid\//)] }));
  });

  it('never stores a drawing drawn in a system font, or one whose faces were not measured: no reader could be judged against it', async () => {
    setServices({ browser: drawingBrowser([FLOW, SEQ, PIE], { system: FLOW, unmeasured: SEQ }).browser });
    const { id } = await publish([FLOW, SEQ, PIE]);
    await runNextMermaidHarvest();
    expect((await jobs(id))[0].state).toBe('done');
    const images = island(await raw(id)).mermaidImages!;
    expect(Object.keys(images).sort()).toEqual([mermaidImageKey(PIE, 'light'), mermaidImageKey(PIE, 'dark')].sort());
    expect(Number((await (await getDb()).query<{ n: string }>('SELECT count(*) AS n FROM mermaid_images')).rows[0].n)).toBe(4);
  });

  it('honours the capture colour only under a valid export key', async () => {
    const { id } = await publish([FLOW]);
    expect(island(await raw(id, '?color=dark')).mermaidImages).toBeUndefined();
    expect(await raw(id, '?color=dark')).not.toMatch(/<html[^>]*class="[^"]*\bdark\b/);
    const { mintExportKey } = await import('@/lib/export-key');
    expect(await raw(id, `?chrome=0&key=${mintExportKey(id)}&color=dark`)).toMatch(/<html[^>]*class="[^"]*\bdark\b/);
  });
});

describe('the backfill', () => {
  it('queues every live head that draws Mermaid and has no harvest, once, and can give failed harvests another go', async () => {
    setServices({ browser: drawingBrowser([FLOW]).browser });
    const a = await publish([FLOW]);
    const b = await publish([SEQ]);
    const prose = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: (await mintToken('prose')).token, json: { markup: '<p>No diagram</p>', visibility: 'public' } }));
    expect(prose.status).toBe(201);
    const db = await getDb();
    await db.query('DELETE FROM mermaid_harvests');
    expect(await queueMermaidBackfill(db, { dryRun: true })).toEqual({ queued: 2, retried: 0 });
    expect(await jobs(a.id)).toEqual([]);
    expect(await queueMermaidBackfill(db)).toEqual({ queued: 2, retried: 0 });
    expect(await queueMermaidBackfill(db)).toEqual({ queued: 0, retried: 0 });
    await db.query("UPDATE mermaid_harvests SET state='failed', attempts=6 WHERE artifact_id=$1", [b.id]);
    expect(await queueMermaidBackfill(db, { retryFailed: true })).toEqual({ queued: 0, retried: 1 });
    expect(await jobs(b.id)).toEqual([expect.objectContaining({ state: 'pending', attempts: 0 })]);
  });
});

describe('when the browser is down or slow', () => {
  it('publishing neither waits nor fails, the job waits for a browser without counting it a failure, and readers keep the engine', async () => {
    setServices({ browser: drawingBrowser([FLOW], { down: true }).browser });
    const { id } = await publish([FLOW]);
    expect(await runNextMermaidHarvest()).toBe(true);
    const [job] = await jobs(id);
    // An outage (or an older browser without the operation) never uses up a version's attempts.
    expect(job).toEqual(expect.objectContaining({ state: 'pending', attempts: 0 }));
    expect(job.retry_after).not.toBeNull();
    // Backing off: not due again yet.
    expect(await runNextMermaidHarvest()).toBe(false);
    expect(head(await raw(id))).toMatch(/mermaid-render-/);
  });

  it('a harvest that hangs never delays a publish', async () => {
    let release!: () => void;
    const hung = new Promise<SvgHarvestResult>((resolve) => { release = () => resolve({ ok: false, reason: 'unavailable' }); });
    setServices({ browser: { render: async () => ({ ok: false, reason: 'unavailable' }), harvestSvg: () => hung } });
    const stop = startMermaidHarvester({ intervalMs: 50 });
    try {
      await publish([FLOW]);
      // The harvester has claimed the first job and is stuck in the browser.
      await new Promise((resolve) => setTimeout(resolve, 100));
      const started = performance.now();
      const { id } = await publish([SEQ]);
      expect(performance.now() - started).toBeLessThan(2000);
      expect(head(await raw(id))).toMatch(/mermaid-render-/);
    } finally {
      release();
      await stop();
    }
  });
});
