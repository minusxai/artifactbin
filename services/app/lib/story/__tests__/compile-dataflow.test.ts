/**
 * THE COMPILER'S CONTRACT: every rule and every error the brief names, and the
 * booking golden, whose compiled record is committed beside this file and was
 * reviewed by hand (__snapshots__/booking.compiled.json).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DatasetColumn } from '@artifactbin/contracts';
import { parseJsx } from '@/lib/jsx';
import { dataflowOf, splitHelmet } from '../helmet';
import { compileDataflow, prepareCompile, rewriteBuiltinFields, type ImportSource } from '../compile-dataflow';
import { validateMarkupStructure } from '../local-validation';

const BOOKINGS: DatasetColumn[] = [
  { name: 'id', type: 'string' }, { name: 'day', type: 'date' }, { name: 'slot', type: 'string' },
  { name: 'booked_by', type: 'user' }, { name: 'note', type: 'string' }, { name: 'created_at', type: 'timestamp' },
];
const SOURCES: Record<string, ImportSource> = {
  BookRows1: { kind: 'dataset', tables: [{ name: 'rows', columns: BOOKINGS }] },
  Folder001: { kind: 'folder', tables: [{ name: 'rows', columns: [{ name: 'id', type: 'string' }, { name: 'title', type: 'string' }] }] },
  PgConn001: {
    kind: 'postgres', tables: [],
    probe: async (sql) => ({ columns: [{ name: 'region', type: 'string' }, { name: 'total', type: 'number' }], params: [...new Set([...sql.matchAll(/\$(\w+)/g)].map((m) => m[1]!))] }),
  },
};
const NOW = '2026-09-30T10:15:00.000Z';

async function compile(source: string) {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(`fixture does not parse: ${parsed.error}`);
  const { content, body } = splitHelmet(parsed.nodes);
  const flow = dataflowOf(content);
  const ctx = { ...(await prepareCompile(flow, async (ref) => SOURCES[ref] ?? null)), now: NOW };
  return compileDataflow(flow, ctx, body);
}
const doc = (helmet: string, body = '<main />') => `<Helmet>${helmet}</Helmet>\n${body}`;
const errorsOf = async (source: string) => {
  const result = await compile(source);
  if (result.ok) throw new Error('expected compile errors');
  return result.errors.map((e) => e.message);
};
const IMPORT = '<Import name="bookings" src="ref:BookRows1" />';

describe('the booking golden', () => {
  it('compiles to the reviewed record', async () => {
    const source = readFileSync(new URL('./fixtures/booking.jsx', import.meta.url), 'utf8');
    const result = await compile(source);
    if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('\n'));
    await expect(`${JSON.stringify(result.compiled, null, 2)}\n`).toMatchFileSnapshot('./__snapshots__/booking.compiled.json');
    const { queries, mutations } = result.compiled;
    expect(queries.map((q) => q.name)).toEqual(['days', 'picked', 'slots', 'mine']);
    expect(queries.find((q) => q.name === 'slots')!.reads).toEqual({ imports: ['bookings'], queries: ['picked'], values: [], builtins: ['_me.id', '_now', '_tz'] });
    expect(queries.find((q) => q.name === 'picked')!.reads).toEqual({ imports: [], queries: ['days'], values: ['day'], builtins: [] });
    expect(mutations.find((m) => m.name === 'book')).toMatchObject({ target: { import: 'bookings', table: 'rows' }, args: [{ name: 'note', type: 'string' }], expectedAffected: 1, reset: ['note'] });
    expect(mutations.find((m) => m.name === 'book')!.reads.builtins).toEqual(['_row.id', '_row.day', '_row.slot', '_me.id', '_now']);
    expect(mutations.find((m) => m.name === 'cancel')).toMatchObject({ target: { import: 'bookings', table: 'rows' }, args: [] });
  });
});

describe('queries', () => {
  it('compile depth-first: a query may read one declared after it', async () => {
    const result = await compile(doc(`<Query name="b">{\`select n * 2 as m from a\`}</Query><Query name="a">{\`select 1 as n\`}</Query>`));
    expect(result.ok && result.compiled.queries.map((q) => q.name)).toEqual(['a', 'b']);
  });

  it('name both queries of a cycle, and a query that reads itself', async () => {
    const cycle = await errorsOf(doc(`<Query name="a">{\`select * from b\`}</Query><Query name="b">{\`select * from a\`}</Query>`));
    expect(cycle.join('\n')).toMatch(/<Query name="b"> reads a, which reads b back .*a → b → a/);
    expect(await errorsOf(doc(`<Query name="a">{\`select * from a\`}</Query>`))).toEqual(['<Query name="a"> reads itself — a query cannot depend on its own result']);
  });

  it('say which column does not exist', async () => {
    expect(await errorsOf(doc(`${IMPORT}<Query name="slots">{\`select b.slott from bookings.rows b\`}</Query>`))).toEqual(['<Query name="slots"> reads b.slott — no such column']);
  });

  it('refuse the removed syntax by name', async () => {
    const [signals] = await errorsOf(doc(`<Value name="x" /><Query name="q">{\`select x from _signals\`}</Query>`));
    expect(signals).toMatch(/_signals, which is removed — .*set=/);
    expect((await errorsOf(doc(`<Query name="q">{\`select * from public.rows\`}</Query>`)))[0]).toMatch(/public\.rows is removed: <Import/);
    expect((await errorsOf(doc(`<Query name="q">{\`select * from ref_BookRows1\`}</Query>`)))[0]).toMatch(/<Import name="…" src="ref:BookRows1"/);
    expect((await errorsOf(doc(`<Query name="q" source="ref:BookRows1">{\`select * from public.rows\`}</Query>`)))[0]).toMatch(/source= is only for a connected Postgres dataset, and ref:BookRows1 is stored — <Import/);
    expect((await errorsOf(doc(`<Import name="pg" src="ref:PgConn001" />`)))[0]).toMatch(/is never imported: run the query inside it with <Query name="…" source="ref:PgConn001">/);
  });

  it('refuse the clock: $_now is the current time', async () => {
    expect((await errorsOf(doc(`<Query name="q">{\`select current_date as d\`}</Query>`)))[0]).toMatch(/calls current_date — the current time is the built-in \$_now/);
    expect((await errorsOf(doc(`<Query name="q">{\`select date('now') as d\`}</Query>`)))[0]).toMatch(/'now' — the current time is the built-in \$_now/);
    const ok = await compile(doc(`<Query name="q">{\`select 'now' as word\`}</Query>`));
    expect(ok.ok).toBe(true);
  });

  it('bind only declared values and the built-ins a query may read', async () => {
    expect(await errorsOf(doc(`<Query name="q">{\`select $x as x\`}</Query>`))).toEqual(['<Query name="q"> binds $x, which is not a declared <Value> — declare <Value name="x" type="…" />']);
    expect((await errorsOf(doc(`<Query name="q">{\`select $_me as me\`}</Query>`)))[0]).toMatch(/binds \$_me, the reader as a row — bind its id: \$_me\.id/);
    expect((await errorsOf(doc(`<Query name="q">{\`select $_row.id as id\`}</Query>`)))[0]).toMatch(/binds \$_row\.id — only a <Mutation> reads the row its control sits in/);
    expect((await errorsOf(doc(`<Value name="t" type="table" value={[{"a":1}]} /><Query name="q">{\`select $t as t\`}</Query>`)))[0]).toMatch(/binds \$t, but "t" is a table/);
    const ok = await compile(doc(`<Value name="day" type="date" /><Query name="q">{\`select $day as d, $_me.id as me, $_now as at, $_tz as zone from _me, _members\`}</Query>`));
    expect(ok.ok && ok.compiled.queries[0]).toMatchObject({ sql: expect.stringContaining('$_me__id'), params: ['day', '_me.id', '_now', '_tz'], reads: { values: ['day'], builtins: ['_me', '_members', '_me.id', '_now', '_tz'] } });
  });

  it('type columns by origin, through an earlier query, by the dry run over sample rows, or not at all', async () => {
    const result = await compile(doc(`${IMPORT}<Value name="t" type="table" value={[{"n":1}]} />
      <Query name="a">{\`select booked_by, day, 1 + 1 as two, (select max(slot) from bookings.rows) as last from bookings.rows\`}</Query>
      <Query name="b">{\`select booked_by as who, n * 2 as twice from a, t\`}</Query>`));
    if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('\n'));
    // Expressions take the type their values show over one typed sample row of each import.
    expect(result.compiled.queries.find((q) => q.name === 'a')!.columns).toEqual([{ name: 'booked_by', type: 'user' }, { name: 'day', type: 'date' }, { name: 'two', type: 'number' }, { name: 'last', type: 'string' }]);
    expect(result.compiled.queries.find((q) => q.name === 'b')!.columns).toEqual([{ name: 'who', type: 'user' }, { name: 'twice', type: 'number' }]);
    // …and nothing is claimed for a column no row can show.
    const filtered = await compile(doc(`${IMPORT}<Query name="none">{\`select slot || '!' as s from bookings.rows where false\`}</Query>`));
    expect(filtered.ok && filtered.compiled.queries[0]!.columns).toEqual([{ name: 's', type: null }]);
    const values = await compile(doc(`<Query name="c">{\`select 1 + 1 as two, 'x' as word, date('2026-01-02') as day\`}</Query>`));
    expect(values.ok && values.compiled.queries[0]!.columns).toEqual([{ name: 'two', type: 'number' }, { name: 'word', type: 'string' }, { name: 'day', type: 'date' }]);
  });

  it('type a compound column user only when every branch projects a user', async () => {
    const result = await compile(doc(`${IMPORT}<Value name="t" type="table" value={[{"who":"x"}]} />
      <Query name="leak">{\`select booked_by, day from bookings.rows union select who, day from bookings.rows, t\`}</Query>
      <Query name="both">{\`with b as (select * from bookings.rows) select booked_by from b union all select booked_by from bookings.rows where day > '2026-01-01' order by 1\`}</Query>
      <Query name="nested">{\`select booked_by from (select booked_by from bookings.rows union select note from bookings.rows)\`}</Query>`));
    if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('\n'));
    const columns = (name: string) => result.compiled.queries.find((q) => q.name === name)!.columns;
    expect(columns('leak')).toEqual([{ name: 'booked_by', type: 'string' }, { name: 'day', type: 'date' }]);
    expect(columns('both')).toEqual([{ name: 'booked_by', type: 'user' }]);
    // A compound inside a subquery answers no origin at all, so nothing is claimed.
    expect(columns('nested')[0]!.type).not.toBe('user');
  });

  it('run a connected Postgres query inside its database, with its probed shape', async () => {
    const result = await compile(doc(`<Value name="region" /><Query name="sales" source="ref:PgConn001">{\`select region, sum(amount) as total from orders where $region is null or region = $region and owner = $_me.id group by region\`}</Query>`));
    expect(result.ok && result.compiled.queries[0]).toMatchObject({ engine: 'postgres', source: 'PgConn001', params: ['region', '_me.id'], reads: { values: ['region'], builtins: ['_me.id'] }, columns: [{ name: 'region', type: 'string' }, { name: 'total', type: 'number' }] });
  });
});

describe('mutations', () => {
  it('write exactly one imported table or local table Value, with plain params as arguments', async () => {
    const result = await compile(doc(`${IMPORT}<Value name="draft" type="table" value={[]} columns={[{"name":"text","type":"string"}]} /><Value name="text" />
      <Mutation name="add">{\`insert into draft (text) values ($text)\`}</Mutation>
      <Mutation name="note">{\`update bookings.rows set note = $text where id = $_row.id\`}</Mutation>
      <Query name="rows">{\`select id from bookings.rows\`}</Query>`, '<For each={$rows} keyBy="id"><Button run="$note">Note</Button></For>'));
    if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('\n'));
    expect(result.compiled.mutations).toMatchObject([
      { name: 'add', target: { local: 'draft' }, args: [{ name: 'text', type: 'string' }] },
      { name: 'note', target: { import: 'bookings', table: 'rows' }, args: [{ name: 'text', type: 'string' }], reads: { builtins: ['_row.id'] } },
    ]);
  });

  it('refuse a write to a query, a folder listing, a built-in, or a read', async () => {
    expect((await errorsOf(doc(`<Query name="days">{\`select 1 as d\`}</Query><Mutation name="cancel">{\`delete from days\`}</Mutation>`)))[0]).toBe('<Mutation name="cancel"> writes days, which is a query — a <Mutation> writes an imported table (<import>.rows) or a table <Value>');
    expect((await errorsOf(doc(`<Import name="files" src="ref:Folder001" /><Mutation name="m">{\`delete from files.rows\`}</Mutation>`)))[0]).toMatch(/a folder's listing is read-only/);
    expect((await errorsOf(doc(`<Mutation name="m">{\`delete from _members\`}</Mutation>`)))[0]).toMatch(/_members, which is built in and read-only/);
    expect((await errorsOf(doc(`${IMPORT}<Mutation name="m">{\`select * from bookings.rows\`}</Mutation>`)))[0]).toMatch(/only reads — a <Mutation> is one INSERT, UPDATE or DELETE/);
    expect((await errorsOf(doc(`${IMPORT}<Query name="q">{\`select 1 as id\`}</Query><Mutation name="m">{\`delete from bookings.rows where id in (select id from q)\`}</Mutation>`)))[0]).toMatch(/reads the query q — .*pass what it needs from a query as an argument/);
  });

  it('refuse source= on a mutation at the grammar, pointing at <Import>', () => {
    const { errors } = validateMarkupStructure(doc(`${IMPORT}<Mutation name="m" source="ref:BookRows1">{\`delete from public.rows\`}</Mutation>`));
    expect(errors.map((e) => e.message)).toContainEqual(expect.stringMatching(/<Mutation> takes no source= — import the dataset/));
  });
});

describe('the markup that binds the compiled record', () => {
  const booking = (body: string) => doc(`${IMPORT}<Value name="note" /><Value name="day" type="date" />
    <Query name="slots">{\`select id, day, slot from bookings.rows\`}</Query>
    <Mutation name="book">{\`insert into bookings.rows (id, note) values ($_row.id, $note)\`}</Mutation>
    <Mutation name="rename">{\`update bookings.rows set note = $label where id = $_row.id\`}</Mutation>
    <Mutation name="edit">{\`update bookings.rows set note = $_value where id = $_row.id\`}</Mutation>`, body + PLACED);
  /** Every row action placed where it can run, so each case speaks only of its own control. */
  const PLACED = '<DataTable data="$slots" rowKey="id"><Column col="slot"><input aria-label="Slot" value="$_row.slot" run="$edit" /></Column><Column col="id"><Button run="$book">B</Button><Button run="$rename" args={{"label": "x"}}>R</Button></Column></DataTable>';

  it('fills arguments from same-named values or args=, and says so at the control', async () => {
    expect((await compile(booking('<For each={$slots} keyBy="id"><Button run="$book">Book</Button></For>'))).ok).toBe(true);
    expect(await errorsOf(booking('<For each={$slots} keyBy="id"><Button run="$rename">Rename</Button></For>'))).toEqual(['<Button run="$rename"> cannot fill $label — declare <Value name="label" …/> or pass it: args={{"label": …}}']);
    expect((await compile(booking('<For each={$slots} keyBy="id"><Button run="$rename" args={{"label": "$note"}}>Rename</Button></For>'))).ok).toBe(true);
    expect((await compile(booking('<For each={$slots} keyBy="id"><Button run="$rename" args={{"label": "$_row.slot"}}>Rename</Button></For>'))).ok).toBe(true);
    expect(await errorsOf(booking('<For each={$slots} keyBy="id"><Button run="$book" args={{"when": "$day"}}>Book</Button></For>'))).toEqual(['<Button run="$book" args={{"when": …}}> — book takes no argument when (it takes note)']);
  });

  it('puts row and cell built-ins where a control supplies them', async () => {
    expect((await errorsOf(booking('<Button run="$book">Book</Button>')))[0]).toMatch(/reads \$_row\.id, the row its control sits in: put the control inside a <For>/);
    expect((await errorsOf(booking('<For each={$slots} keyBy="id"><Button run="$edit">Edit</Button></For>')))[0]).toMatch(/reads \$_value, the value an editing cell holds/);
     // A row action no control runs has no row to read; a cell editor must write the value it holds.
    expect(await errorsOf(doc(`${IMPORT}<Mutation name="unpay">{\`delete from bookings.rows where id = $_row.id\`}</Mutation>`))).toEqual(['<Mutation name="unpay"> reads $_row.id — it must be invoked inside a DataTable Column or keyed For: put a control with run="$unpay" there']);
    expect(await errorsOf(booking('<DataTable data="$slots" rowKey="id"><Column col="slot"><input aria-label="S" value="$_row.slot" run="$book" /></Column></DataTable>'))).toEqual(['<input run="$book"> edits a cell, so book writes the value it holds: read $_value in its statement, or run it from a <Button>']);
  });

  it('checks set= keys and types', async () => {
    expect((await compile(booking('<For each={$slots} keyBy="id"><Button set={{"day": "$_row.day", "note": "picked"}}>Pick</Button></For>'))).ok).toBe(true);
    expect(await errorsOf(booking('<Button set={{"day": 3}}>Pick</Button>'))).toEqual(['<Button set={{"day": 3}}> — day is a date, and that is not one']);
    expect(await errorsOf(booking('<For each={$slots} keyBy="id"><Button set={{"day": "$_row.slot"}}>Pick</Button></For>'))).toEqual(['<Button set={{"day": "$_row.slot"}}> — day is a date, and that is a string']);
    expect((await errorsOf(booking('<Input set={{"note": "x"}} label="n" />')))[0]).toBe('set= belongs on a <Button> — it sets page values on click');
  });
});

describe('rewriteBuiltinFields', () => {
  it('rewrites dotted built-ins only in code, and records the mapping', () => {
    const out = rewriteBuiltinFields(`select $_me.id, '$_me.id', "$_row.x" /* $_row.y */ -- $_now.x\n, $_row.day, $plain.x from t`);
    expect(out.sql).toBe(`select $_me__id, '$_me.id', "$_row.x" /* $_row.y */ -- $_now.x\n, $_row__day, $plain.x from t`);
    expect([...out.fields]).toEqual([['_me__id', '_me.id'], ['_row__day', '_row.day']]);
    expect(out.branches).toBeNull();
  });

  it('splits a top-level compound into branches, each carrying the WITH clause', () => {
    const { branches } = rewriteBuiltinFields(`with x as (select 1 union select 2) select a from x UNION ALL select 'union' from "except" except select $_me.id`);
    expect(branches).toEqual([
      'with x as (select 1 union select 2) select a from x ',
      `with x as (select 1 union select 2)  select 'union' from "except" `,
      'with x as (select 1 union select 2)  select $_me__id',
    ]);
  });
});
