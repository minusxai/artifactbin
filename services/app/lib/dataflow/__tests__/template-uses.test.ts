/**
 * Templates read the page: every `{$name}` and `{$query.column}` in a reader-visible string is a use the
 * publish door checks like any binding — declared, of the right kind, and (once the queries compile) a
 * column the query really returns.
 */
import { describe, expect, it } from 'vitest';
import type { DatasetColumn } from '@artifactbin/contracts';
import { parseJsx } from '@/lib/jsx';
import { dataflowOf, splitHelmet } from '@/lib/document/helmet';
import { collectRefNameUses, validateDataflow } from '../dataflow';
import { compileDataflow, prepareCompile, type ImportSource } from '../compile-dataflow';

const SALES: DatasetColumn[] = [{ name: 'region', type: 'string' }, { name: 'revenue', type: 'number' }];
const SOURCES: Record<string, ImportSource> = { Sales0001: { kind: 'dataset', tables: [{ name: 'rows', columns: SALES }] } };
const HELMET = '<Helmet><Import name="sales" src="ref:Sales0001" /><Value name="region" type="string" default="West" /><Query name="tiles">{`select sum(revenue) as cheap_v, $region as label from sales.rows`}</Query></Helmet>';

const parts = (source: string) => {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(parsed.error);
  return splitHelmet(parsed.nodes);
};
const declared = (source: string) => { const { content, body } = parts(source); return { flow: dataflowOf(content), body }; };
const markupErrors = (body: string) => { const { flow, body: nodes } = declared(HELMET + body); return validateDataflow(flow, collectRefNameUses(nodes)).map((e) => e.message); };
const compileErrors = async (body: string) => {
  const { flow, body: nodes } = declared(HELMET + body);
  const result = compileDataflow(flow, { ...(await prepareCompile(flow, async (ref) => SOURCES[ref] ?? null)), now: '2026-10-15T00:00:00.000Z' }, nodes);
  return result.ok ? [] : result.errors.map((e) => e.message);
};

describe('template uses', () => {
  it('collects values and query cells from text, attribute strings and chart specs', () => {
    const { body } = declared(`${HELMET}<h1 title="For {$region}">Cheapest: {$tiles.cheap_v}</h1><Question data="$tiles" viz={{"kind":"vega-lite","spec":{"title":"{$tiles.label}"}}} />`);
    const uses = collectRefNameUses(body).map((u) => [u.name, u.column ?? null, u.expects]);
    expect(uses).toEqual(expect.arrayContaining([['region', null, 'scalar'], ['tiles', 'cheap_v', 'table'], ['tiles', 'label', 'table']]));
  });
  it('never collects a literal: SQL bodies, Mermaid code, a pipe or a call', () => {
    const { body } = declared(`${HELMET}<Mermaid code="graph TD; A[{$nope}]" /><p title="{$nope | $,.0f}">x</p>`);
    expect(collectRefNameUses(body).some((u) => u.name === 'nope')).toBe(false);
  });
  it('names an undeclared value or query, and a cell of something that is not a table', () => {
    expect(markupErrors('<p title="{$nobody}">x</p>').join(' ')).toMatch(/nobody.*refers to nothing declared/);
    expect(markupErrors('<p>{$ghost.col}</p>').join(' ')).toMatch(/ghost.*refers to nothing declared/);
    expect(markupErrors('<p>{$region.col}</p>').join(' ')).toMatch(/needs a table/);
    expect(markupErrors('<p title="{$region}">{$tiles.cheap_v}</p>')).toEqual([]);
  });
  it('fails publish for a column the query does not return, and passes for one it does', async () => {
    expect((await compileErrors('<p>Cheapest: {$tiles.cheap_v}</p><div style="width:{$tiles.cheap_v}%" />'))).toEqual([]);
    const missing = await compileErrors('<p>Cheapest: {$tiles.cheapest}</p>');
    expect(missing.join(' ')).toMatch(/\$tiles has no column cheapest/);
    const inAttribute = await compileErrors('<div title="{$tiles.nope}" />');
    expect(inAttribute.join(' ')).toMatch(/\$tiles has no column nope/);
  });
});
