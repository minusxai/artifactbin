/**
 * The dataflow contract (lib/story/dataflow.ts): how `<Value>` / `<Query>`
 * are parsed, how `$name` references are collected, and every publish-time
 * rule over the graph. Pure — no engine, no DB.
 */
import { describe, expect, it } from 'vitest';
import { parseJsx, type JsxElement, type JsxNode } from '@/lib/jsx';
import {
  coerceScalarInput, collectRefNameUses, datasetRefsInDataflow, datasetRefsInSql, initialValues, parseQueryDecl, parseValueDecl,
  queriesDependingOn, queryDeps, queryOrder, refName, sqlParams, validateDataflow,
  type Dataflow, type QueryDecl, type ValueDecl,
} from '@/lib/story/dataflow';

const nodes = (source: string): JsxNode[] => {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(`test source failed to parse: ${parsed.error}`);
  return parsed.nodes;
};
const el = (source: string): JsxElement => nodes(source)[0] as JsxElement;

const value = (source: string): ValueDecl => {
  const r = parseValueDecl(el(source));
  if (!r.ok) throw new Error(`expected a Value decl, got ${JSON.stringify(r.errors)}`);
  return r.decl;
};
const valueErrors = (source: string): string[] => {
  const r = parseValueDecl(el(source));
  return r.ok ? [] : r.errors.map((e) => e.message);
};
const query = (source: string): QueryDecl => {
  const r = parseQueryDecl(el(source));
  if (!r.ok) throw new Error(`expected a Query decl, got ${JSON.stringify(r.errors)}`);
  return r.decl;
};
const queryErrors = (source: string): string[] => {
  const r = parseQueryDecl(el(source));
  return r.ok ? [] : r.errors.map((e) => e.message);
};

const flow = (values: ValueDecl[], queries: QueryDecl[]): Dataflow => ({ values, queries });

describe('refName', () => {
  it('matches a whole-attribute reference only', () => {
    expect(refName('$sales')).toBe('sales');
    expect(refName('$_x1')).toBe('_x1');
    expect(refName('$,.0f')).toBeNull();     // d3-format
    expect(refName('$5')).toBeNull();        // a price
    expect(refName('$sales rows')).toBeNull();
    expect(refName(' $sales')).toBeNull();
    expect(refName('sales')).toBeNull();
    expect(refName(5)).toBeNull();
  });
});

describe('coerceScalarInput', () => {
  it('coerces by declared type; the empty string is always null', () => {
    expect(coerceScalarInput('number', '2500')).toBe(2500);
    expect(coerceScalarInput('number', 'oops')).toBeNull();
    expect(coerceScalarInput('boolean', 'true')).toBe(true);
    expect(coerceScalarInput('boolean', 'false')).toBe(false);
    expect(coerceScalarInput('string', 'EU')).toBe('EU');
    expect(coerceScalarInput('date', '2026-03-01')).toBe('2026-03-01');
    expect(coerceScalarInput(undefined, 'x')).toBe('x');
    expect(coerceScalarInput('number', '')).toBeNull();
    expect(coerceScalarInput('string', '')).toBeNull();
  });
});

describe('parseValueDecl', () => {
  it('parses a scalar with a default', () => {
    expect(value('<Value name="min_rev" type="number" default={1000} />')).toMatchObject({
      kind: 'scalar', name: 'min_rev', type: 'number', default: 1000,
    });
  });

  it('defaults type to string and default to null', () => {
    expect(value('<Value name="region" />')).toMatchObject({ kind: 'scalar', type: 'string', default: null });
  });

  it('parses boolean and date scalars', () => {
    expect(value('<Value name="on" type="boolean" default={true} />')).toMatchObject({ type: 'boolean', default: true });
    expect(value('<Value name="since" type="date" default="2024-01-01" />')).toMatchObject({ type: 'date', default: '2024-01-01' });
  });

  it('carries the element span', () => {
    const src = '<Value name="a" />';
    expect(value(src)).toMatchObject({ start: 0, end: src.length });
  });

  it('parses an inline table with inferred columns', () => {
    const d = value('<Value name="tiny" type="table" value={[{"name":"John","age":34},{"name":"Mary","age":60}]} />');
    expect(d.kind).toBe('table');
    if (d.kind !== 'table') return;
    expect(d.rows).toHaveLength(2);
    expect(d.columns).toEqual([{ name: 'name', type: 'string' }, { name: 'age', type: 'number' }]);
  });

  it('lets declared columns win over inference for a table', () => {
    const d = value('<Value name="t" type="table" value={[{"id":"1"}]} columns={[{"name":"id","type":"string"}]} />');
    if (d.kind !== 'table') throw new Error('table expected');
    expect(d.columns).toEqual([{ name: 'id', type: 'string' }]);
  });

  it('rejects a missing or malformed name', () => {
    expect(valueErrors('<Value type="string" />').join()).toMatch(/name/);
    expect(valueErrors('<Value name="my-value" />').join()).toMatch(/identifier/i);
    expect(valueErrors('<Value name="ref_abc123" />').join()).toMatch(/ref_/);
  });

  it('rejects an unknown type, naming the allowed set', () => {
    const msg = valueErrors('<Value name="x" type="integer" />').join();
    expect(msg).toMatch(/type/);
    expect(msg).toContain('number');
    expect(msg).toContain('table');
  });

  it('rejects a default that does not match the type', () => {
    expect(valueErrors('<Value name="x" type="number" default="lots" />').join()).toMatch(/default/);
    expect(valueErrors('<Value name="x" type="boolean" default="yes" />').join()).toMatch(/default/);
    expect(valueErrors('<Value name="x" type="date" default="tomorrow" />').join()).toMatch(/default/);
    expect(valueErrors('<Value name="x" type="string" default={3} />').join()).toMatch(/default/);
  });

  it('rejects an unknown attribute by name', () => {
    expect(valueErrors('<Value name="x" label="Region" />').join()).toMatch(/label/);
  });

  it('requires table rows for and only for type table', () => {
    expect(valueErrors('<Value name="t" type="table" />').join()).toMatch(/value/);
    expect(valueErrors('<Value name="t" type="table" value={[]} />').join()).toMatch(/non-empty|empty/i);
    expect(valueErrors('<Value name="t" type="table" value={[1,2]} />').join()).toMatch(/flat objects|object/i);
    expect(valueErrors('<Value name="t" type="table" value={[{"a":{"b":1}}]} />').join()).toMatch(/nested|flat/i);
    expect(valueErrors('<Value name="s" type="string" value={[{"a":1}]} />').join()).toMatch(/value.*table|table.*value/i);
    expect(valueErrors('<Value name="t" type="table" value={[{"a":1}]} default={1} />').join()).toMatch(/default/);
  });

  it('rejects a non-static attribute', () => {
    expect(valueErrors('<Value name="x" default={foo()} />').join()).toMatch(/literal|static/i);
  });
});

describe('parseQueryDecl', () => {
  it('parses name, sql, params and dataset refs', () => {
    const q = query('<Query name="sales">{`select region, sum(revenue) r from ref_abc123 where ($region is null or region = $region) and revenue >= $min_rev group by 1`}</Query>');
    expect(q.name).toBe('sales');
    expect(q.sql).toContain('sum(revenue)');
    expect(q.params).toEqual(['region', 'min_rev']);
    expect(q.refs).toEqual(['abc123']);
  });

  it('requires name as the only attribute', () => {
    expect(queryErrors('<Query>{`select 1`}</Query>').join()).toMatch(/name/);
    expect(queryErrors('<Query name="q" sql="select 1" />').join()).toMatch(/sql/);
    expect(queryErrors('<Query name="bad name">{`select 1`}</Query>').join()).toMatch(/identifier/i);
    expect(queryErrors('<Query name="ref_abcdef">{`select 1`}</Query>').join()).toMatch(/ref_/);
  });

  it('requires a single template-literal child with SQL in it', () => {
    expect(queryErrors('<Query name="q">select 1</Query>').join()).toMatch(/template-literal/i);
    expect(queryErrors('<Query name="q" />').join()).toMatch(/template-literal|empty/i);
    expect(queryErrors('<Query name="q">{`   `}</Query>').join()).toMatch(/empty/i);
    expect(queryErrors('<Query name="q">{`select 1`}<b>x</b></Query>').join()).toMatch(/template-literal|single/i);
  });
});

describe('sql text helpers', () => {
  it('sqlParams finds $names once each, skipping $$ quoting, positional $1 and a $ glued to a word', () => {
    expect(sqlParams("select $a, $b, $a, $$lit$$, $1, 'x$c' from t")).toEqual(['a', 'b']);
    // Text-level on purpose: a `$name` inside a string literal still counts (the
    // engine binder is the authority; this only over-reports, never under).
    expect(sqlParams("select 'hello $who'")).toEqual(['who']);
  });

  it('datasetRefsInSql finds ref_<id> tables once each', () => {
    expect(datasetRefsInSql('select * from ref_abc123 a join ref_XYZ789 b using (k), ref_abc123 c')).toEqual(['abc123', 'XYZ789']);
    expect(datasetRefsInSql('select * from schema.ref_abc123')).toEqual([]);
    expect(datasetRefsInSql('select * from prefref_abc123')).toEqual([]);
    expect(datasetRefsInSql('select * from ref_ab')).toEqual([]); // too short to be an id
  });

  it('queryDeps finds declared table names used as bare identifiers', () => {
    expect(queryDeps('select * from sales s join regions r on s.region = r.region', ['sales', 'regions', 'other'])).toEqual(['sales', 'regions']);
    expect(queryDeps('select $sales from t', ['sales'])).toEqual([]);      // a param, not a table
    expect(queryDeps('select * from sales_2024', ['sales'])).toEqual([]);   // longer identifier
    expect(queryDeps('select * from x.sales', ['sales'])).toEqual([]);      // schema-qualified
  });
});

const REGION = value('<Value name="region" type="string" />');
const MIN = value('<Value name="min_rev" type="number" default={0} />');
const TINY = value('<Value name="tiny" type="table" value={[{"a":1}]} />');
const SALES = query('<Query name="sales">{`select * from ref_abc123 where region = $region and revenue >= $min_rev`}</Query>');
const TOP = query('<Query name="top">{`select * from sales order by revenue desc limit 5`}</Query>');

describe('collectRefNameUses', () => {
  it('collects references from the allowed positions only', () => {
    const body = nodes(
      '<div>' +
      '<Question data="$sales" viz={{"kind":"table"}} />' +
      '<Number data="$sales" col="revenue" agg="sum" prefix="$" format="$,.0f" />' +
      '<DataTable data="$top" />' +
      '<select value="$region" options="$regions" />' +
      '<input value="$min_rev" type="range" />' +
      '<input type="checkbox" checked="$flag" />' +
      '<textarea value="$note" />' +
      '<Select value="$region" options="$regions" />' +
      '<Slider value="$min_rev" min={0} max={100} />' +
      '<DatePicker value="$since" />' +
      '<Segmented value="$grain" options="$grains" />' +
      '<Switch checked="$dark" />' +
      '<p title="$literal">$sales</p>' +
      '<Badge data="$sales" />' +
      '</div>',
    );
    const uses = collectRefNameUses(body).map((u) => `${u.tag}.${u.attr}=${u.name}:${u.expects}`);
    expect(uses).toEqual([
      'Question.data=sales:table',
      'Number.data=sales:table',
      'DataTable.data=top:table',
      'select.value=region:scalar',
      'select.options=regions:table',
      'input.value=min_rev:scalar',
      'input.checked=flag:scalar',
      'textarea.value=note:scalar',
      'Select.value=region:scalar',
      'Select.options=regions:table',
      'Slider.value=min_rev:scalar',
      'DatePicker.value=since:scalar',
      'Segmented.value=grain:scalar',
      'Segmented.options=grains:table',
      'Switch.checked=dark:scalar',
    ]);
  });

  it('records the attribute span for diagnostics', () => {
    const src = '<Question data="$sales" />';
    const [use] = collectRefNameUses(nodes(src));
    expect(src.slice(use.start, use.end)).toBe('data="$sales"');
  });
});

describe('validateDataflow', () => {
  const uses = (src: string) => collectRefNameUses(nodes(src));

  it('accepts a consistent document', () => {
    expect(validateDataflow(flow([REGION, MIN, TINY], [SALES, TOP]), uses(
      '<select value="$region" options="$sales" /><Question data="$top" /><DataTable data="$tiny" />',
    ))).toEqual([]);
  });

  it('rejects a duplicate name across Values and Queries', () => {
    const dup = query('<Query name="region">{`select 1`}</Query>');
    const errors = validateDataflow(flow([REGION], [dup]), []);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/"region".*(twice|already)/i);
    expect(errors[0].start).toBe(dup.start);
  });

  it('rejects a reference to nothing declared, naming the token', () => {
    const errors = validateDataflow(flow([REGION, MIN], [SALES]), uses('<Question data="$sale" />'));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('$sale');
    expect(errors[0].message).toMatch(/declared|Helmet/);
    expect(errors[0].attr).toBe('data');
  });

  it('rejects a reference of the wrong kind', () => {
    const e1 = validateDataflow(flow([REGION, MIN], [SALES]), uses('<Question data="$region" />'));
    expect(e1[0].message).toMatch(/table/);
    const e2 = validateDataflow(flow([REGION, MIN], [SALES]), uses('<input value="$sales" />'));
    expect(e2[0].message).toMatch(/scalar|value/i);
  });

  it('rejects a SQL $param that names a table or nothing', () => {
    const q = query('<Query name="q">{`select * from ref_abc123 where a = $sales and b = $nope`}</Query>');
    const errors = validateDataflow(flow([REGION, MIN], [SALES, q]), []);
    const msgs = errors.map((e) => e.message).join('\n');
    expect(msgs).toMatch(/\$sales.*table/);
    expect(msgs).toMatch(/\$nope/);
    expect(errors.every((e) => e.start === q.start)).toBe(true);
  });

  it('rejects a dependency cycle, naming the queries', () => {
    const a = query('<Query name="a">{`select * from b`}</Query>');
    const b = query('<Query name="b">{`select * from a`}</Query>');
    const errors = validateDataflow(flow([], [a, b]), []);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/cycle/i);
    expect(errors[0].message).toContain('a');
    expect(errors[0].message).toContain('b');
  });

  it('rejects a query that reads itself', () => {
    const a = query('<Query name="a">{`select * from a`}</Query>');
    expect(validateDataflow(flow([], [a]), [])[0].message).toMatch(/itself|cycle/i);
  });
});

describe('queryOrder', () => {
  it('orders dependencies first, keeping authored order among ties', () => {
    const c = query('<Query name="c">{`select * from ref_abc123`}</Query>');
    expect(queryOrder(flow([TINY], [TOP, SALES, c]))).toEqual(['sales', 'top', 'c']);
  });

  it('returns null on a cycle', () => {
    const a = query('<Query name="a">{`select * from b`}</Query>');
    const b = query('<Query name="b">{`select * from a`}</Query>');
    expect(queryOrder(flow([], [a, b]))).toBeNull();
  });
});

describe('derived views', () => {
  it('datasetRefsInDataflow dedupes across queries', () => {
    const q2 = query('<Query name="q2">{`select * from ref_abc123 join ref_def456 using (k)`}</Query>');
    expect(datasetRefsInDataflow(flow([], [SALES, q2]))).toEqual(['abc123', 'def456']);
  });

  it('initialValues seeds every scalar at its default', () => {
    expect(initialValues(flow([REGION, MIN, TINY], []))).toEqual({ region: null, min_rev: 0 });
  });

  it('queriesDependingOn names the queries a value change re-runs, transitively', () => {
    expect(queriesDependingOn(flow([REGION, MIN], [SALES, TOP]), ['region'])).toEqual(['sales', 'top']);
    expect(queriesDependingOn(flow([REGION, MIN], [SALES, TOP]), ['nothing'])).toEqual([]);
  });
});
