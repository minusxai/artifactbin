import {nativeHtml} from './native-html-fixture';
/**
 * A shared link must unfurl, and the og: tags have to be on the DOCUMENT.
 *
 * `/a/<id>/raw` serves the document itself, so cards that lived only on the app
 * shell would leave a pasted link unfurling as a bare URL in every chat app —
 * the single most common thing that happens to one of these links.
 *
 * Crawlers do not run JavaScript, so this has to be in the SERVED HTML.
 */
import { flushViews } from '@/lib/platform/analytics';
import { describe, expect, it } from 'vitest';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { createArtifact } from '@/lib/artifacts';

import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { mintExportKey, PUBLIC_BASE_URL } from '@/lib/platform';
import { useAppHarness } from '@/__tests__/harness';

const harness = useAppHarness();

/** Rows the analytics table holds for this artifact's `view` event. */
const views = async (id: string): Promise<number> => {
  const db = await harness.db();
  const r = await db.query<{ n: string }>(
    "SELECT COUNT(*)::text AS n FROM analytics_events WHERE artifact_id = $1 AND event = 'view'", [id],
  );
  return Number(r.rows[0].n);
};

const BASE = 'http://localhost:3000';

const serve = async (id: string, query = '') => {
  const res = await rawRoute(new Request(`${BASE}/a/${id}/raw${query}`), { params: Promise.resolve({ id }) });
  return res.text();
};

const publish = async (source: string, title: string | null) => {
  const t = await mintToken('t');
  return createArtifact(t.id, t.userId, { visibility: 'public', format: 'html', source:source.startsWith('<!doctype')?source:nativeHtml(source), meta: {}, title, description: 'A summary' });
};

describe('the served document unfurls on its own', () => {
  it('carries og:title, og:description and the card image', async () => {
    const row = await publish('<h1>Q3 Revenue</h1>', 'Q3 Revenue');
    const html = await serve(row.id);
    expect(html).toContain('property="og:title" content="Q3 Revenue"');
    expect(html).toContain('property="og:description" content="A summary"');
    // ABSOLUTE: this document IS the page a crawler fetches, and a relative
    // og:image is resolved by some scrapers against the page URL and by others
    // not at all. The route knows the public origin from the forwarding
    // headers, so there is no reason to make anyone guess.
    expect(html).toContain(`property="og:image" content="${PUBLIC_BASE_URL}/a/${row.id}/export?mode=card&amp;v=${row.version}&amp;r=3"`);
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });

  it('does not attach retired declared-value parameters to native social cards',async()=>{
    const row=await publish('<h1>Regions</h1>','Regions');const html=await serve(row.id,'?$region=EU&$junk=1');
    const image=html.match(/property="og:image" content="([^"]*)"/)![1]!;expect(image).not.toContain('$region');expect(image).not.toContain('$junk');
  });

  it('follows the native HTML title when the stored row has no title', async () => {
    const row = await publish('<!doctype html><html><head><title>Named By Heading</title></head><body><h1>Named By Heading</h1></body></html>', null);
    expect(await serve(row.id)).toContain('property="og:title" content="Named By Heading"');
  });

  it('preserves the authored capture body without injecting reader chrome', async () => {
    const row = await publish('<h1>Q3</h1>', 'Q3');
    const html=await serve(row.id, `?chrome=0&key=${mintExportKey(row.id)}`);expect(html).toMatch(/<h1[^>]*>Q3<\/h1>/);expect(html).not.toContain('data-mx-document-frame');expect(html).not.toContain('data-mx-domain-footer');
  });
});

describe('a view is counted once, where the document is actually served', () => {
  it('counts the reader path, which no longer touches the page', async () => {
    const row = await publish('<h1>Counted</h1>', 'Counted');
    await serve(row.id);
    await flushViews(); // served views are batched (lib/platform/analytics recordView)
    expect(await views(row.id)).toBe(1);
  });

  it('does NOT count the exporter photographing the document', async () => {
    const row = await publish('<h1>Shot</h1>', 'Shot');
    await serve(row.id, `?chrome=0&key=${mintExportKey(row.id)}`);
    await flushViews();
    expect(await views(row.id)).toBe(0);
  });
});
