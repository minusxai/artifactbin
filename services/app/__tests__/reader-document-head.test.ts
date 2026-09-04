/**
 * A shared link must unfurl — and readers no longer reach the PAGE.
 *
 * The page's `generateMetadata` used to be the only source of og:*, which was
 * fine while every viewer got the app shell. A reader is now served the
 * document itself, so a document with no cards of its own would unfurl as a
 * bare URL in every chat app it is pasted into — the single most common thing
 * that happens to one of these links.
 *
 * Crawlers do not run JavaScript, so this has to be in the SERVED HTML.
 */
import { describe, expect, it } from 'vitest';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { createArtifact } from '@/lib/artifacts';

import { mintToken } from '@/lib/tokens';
import { mintExportKey } from '@/lib/export-key';
import { getDb } from '@/lib/db';
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
  return createArtifact(t.id, null, { format: 'markup', content: '', source, meta: {}, title, description: 'A summary' });
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
    expect(html).toContain(`property="og:image" content="${BASE}/a/${row.id}/export?mode=card&amp;v=${row.version}&amp;r=2"`);
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });

  it('follows the document\'s own heading when nothing named it, like the tab does', async () => {
    const row = await publish('<h1>Named By Heading</h1>', null);
    expect(await serve(row.id)).toContain('property="og:title" content="Named By Heading"');
  });

  it('leaves them OUT of a capture render — the exporter is shooting this frame', async () => {
    const row = await publish('<h1>Q3</h1>', 'Q3');
    expect(await serve(row.id, '?chrome=0')).not.toContain('og:image');
  });
});

describe('a view is counted once, where the document is actually served', () => {
  it('counts the reader path, which no longer touches the page', async () => {
    const row = await publish('<h1>Counted</h1>', 'Counted');
    await serve(row.id);
    await new Promise((r) => setTimeout(r, 50)); // trackEvent is fire-and-forget
    expect(await views(row.id)).toBe(1);
  });

  it('does NOT count the exporter photographing the document', async () => {
    const row = await publish('<h1>Shot</h1>', 'Shot');
    await serve(row.id, `?chrome=0&key=${mintExportKey(row.id)}`);
    await new Promise((r) => setTimeout(r, 50));
    expect(await views(row.id)).toBe(0);
  });
});
