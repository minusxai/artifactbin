/**
 * THE PAGE'S OWN ENGINE (lib/story-runtime/page-engine): the SQLite core over
 * the imports this reader holds, answering exactly what the server would —
 * the same evaluator (lib/sql/dataflow-core), the same binding, the same
 * display window — plus the optimistic overlay a held write rides on until
 * the server decides. Run on the real core, in Node.
 */
import { describe, expect, it, vi } from 'vitest';
import { loadSqlite } from '@artifactbin/sql/core';
import { DISPLAY_ROWS } from '@artifactbin/contracts';
import { compiledOf } from '@/test/helpers/compiled';
import { runDataflow } from '@/lib/sql/run-dataflow';
import { mutationRequestFor } from '@/lib/story/mutation-request';
import { createPageEngine } from '../page-engine';

const COLUMNS = [{ name: 'id', type: 'string' as const }, { name: 'region', type: 'string' as const }, { name: 'revenue', type: 'number' as const }];
const ROWS = [{ id: 'a', region: 'EU', revenue: 837 }, { id: 'b', region: 'NA', revenue: 1200 }, { id: 'c', region: 'EU', revenue: 3 }];
const FLOW = await compiledOf(
  '<Import name="sales" src="ref:Sales0001" />' +
  '<Value name="region" type="string" />' +
  '<Value name="todo" type="table" columns={[{name:"t",type:"string"}]} value={[{"t":"one"}]} />' +
  '<Query name="by_region">{`select region, sum(revenue) as revenue from sales.rows where $region is null or region = $region group by 1 order by 1`}</Query>' +
  '<Query name="top">{`select * from by_region order by revenue desc limit 1`}</Query>' +
  '<Query name="me">{`select $_me.id as me, $_now as now, $_tz as tz`}</Query>' +
  '<Query name="todos">{`select count(*) as n from todo`}</Query>' +
  '<Mutation name="add">{`insert into sales.rows (id, region, revenue) values ($_row.id, $region, 10)`}</Mutation>' +
  '<Mutation name="remember">{`insert into todo (t) values ($region)`}</Mutation>',
  { Sales0001: COLUMNS },
);
const CTX = { userId: 'usr_1', now: '2026-09-30T10:00:00.000Z', tz: 'Europe/Paris' };

function engineOver(rows = ROWS) {
  const fetched: string[] = [];
  let current = rows;
  const engine = createPageEngine({
    load: () => loadSqlite(),
    fetch: async (name) => { fetched.push(name); return { rows: { rows: current, columns: COLUMNS } }; },
  });
  return { engine, fetched, setRows: (next: typeof rows) => { current = next; } };
}
const settle = async (engine: ReturnType<typeof createPageEngine>, imports = ['sales']) => {
  engine.prepare(FLOW, imports);
  await vi.waitFor(() => expect(engine.ready(FLOW, imports)).toBe(true));
};

describe('createPageEngine', () => {
  it('is not ready until the core and every import asked for are loaded, and loads each once', async () => {
    const { engine, fetched } = engineOver();
    expect(engine.ready(FLOW, ['sales'])).toBe(false);
    await settle(engine);
    engine.prepare(FLOW, ['sales']);
    expect(fetched).toEqual(['sales']);
  });

  it('answers what the server answers for the same values: rows, typing, the viewer, the clock and the zone', async () => {
    const { engine } = engineOver();
    await settle(engine);
    const values = { region: 'EU' };
    const page = await engine.run(FLOW, ['top', 'me', 'todos'], { values, ...CTX });
    const server = await runDataflow(FLOW, { sales: { rows: { rows: ROWS, columns: COLUMNS } } }, { values, only: ['top', 'me', 'todos'], ...CTX });
    expect(page.tables).toEqual(server.tables);
    expect(Object.keys(page.tables).sort()).toEqual(['by_region', 'me', 'todo', 'todos', 'top']);
    expect(page.errors).toEqual({});
    expect(page.tables.me!.rows).toEqual([{ me: 'usr_1', now: CTX.now, tz: 'Europe/Paris' }]);
  });

  it('reads the reader\'s local rows when they have written any', async () => {
    const { engine } = engineOver();
    await settle(engine);
    const page = await engine.run(FLOW, ['todos'], { values: {}, localTables: { todo: [{ t: 'x' }, { t: 'y' }] }, ...CTX });
    expect(page.tables.todos!.rows).toEqual([{ n: 2 }]);
  });

  it('ships the display window of a large result, with its total, and pages the rest', async () => {
    const many = Array.from({ length: 2400 }, (_, i) => ({ id: `r${i}`, region: `R${String(i).padStart(4, '0')}`, revenue: i }));
    const { engine } = engineOver(many);
    await settle(engine);
    const page = await engine.run(FLOW, ['by_region'], { values: {}, ...CTX });
    expect(page.tables.by_region!.rows).toHaveLength(DISPLAY_ROWS);
    expect(page.tables.by_region).toMatchObject({ truncated: true, totalRows: 2400 });
    const window = await engine.page(FLOW, 'by_region', { offset: 2390, limit: 50, sort: { col: 'revenue', dir: 'asc' } }, { values: {}, ...CTX });
    expect(window.rows.map((r) => r.revenue)).toEqual([2390, 2391, 2392, 2393, 2394, 2395, 2396, 2397, 2398, 2399]);
  });

  it('computes a local-table write in the page, judged by the same signature the server applies', async () => {
    const { engine } = engineOver();
    await settle(engine);
    const m = FLOW.mutations.find((x) => x.name === 'remember')!;
    const result = await engine.write(FLOW, m, mutationRequestFor(m, { values: { region: 'EU' }, localTables: { todo: [{ t: 'one' }] } }), CTX);
    expect(result).toEqual({ target: 'todo', affected: 1, table: { columns: [{ name: 't', type: 'string' }], rows: [{ t: 'one' }, { t: 'EU' }] } });
    await expect(engine.write(FLOW, m, { mutation: 'remember', args: { region: 'EU', nope: 1 } }, CTX)).rejects.toThrow('remember takes no argument nope');
  });

  it('applies a held write at once, keeps it until a fetch after the server confirmed it, and withdraws a refused one', async () => {
    const { engine, fetched, setRows } = engineOver();
    await settle(engine);
    const add = FLOW.mutations.find((x) => x.name === 'add')!;
    const count = async () => (await engine.run(FLOW, ['by_region'], { values: {}, ...CTX })).tables.by_region!.rows;
    const refused = engine.apply(FLOW, add, mutationRequestFor(add, { values: { region: 'XX' }, row: { id: 'n1' } }), CTX)!;
    const kept = engine.apply(FLOW, add, mutationRequestFor(add, { values: { region: 'YY' }, row: { id: 'n2' } }), CTX)!;
    expect((await count()).map((r) => r.region)).toEqual(['EU', 'NA', 'XX', 'YY']);
    // The first is refused: only the second's effect remains, replayed over the held rows.
    refused.settle(false);
    expect((await count()).map((r) => r.region)).toEqual(['EU', 'NA', 'YY']);
    // The second is confirmed; the server's rows now include it, and the page fetches them.
    kept.settle(true);
    setRows([...ROWS, { id: 'n2', region: 'YY', revenue: 10 }]);
    engine.invalidate(['Sales0001']);
    expect(engine.ready(FLOW, ['sales'])).toBe(false);
    await settle(engine);
    expect(fetched).toEqual(['sales', 'sales']);
    // Not applied twice: the confirmed write is the fetched rows' now.
    expect((await count()).map((r) => r.region)).toEqual(['EU', 'NA', 'YY']);
  });

  it('declines to apply a write it cannot judge, leaving the server to answer it', async () => {
    const { engine } = engineOver();
    await settle(engine);
    const add = FLOW.mutations.find((x) => x.name === 'add')!;
    expect(engine.apply(FLOW, add, { mutation: 'add', args: { region: 'EU' } }, CTX)).toBeNull();
  });

  it('an import that cannot be fetched keeps the page unready, so its queries stay on the server', async () => {
    const engine = createPageEngine({ load: () => loadSqlite(), fetch: async () => { throw new Error('404'); } });
    engine.prepare(FLOW, ['sales']);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(engine.ready(FLOW, ['sales'])).toBe(false);
    expect(engine.ready(FLOW, [])).toBe(true);
  });
});
