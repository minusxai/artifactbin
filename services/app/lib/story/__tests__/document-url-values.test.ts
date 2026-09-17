/**
 * F2 — ONE DATAFLOW OBJECT, TWO CONSUMERS.
 *
 * The reader's `?$region=west` is parsed on the SERVER and put on the island
 * dataflow's third field. `buildStoryDocument` then hands the SAME object to
 * the SSR render and to the JSON island, which is the entire reason the
 * control the server paints and the store the client hydrates cannot disagree
 * — a disagreement here is React #418, and #418 discards the whole server tree
 * and re-renders the root, so the reader would watch the document repaint.
 *
 * The `<select>` is deliberately bound to an INLINE table: those rows travel
 * with the declarations, so the options exist with nothing run — this is
 * paint-first's own path, with the reader's choice already on it.
 */
import { describe, expect, it } from 'vitest';
import { buildStoryDocument } from '@/lib/story/document';
import { declarationsOf } from '@/lib/artifacts';
import { STORY_ISLAND_ID } from '@/lib/story-runtime/contract';
import type { StoryIslandData } from '@/lib/story-runtime/contract';
import type { Scalar } from '@/lib/story/dataflow';

const SOURCE = `<Helmet><Value name="region" type="string" default="north" />
<Value name="regions" type="table" value={[{"region":"north"},{"region":"west"}]} />
</Helmet><div><select aria-label="Region" value="$region" options="$regions" /></div>`;

const build = (values?: Record<string, Scalar>): Promise<string> => {
  const flow = declarationsOf(SOURCE)!;
  return buildStoryDocument({
    source: SOURCE,
    compiledCss: '',
    theme: null,
    colorMode: null,
    refData: {},
    title: 'Regions',
    runtimeSrc: '/story-runtime.js',
    dataflow: { flow, ...(values ? { values } : {}) },
  });
};

/** The JSON island as the entry parses it. */
const island = (html: string): StoryIslandData => {
  const open = html.indexOf(`id="${STORY_ISLAND_ID}"`);
  const start = html.indexOf('>', open) + 1;
  return JSON.parse(html.slice(start, html.indexOf('</script>', start))) as StoryIslandData;
};

describe('a document served with URL-carried values', () => {
  it('renders the bound control at the reader\'s value, not the declared default', async () => {
    const html = await build({ region: 'west' });
    expect(html).toContain('<option value="west" selected="">west</option>');
    expect(html).not.toContain('<option value="north" selected="">');
  });

  it('carries the SAME values on the island, so hydration finds what SSR painted', async () => {
    const html = await build({ region: 'west' });
    expect(island(html).dataflow?.values).toEqual({ region: 'west' });
    // And no rows: a URL selection is not a reason to abandon paint-first.
    expect(island(html).dataflow?.state).toBeUndefined();
  });

  it('paints the declared default when the link says nothing', async () => {
    const html = await build();
    expect(html).toContain('<option value="north" selected="">north</option>');
    expect(island(html).dataflow?.values).toBeUndefined();
  });
});
