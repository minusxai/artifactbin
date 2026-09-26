/**
 * Shipped registry recipes in a document: `<Question viz={{"kind":"recipe",
 * "recipe":"minusx/trend@1", …}}>` — the recipe LIBRARY the platform ships
 * (lib/viz/viz-templates), reachable without publishing a viz artifact. The
 * publish door validates the bindings against the template's declared slots
 * and the query's REAL result columns, exactly as `ref:` recipes are checked;
 * an unknown id is refused naming the shipped set, never published to render
 * a fallback.
 */
import { describe, expect, it } from 'vitest';
import { checkDocumentData } from '../data-checks';
import type {DatasetColumn} from '../dataset-shape';
import type { RefLoader } from '../refs';

const DS = 'abc123';
const columns:DatasetColumn[]=[
        { name: 'day', type: 'date' },
        { name: 'revenue', type: 'number' },
        { name: 'region', type: 'string' },
      ];
const load: RefLoader = async (id) =>
  id === DS
    ? {
      id: DS,
      format: 'dataset',
      columns,
    }
    : null;

const doc = (viz: string) =>
  '<Helmet>' +
  `<Import name="trend_data" src="ref:${DS}" /><Query name="trend">{\`select day as period, sum(revenue) as revenue from trend_data.rows group by 1 order by 1\`}</Query>` +
  '</Helmet>' +
  `<Question data="$trend" viz={${viz}} height="300px" />`;

describe('shipped registry recipes at the publish door', () => {
  it('refuses an array on a single-column slot at publish, not at render — agents write "value":["col"] for single-value', async () => {
    const bad = await checkDocumentData(doc('{"kind":"recipe","recipe":"minusx/single-value@1","bindings":{"value":["revenue"]}}'), load);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.details.join('\n')).toMatch(/slot "value" takes a single column, not an array — write "value": "revenue"/);
    const good = await checkDocumentData(doc('{"kind":"recipe","recipe":"minusx/single-value@1","bindings":{"value":"revenue"}}'), load);
    expect(good.ok).toBe(true);
  });
  it('accepts a well-bound shipped recipe', async () => {
    const r = await checkDocumentData(
      doc('{"kind":"recipe","recipe":"minusx/trend@1","bindings":{"date":"period","value":["revenue"]}}'),
      load,
    );
    expect(r).toMatchObject({ ok: true, refs: [{ id: DS, kind: 'dataset' }] });
  });

  it('names an unbound slot', async () => {
    const r = await checkDocumentData(
      doc('{"kind":"recipe","recipe":"minusx/trend@1","bindings":{"date":"period"}}'),
      load,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.details.join('\n')).toContain('"value" is not bound');
  });

  it('names a wrong-kind binding against the query result columns', async () => {
    const r = await checkDocumentData(
      doc('{"kind":"recipe","recipe":"minusx/trend@1","bindings":{"date":"period","value":["period"]}}'),
      load,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.details.join('\n')).toMatch(/accepts quantitative.*"period" is temporal/);
  });

  it('judges no binding by a type the compiler cannot tell: a filtered aggregate no sample row reaches', async () => {
    const filtered = '<Helmet>' +
      `<Import name="trend_data" src="ref:${DS}" /><Query name="trend">{\`select day as period, sum(revenue) as revenue from trend_data.rows where region = 'north' group by 1 order by 1\`}</Query>` +
      '</Helmet><Question data="$trend" viz={{"kind":"recipe","recipe":"minusx/trend@1","bindings":{"date":"period","value":["revenue"]}}} height="300px" />';
    expect(await checkDocumentData(filtered, load)).toMatchObject({ ok: true });
  });

  it('refuses an unknown shipped id, naming the shipped set', async () => {
    const r = await checkDocumentData(
      doc('{"kind":"recipe","recipe":"minusx/nope@1","bindings":{"date":"period","value":["revenue"]}}'),
      load,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.details.join('\n')).toContain('minusx/nope@1');
      expect(r.details.join('\n')).toContain('minusx/trend@1');
    }
  });
});
