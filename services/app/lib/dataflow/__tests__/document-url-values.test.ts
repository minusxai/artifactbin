/** A URL selection paints the compiled control and seeds its data island with the same value. */
import { describe, expect, it } from 'vitest';
import { compiledDocument } from '@/lib/compiled-page/__tests__/document-helper';
import { ISLAND_DATA_ID } from '@/lib/compiled-page/contract';
import { compiledSource } from '@/test/helpers/compiled';
import type { Scalar } from '@/lib/dataflow/dataflow';

const SOURCE = `<Helmet><Value name="region" type="string" default="north" />
<Value name="regions" type="table" value={[{"region":"north"},{"region":"west"}]} />
</Helmet><div><select aria-label="Region" value="$region" options="$regions" /></div>`;
const FLOW = await compiledSource(SOURCE);
const build = (values: Record<string, Scalar> = {}) => compiledDocument({
  source: SOURCE, compiledCss: null, theme: null, colorMode: 'light', refData: {}, title: 'Regions',
  dataflow: { flow: FLOW }, overlay: { values, mermaidImages: {}, signedIn: false, doors: null },
});
const island = (html: string): Record<string, unknown> | null => {
  const open = html.indexOf(`id="${ISLAND_DATA_ID}"`);
  if (open < 0) return null;
  const start = html.indexOf('>', open) + 1;
  return JSON.parse(html.slice(start, html.indexOf('</script>', start))) as Record<string, unknown>;
};

describe('a compiled document served with URL-carried values', () => {
  it('renders the bound control at the reader\'s value, not the declared default', async () => {
    const html = await build({ region: 'west' });
    expect(html).toMatch(/<option[^>]*value="west" selected(?:="")?>west<\/option>/);
    expect(html).not.toMatch(/<option[^>]*value="north" selected(?:="")?>/);
  });

  it('carries the same values on the island with no result rows', async () => {
    const data = island(await build({ region: 'west' }));
    expect(data?.values).toEqual({ region: 'west' });
    expect(data?.results).toBeNull();
  });

  it('paints the declared default when the link says nothing', async () => {
    const html = await build();
    expect(html).toMatch(/<option[^>]*value="north" selected(?:="")?>north<\/option>/);
    expect(island(html)?.values).toEqual({});
  });
});
