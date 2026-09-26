import { describe, expect, it } from 'vitest';
import { convertDocument, type ConvertLookups } from '../convert';

const TITLES: Record<string, string> = { abc123: 'Team Tasks', def456: 'People', sal001: 'Sales 2026', sal002: 'sales-2026', pg0001: 'Warehouse' };
const lookups: ConvertLookups = {
  importName: (ref) => TITLES[ref],
  kind: (ref) => (ref === 'pg0001' ? 'postgres' : 'dataset'),
};

/** Converts cleanly to exactly `after`. */
function golden(before: string, after: string, with_: ConvertLookups = lookups) {
  const result = convertDocument(before, with_);
  expect(result.manual).toEqual([]);
  expect(result.source).toBe(after);
  return result;
}

describe('convertDocument', () => {
  it('leaves a document no rule applies to byte-identical', () => {
    const doc = `<Helmet>
  <title>Plain</title>
  <Value name="grain" type="string" default="day" />
  <Query name="days">{\`select 1 as n union all select 2\`}</Query>
</Helmet>
<main className="p-4">
  <p>Price: $5 &amp; up</p>
  <DataTable data="$days" />
</main>`;
    const result = golden(doc, doc);
    expect(result.changes).toEqual([]);
  });

  it('turns stored-dataset sources into Imports, translates every body and rewrites $_me', () => {
    const before = `<Helmet>
  <title>Tasks</title>
  <Value name="status" type="string" />
  <Query name="tasks" source="ref:abc123">{\`select * from public.rows where $status is null or status = $status order by id\`}</Query>
  <Query name="late" source="ref:abc123">{\`select count(*) / 2 as half from public.rows where due < current_date\`}</Query>
  <Query name="people" source="ref:def456">{\`select name from public.rows where owner = $_me\`}</Query>
  <Mutation name="set_status" expectedAffected={1} source="ref:abc123">{\`update public.rows set status = $_value where id = $_row.id and status is not distinct from $_row.status\`}</Mutation>
</Helmet>
<main>
  {$_me && (<p>Signed in as $_me</p>)}
  <User userId="$_me" />
  <DataTable data="$tasks" rowKey="id">
    <Column col="status" title="Status">
      <Select label="Status {$_row.id}" value="$_row.status" options={["todo","done"]} run="$set_status" />
    </Column>
  </DataTable>
</main>`;
    const after = `<Helmet>
  <Import name="team_tasks" src="ref:abc123" />
  <Import name="people_2" src="ref:def456" />
  <title>Tasks</title>
  <Value name="status" type="string" />
  <Query name="tasks">{\`select * from team_tasks.rows where $status is null or status = $status order by id\`}</Query>
  <Query name="late">{\`select count(*) * 1.0 / 2 as half from team_tasks.rows where due < date($_now)\`}</Query>
  <Query name="people">{\`select name from people_2.rows where owner = $_me.id\`}</Query>
  <Mutation name="set_status" expectedAffected={1}>{\`update team_tasks.rows set status = $_value where id = $_row.id and status is $_row.status\`}</Mutation>
</Helmet>
<main>
  {$_me.id && (<p>Signed in as $_me</p>)}
  <User userId="$_me.id" />
  <DataTable data="$tasks" rowKey="id">
    <Column col="status" title="Status">
      <Select label="Status {$_row.id}" value="$_row.status" options={["todo","done"]} run="$set_status" />
    </Column>
  </DataTable>
</main>`;
    const result = golden(before, after);
    expect(result.changes.filter((c) => c.rule === 'import').map((c) => c.declaration)).toEqual(['team_tasks', 'people_2']);
    expect(result.changes.find((c) => c.rule === 'sql' && c.declaration === 'late')?.notes?.join(' ')).toMatch(/_now/);
    expect(result.changes.find((c) => c.rule === 'viewer')?.detail).toMatch(/2 places/);
  });

  it('reads legacy ref_<id> tables through Imports', () => {
    golden(
      `<Helmet><Query name="joined">{\`select r.id, p.name from ref_abc123 r join "ref_def456" p on r.owner = p.id\`}</Query></Helmet><DataTable data="$joined" />`,
      `<Helmet><Import name="team_tasks" src="ref:abc123" /><Import name="people" src="ref:def456" /><Query name="joined">{\`select r.id, p.name from team_tasks.rows r join people.rows p on r.owner = p.id\`}</Query></Helmet><DataTable data="$joined" />`,
    );
  });

  it('a sourced statement\'s bare tables read the Import; another schema needs a person', () => {
    golden(
      `<Helmet><Mutation name="add" source="ref:abc123">{\`insert into rows (id, owner) select coalesce(max(id), 0) + 1, $_me from rows\`}</Mutation></Helmet><Button run="$add">Add</Button>`,
      `<Helmet><Import name="team_tasks" src="ref:abc123" /><Mutation name="add">{\`insert into team_tasks.rows (id, owner) select coalesce(max(id), 0) + 1, $_me.id from team_tasks.rows\`}</Mutation></Helmet><Button run="$add">Add</Button>`,
    );
    const doc = `<Helmet><Query name="m" source="ref:abc123">{\`select * from models.activity\`}</Query></Helmet>`;
    const result = convertDocument(doc, lookups);
    expect(result.source).toBe(doc);
    expect(doc.slice(result.manual[0].start, result.manual[0].end)).toBe('models.activity');
  });

  it('* EXCLUDE lists the other columns of the dataset the statement reads', () => {
    const columns: ConvertLookups = { ...lookups, columns: (ref, table) => (ref === 'abc123' && table === 'rows' ? ['id', 'due', 'status'] : null) };
    golden(
      `<Helmet><Query name="open" source="ref:abc123">{\`select to_date(due) as due, * exclude (due) from public.rows\`}</Query></Helmet>`,
      `<Helmet><Import name="team_tasks" src="ref:abc123" /><Query name="open">{\`select to_date(due) as due, "id", "status" from team_tasks.rows\`}</Query></Helmet>`,
      columns,
    );
    expect(convertDocument(`<Helmet><Query name="open" source="ref:abc123">{\`select * exclude (due) from public.rows\`}</Query></Helmet>`, lookups).manual[0]!.reason).toMatch(/EXCLUDE/);
  });

  it('keeps Postgres interval syntax in a connected Postgres statement', () => {
    const doc = `<Helmet><Query name="recent" source="ref:pg0001">{\`select * from models.activity where at > now() - interval '1 day'\`}</Query></Helmet>`;
    golden(doc, doc);
  });

  it('keeps a connected Postgres source and its SQL, apart from $_me', () => {
    const doc = (owner: string) => `<Helmet>
  <Query name="activity" source="ref:pg0001">{\`select user_id::int as id from models.activity where owner = ${owner}\`}</Query>
</Helmet>
<DataTable data="$activity" />`;
    const result = golden(doc('$_me'), doc('$_me.id'));
    expect(result.changes.some((c) => c.rule === 'import' || c.rule === 'source')).toBe(false);
  });

  it('names Imports validly and uniquely, falling back to data_<id>', () => {
    const names = (titles: Record<string, string | null>, declared = '') => {
      const refs = Object.keys(titles);
      const doc = `<Helmet>${declared}${refs.map((ref, i) => `<Query name="q${i}" source="ref:${ref}">{\`select 1 from public.rows\`}</Query>`).join('')}</Helmet>`;
      const result = convertDocument(doc, { importName: (ref) => titles[ref], kind: () => 'dataset' });
      expect(result.manual).toEqual([]);
      return result.changes.filter((c) => c.rule === 'import').map((c) => c.declaration);
    };
    expect(names({ sal001: 'Sales-2026 Q1', sal002: 'sales 2026 q1' })).toEqual(['sales_2026_q1', 'sales_2026_q1_2']);
    expect(names({ aaa111: '__', bbb222: 'ref_old', ccc333: 'order', ddd444: '2026 plan', eee555: null, fff666: '_Private notes' })).toEqual(['data_aaa111', 'data_bbb222', 'data_ccc333', 'data_ddd444', 'data_eee555', 'private_notes']);
    expect(names({ abc123: 'Status' }, '<Value name="status" type="string" />')).toEqual(['status_2']);
  });

  it('names the one untitled dataset of a document plainly data', () => {
    const names = (titles: Record<string, string | null>, declared = '') => {
      const refs = Object.keys(titles);
      const doc = `<Helmet>${declared}${refs.map((ref, i) => `<Query name="q${i}" source="ref:${ref}">{\`select 1 from public.rows\`}</Query>`).join('')}</Helmet>`;
      return convertDocument(doc, { importName: (ref) => titles[ref], kind: () => 'dataset' }).changes.filter((c) => c.rule === 'import').map((c) => c.declaration);
    };
    expect(names({ aaa111: null })).toEqual(['data']);
    expect(names({ aaa111: null, sal001: 'Sales' })).toEqual(['data', 'sales']);
    expect(names({ aaa111: null }, '<Value name="data" type="string" />')).toEqual(['data_2']);
  });

  it('turns a literal-only _signals mutation into set= on every control that ran it', () => {
    golden(`<Helmet>
  <Value name="view" type="string" default="table" />
  <Value name="picked" type="string" />
  <Mutation name="show">{\`update _signals set view = 'chart', picked = $_row.id\`}</Mutation>
  <Mutation name="reset_view">{\`update _signals set view = 'table', picked = null\`}</Mutation>
</Helmet>
<For each={$rows} keyBy="id"><Button run="$show">Chart {$_row.id}</Button></For>
<Button variant="outline" run="$reset_view">Back</Button>`, `<Helmet>
  <Value name="view" type="string" default="table" />
  <Value name="picked" type="string" />
</Helmet>
<For each={$rows} keyBy="id"><Button set={{"view":"chart","picked":"$_row.id"}}>Chart {$_row.id}</Button></For>
<Button variant="outline" set={{"view":"table","picked":null}}>Back</Button>`);
  });

  it('a _signals mutation a script may run stays for a person', () => {
    const doc = `<Helmet>
  <Value name="open" type="boolean" default={false} />
  <Mutation name="toggle">{\`update _signals set open = true\`}</Mutation>
  <script>{\`const which = 'toggle'; document.querySelector('b').onclick = () => mx.mutate(which);\`}</script>
</Helmet>
<Button run="$toggle">Open</Button><b>also</b>`;
    const result = convertDocument(doc, lookups);
    expect(result.source).toBe(doc);
    expect(result.manual[0].reason).toMatch(/script/);
  });

  it('a _signals mutation casting a value sets the value, for the compiler to check its type', () => {
    golden(
      `<Helmet><Value name="picked" type="date" /><Mutation name="pick">{\`update _signals set picked = cast($_row.day as date)\`}</Mutation></Helmet><For each={$days}><Button run="$pick">Pick</Button></For>`,
      `<Helmet><Value name="picked" type="date" /></Helmet><For each={$days}><Button set={{"picked":"$_row.day"}}>Pick</Button></For>`,
    );
  });

  it('a _signals mutation reading another value by its column name sets that value', () => {
    golden(
      `<Helmet><Value name="draft" type="string" /><Value name="sent" type="string" /><Mutation name="send">{\`update _signals set sent = draft, draft = ''\`}</Mutation></Helmet><Button run="$send">Send</Button>`,
      `<Helmet><Value name="draft" type="string" /><Value name="sent" type="string" /></Helmet><Button set={{"sent":"$draft","draft":""}}>Send</Button>`,
    );
  });

  it('a _signals mutation computing from its own columns needs a person, told where a computed value lives', () => {
    const doc = `<Helmet>
  <Value name="step" type="number" default={0} />
  <Mutation name="next">{\`update _signals set step = step + 1\`}</Mutation>
</Helmet>
<Button run="$next">Next</Button>`;
    const result = convertDocument(doc, lookups);
    expect(result.source).toBe(doc);
    expect(result.manual).toEqual([expect.objectContaining({ declaration: 'next', reason: expect.stringMatching(/computes step from page values \(step \+ 1\): keep step in a one-row <Value type="table"> updated by a local <Mutation>/) })]);
  });

  it('all or nothing: one manual statement returns the document unchanged, pointing at the construct', () => {
    const doc = `<Helmet>
  <Query name="ok" source="ref:abc123">{\`select id from public.rows where owner = $_me\`}</Query>
  <Query name="tags" source="ref:abc123">{\`select distinct unnest(tags::int[]) as tag from public.rows\`}</Query>
</Helmet>
<User userId="$_me" />`;
    const result = convertDocument(doc, lookups);
    expect(result.source).toBe(doc);
    expect(result.manual).toHaveLength(1);
    expect(result.manual[0]).toMatchObject({ declaration: 'tags', reason: expect.stringMatching(/list/) });
    expect(doc.slice(result.manual[0].start, result.manual[0].end)).toBe('tags::int[]');
    expect(result.changes.map((c) => c.rule)).toEqual(expect.arrayContaining(['source', 'sql', 'import', 'viewer']));
  });

  it('a document that does not parse is manual', () => {
    const result = convertDocument('<Helmet><Query name="x">{`select 1`}</Helmet>', lookups);
    expect(result.manual[0].reason).toMatch(/does not parse/);
  });
});
