/**
 * THE COMPILER TEACHES SQLITE: a statement written in another dialect's habits
 * is refused with the SQLite to write instead, and the one habit SQLite would
 * silently get wrong — `cast(x as date)`, which reads '2026-09-30' as 2026 — is
 * refused rather than run. A connected Postgres query keeps its own dialect.
 */
import { describe, expect, it } from 'vitest';
import type { DatasetColumn } from '@artifactbin/contracts';
import { parseJsx } from '@/lib/jsx';
import { dataflowOf, splitHelmet } from '../helmet';
import { compileDataflow, prepareCompile, type ImportSource } from '../compile-dataflow';

const SALES: DatasetColumn[] = [{ name: 'day', type: 'date' }, { name: 'region', type: 'string' }, { name: 'revenue', type: 'number' }];
const SOURCES: Record<string, ImportSource> = {
  Sales0001: { kind: 'dataset', tables: [{ name: 'rows', columns: SALES }] },
  PgConn001: { kind: 'postgres', tables: [], probe: async () => ({ columns: [{ name: 'day', type: 'date' }], params: [] }) },
};

async function compile(helmet: string) {
  const parsed = parseJsx(`<Helmet><Import name="sales" src="ref:Sales0001" />${helmet}</Helmet>\n<main />`);
  if (!parsed.ok) throw new Error(`fixture does not parse: ${parsed.error}`);
  const { content, body } = splitHelmet(parsed.nodes);
  const flow = dataflowOf(content);
  return compileDataflow(flow, { ...(await prepareCompile(flow, async (ref) => SOURCES[ref] ?? null)), now: '2026-09-30T10:15:00.000Z' }, body);
}
const query = (sql: string) => `<Query name="q">{\`${sql}\`}</Query>`;
const errorOf = async (helmet: string) => {
  const result = await compile(helmet);
  if (result.ok) throw new Error('expected a compile error');
  return result.errors.map((e) => e.message).join('\n');
};

describe('another dialect\'s habits, answered with the SQLite to write', () => {
  it.each([
    ['select cast(day as date) as d from sales.rows', /cast\(x as date\).*date\(x\)/],
    ['select cast(day as timestamp) as t from sales.rows', /strftime\('%Y-%m-%dT%H:%M:%fZ', x\)/],
    ['select day::date as d from sales.rows', /:: is not SQLite.*date\(x\)/],
    ['select region from sales.rows where region ilike \'e%\'', /LIKE is already case-insensitive/],
    ['select date_add(day, interval 1 day) as d from sales.rows', /date_add\(d, 1, 'day'\)/],
    ['select extract(year from day) as y from sales.rows', /date_part\('year', d\)/],
    ['select strptime(region, \'%Y\') as d from sales.rows', /date_parse/],
    ['select unnest(json_array(1, 2)) as n', /json_each/],
    ['select array_agg(region) as all_regions from sales.rows', /json_group_array/],
    ['select dayname(day) as n, date_formt(day, \'%b\') as m from sales.rows', /did you mean date_format/],
    ['select region from sales.rows where day > date \'2026-01-01\'', /dates are ISO text/],
  ])('%s', async (sql, hint) => {
    expect(await errorOf(query(sql))).toMatch(hint);
  });

  it('refuses the silent cast in a mutation too', async () => {
    const message = await errorOf('<Value name="d" type="string" /><Mutation name="m">{`insert into sales.rows (day, region, revenue) values (cast($d as date), \'EU\', 1)`}</Mutation>');
    expect(message).toMatch(/<Mutation name="m"> casts to date/);
  });

  it('leaves a quoted cast, a column alias and SQLite\'s own casts alone', async () => {
    const result = await compile(query(`select 'cast(x as date)' as label, cast(revenue as integer) as whole, cast(revenue as text) as shown, date(day) as d from sales.rows`));
    expect(result.ok ? [] : result.errors.map((e) => e.message)).toEqual([]);
  });

  it('keeps Postgres syntax inside a connected Postgres query', async () => {
    const result = await compile('<Query name="pg" source="ref:PgConn001">{`select now()::date as day, cast(now() as date) as d`}</Query>');
    expect(result.ok ? [] : result.errors.map((e) => e.message)).toEqual([]);
  });
});
