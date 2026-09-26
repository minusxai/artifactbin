/**
 * The declarations contract (lib/story/dataflow.ts): how `<Import>` /
 * `<Value>` / `<Query>` are parsed, how `$name` references (and `set=` /
 * `args=` maps) are collected, and the publish-time rules over the MARKUP.
 * What the SQL reads is the compiler's (compile-dataflow.test.ts). Pure.
 */
import { describe, expect, it } from 'vitest';
import { type JsxElement, type JsxNode } from '@/lib/jsx';
import {
  bindingMap, coerceScalarInput, collectRefNameUses, parseImportDecl, parseQueryDecl, parseValueDecl, refName, resolveBindings, rowBound, validateDataflow,
  type Dataflow, type ImportDecl, type QueryDecl, type ValueDecl,
} from '@/lib/story/dataflow';
import { parseJsxOrThrow } from '@/test/helpers/jsx';

const nodes = (source: string): JsxNode[] => {
  const parsed = parseJsxOrThrow(source);
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

const flow = (values: ValueDecl[], queries: QueryDecl[], imports: ImportDecl[] = []): Dataflow => ({ imports, values, queries, mutations: [] });

describe('refName', () => {
  it('reads $_me.id, and leaves a row field to the row scope', () => {
    expect(refName('$_me.id')).toBe('_me.id');
    expect(refName('$_row.day')).toBeNull();
    expect(refName('$sales.rows')).toBeNull();
  });

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
  it('parses name, sql and the connected database it runs inside', () => {
    const q = query('<Query name="sales" source="ref:abc123">{`select region, sum(revenue) r from orders where $region is null or region = $region group by 1`}</Query>');
    expect(q.name).toBe('sales');
    expect(q.sql).toContain('sum(revenue)');
    expect(q.source).toBe('abc123');
    expect(query('<Query name="q">{`select 1`}</Query>').source).toBeUndefined();
  });

  it('requires name as the only attribute besides source', () => {
    expect(queryErrors('<Query>{`select 1`}</Query>').join()).toMatch(/name/);
    expect(queryErrors('<Query name="q" sql="select 1" />').join()).toMatch(/sql/);
    expect(queryErrors('<Query name="bad name">{`select 1`}</Query>').join()).toMatch(/identifier/i);
    expect(queryErrors('<Query name="ref_abcdef">{`select 1`}</Query>').join()).toMatch(/ref_/);
    expect(queryErrors('<Query name="a__b">{`select 1`}</Query>').join()).toMatch(/double underscore/);
    expect(queryErrors('<Query name="q" source="abc123">{`select 1`}</Query>').join()).toMatch(/source="ref:abc123"/);
  });

  it('requires a single template-literal child with SQL in it', () => {
    expect(queryErrors('<Query name="q">select 1</Query>').join()).toMatch(/template-literal/i);
    expect(queryErrors('<Query name="q" />').join()).toMatch(/template-literal|empty/i);
    expect(queryErrors('<Query name="q">{`   `}</Query>').join()).toMatch(/empty/i);
    expect(queryErrors('<Query name="q">{`select 1`}<b>x</b></Query>').join()).toMatch(/template-literal|single/i);
  });
});

describe('parseImportDecl', () => {
  const imported = (source: string) => parseImportDecl(el(source));
  it('parses a name and a literal ref', () => {
    const r = imported('<Import name="bookings" src="ref:BookRows1" />');
    expect(r.ok && r.decl).toMatchObject({ name: 'bookings', ref: 'BookRows1' });
  });
  it('refuses anything but name and src, children, a missing src, and a reserved name', () => {
    const messages = (source: string) => { const r = imported(source); return r.ok ? [] : r.errors.map((e) => e.message); };
    expect(messages('<Import name="b" src="ref:abc123" as="x" />').join()).toMatch(/only name= and src=/);
    expect(messages('<Import name="b" />').join()).toMatch(/needs src="ref:<id>"/);
    expect(messages('<Import name="b" src="abc123" />').join()).toMatch(/src="ref:abc123"/);
    expect(messages('<Import name="_me" src="ref:abc123" />').join()).toMatch(/reserved/);
    expect(messages('<Import name="b" src="ref:abc123">x</Import>').join()).toMatch(/no children/);
  });
});

describe('set= and args= maps', () => {
  it('reads references, row fields and literals, and refuses anything else', () => {
    expect(bindingMap({ day: '$_row.day', note: '$note', n: 3, flag: true, none: null, price: '$5' })).toEqual({
      day: { ref: '_row.day' }, note: { ref: 'note' }, n: { literal: 3 }, flag: { literal: true }, none: { literal: null }, price: { literal: '$5' },
    });
    expect(bindingMap({ day: { nested: 1 } })).toBeNull();
    expect(bindingMap({ 'bad key': 1 })).toBeNull();
    expect(bindingMap(['$a'])).toBeNull();
  });
  it('reads row fields into literals inside a row, and resolves the rest now', () => {
    const map = rowBound(bindingMap({ day: '$_row.day', note: '$note' })!, { day: '$not-a-ref' });
    expect(map).toEqual({ day: { literal: '$not-a-ref' }, note: { ref: 'note' } });
    expect(resolveBindings(map, (ref) => (ref === 'note' ? 'hi' : undefined))).toEqual({ day: '$not-a-ref', note: 'hi' });
  });
});

const REGION = value('<Value name="region" type="string" />');
const MIN = value('<Value name="min_rev" type="number" default={0} />');
const TINY = value('<Value name="tiny" type="table" value={[{"a":1}]} />');
const SALES = query('<Query name="sales">{`select * from orders.rows where region = $region and revenue >= $min_rev`}</Query>');
const ORDERS = (() => { const r = parseImportDecl(el('<Import name="orders" src="ref:abc123" />')); if (!r.ok) throw new Error('import'); return r.decl; })();
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

  it('collects set= keys as writes, and set= / args= sources as reads', () => {
    const uses = collectRefNameUses(nodes('<div><Button set={{"day": "$picked", "n": 2, "x": "$_row.id"}} run="$save" args={{"who": "$_me.id"}}>Go</Button></div>'))
      .map((u) => `${u.attr}=${u.name}:${u.expects}${u.readOnly ? ':read' : ''}`);
    expect(uses).toEqual(['set=day:scalar', 'set=picked:scalar:read', 'set=n:scalar', 'set=x:scalar', 'args=_me.id:scalar:read', 'run=save:mutation']);
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

  it('rejects binding an Import in markup, pointing at a query over it', () => {
    const errors = validateDataflow(flow([REGION], [SALES], [ORDERS]), uses('<DataTable data="$orders" />'));
    expect(errors[0]?.message).toMatch(/an <Import> \(read it in a <Query>: select … from <name>\.rows\)/);
  });

  it('admits $_me.id where a reference is only read, and refuses it anywhere it would be written', () => {
    expect(validateDataflow(flow([], []), uses('<User userId="$_me.id" /><p>{$_me.id ? "in" : "out"}</p>'))).toEqual([]);
    expect(validateDataflow(flow([], []), uses('<input value="$_me.id" />'))[0]?.message).toMatch(/built-ins are read-only/);
    expect(validateDataflow(flow([], []), uses('<Button set={{"_now": "x"}}>x</Button>'))[0]?.message).toMatch(/\$_now is not readable in markup/);
  });

  it('refuses the bare $_me, saying to read its id', () => {
    expect(validateDataflow(flow([], []), uses('<p>{$_me ? "in" : "out"}</p>'))[0]?.message).toMatch(/\$_me is the reader as a row; read its id: \$_me\.id/);
  });

  it('refuses a set= key that is not a declared scalar', () => {
    const errors = validateDataflow(flow([REGION], [SALES], [ORDERS]), uses('<Button set={{"sales": 1, "nope": 2}}>x</Button>'));
    expect(errors.map((e) => e.message).join('\n')).toMatch(/set="\$sales"> binds a scalar value, but "sales" is a table/);
    expect(errors.map((e) => e.message).join('\n')).toMatch(/set="\$nope"> refers to nothing declared/);
  });
});
