/**
 * WHERE EACH NODE RUNS, decided from the compiled graph and the one serve-time
 * fact the island carries: which imports this reader may hold in full. Every
 * rule of lib/story/placement, one at a time, over documents the real compiler
 * compiled.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { compiledOf, compiledSource, type TestSource } from '@/test/helpers/compiled';
import { placeDataflow } from '../placement';

const ROWS = [{ name: 'id', type: 'string' as const }, { name: 'region', type: 'string' as const }, { name: 'revenue', type: 'number' as const }];
const SOURCES: Record<string, TestSource> = {
  Sales0001: ROWS,
  Other0001: ROWS,
  PgConn001: {
    kind: 'postgres', tables: [],
    probe: async (sql) => ({ columns: [{ name: 'region', type: 'string' }, { name: 'total', type: 'number' }], params: [...new Set([...sql.matchAll(/\$(\w+)/g)].map((m) => m[1]!))] }),
  },
};
const flowOf = (children: string) => compiledOf(children, SOURCES);

describe('placeDataflow', () => {
  it('without hold facts everything runs on the server, exactly as before', async () => {
    const flow = await flowOf('<Value name="n" type="number" /><Query name="q">{`select $n as n`}</Query>');
    expect(placeDataflow(flow, undefined)).toEqual({ queries: { q: 'server' }, mutations: {} });
  });

  it('a query reading only values and built-ins runs in the browser once the reader holds anything at all', async () => {
    const flow = await flowOf('<Value name="n" type="number" /><Query name="q">{`select $n as n, $_now as now, $_tz as tz, $_me.id as me`}</Query>');
    expect(placeDataflow(flow, []).queries).toEqual({ q: 'browser' });
  });

  it('a query runs in the browser iff every import it reads is held', async () => {
    const flow = await flowOf(
      '<Import name="sales" src="ref:Sales0001" /><Import name="other" src="ref:Other0001" />' +
      '<Query name="mine">{`select region from sales.rows`}</Query>' +
      '<Query name="both">{`select s.region from sales.rows s join other.rows o on o.id = s.id`}</Query>',
    );
    expect(placeDataflow(flow, ['sales']).queries).toEqual({ mine: 'browser', both: 'server' });
    expect(placeDataflow(flow, ['sales', 'other']).queries).toEqual({ mine: 'browser', both: 'browser' });
  });

  it('a query downstream of a server query runs on the server, and so does everything downstream of that', async () => {
    const flow = await flowOf(
      '<Import name="sales" src="ref:Sales0001" />' +
      '<Query name="pg" source="ref:PgConn001">{`select region, sum(amount) as total from orders group by region`}</Query>' +
      '<Query name="joined">{`select pg.region, pg.total from pg join sales.rows s on s.region = pg.region`}</Query>' +
      '<Query name="top">{`select * from joined limit 1`}</Query>' +
      '<Query name="local">{`select region from sales.rows`}</Query>',
    );
    expect(placeDataflow(flow, ['sales']).queries).toEqual({ pg: 'server', joined: 'server', top: 'server', local: 'browser' });
  });

  it('a query reading the membership stays on the server: the browser never holds member rows', async () => {
    const flow = await flowOf('<Query name="members">{`select count(*) as n from _members`}</Query>');
    expect(placeDataflow(flow, []).queries).toEqual({ members: 'server' });
  });

  it('a dataset write is optimistic when its target and everything it reads are held; otherwise the server alone decides', async () => {
    const flow = await flowOf(
      '<Import name="sales" src="ref:Sales0001" /><Import name="other" src="ref:Other0001" />' +
      '<Mutation name="add">{`insert into sales.rows (id, region, revenue) values ($_row.id, \'EU\', 1)`}</Mutation>' +
      '<Mutation name="copy">{`insert into sales.rows (id, region, revenue) select id, region, revenue from other.rows`}</Mutation>' +
      '<Mutation name="gated">{`delete from sales.rows where id in (select user_id from _members)`}</Mutation>',
    );
    expect(placeDataflow(flow, ['sales']).mutations).toEqual({ add: 'optimistic', copy: 'server', gated: 'server' });
    expect(placeDataflow(flow, ['sales', 'other']).mutations).toEqual({ add: 'optimistic', copy: 'optimistic', gated: 'server' });
    expect(placeDataflow(flow, []).mutations).toEqual({ add: 'server', copy: 'server', gated: 'server' });
  });

  it('a local-table write runs entirely in the browser unless it needs the server (an unheld import, the membership, a person column)', async () => {
    const flow = await flowOf(
      '<Import name="sales" src="ref:Sales0001" />' +
      '<Value name="todo" type="table" columns={[{name:"t",type:"string"}]} value={[]} />' +
      '<Value name="owners" type="table" columns={[{name:"who",type:"user"}]} value={[]} />' +
      '<Mutation name="add">{`insert into todo (t) values ($_row.t)`}</Mutation>' +
      '<Mutation name="seed">{`insert into todo (t) select region from sales.rows`}</Mutation>' +
      '<Mutation name="claim">{`insert into owners (who) values ($_me.id)`}</Mutation>',
    );
    expect(placeDataflow(flow, []).mutations).toEqual({ add: 'browser', seed: 'server', claim: 'server' });
    expect(placeDataflow(flow, ['sales']).mutations).toEqual({ add: 'browser', seed: 'browser', claim: 'server' });
  });

  it('the golden booking document: a day click and a booking never leave the page when the reader holds its bookings', async () => {
    const source = readFileSync(path.join(import.meta.dirname, 'fixtures/booking.jsx'), 'utf8');
    const flow = await compiledSource(source, {
      BookRows1: [
        { name: 'id', type: 'string' }, { name: 'day', type: 'date' }, { name: 'slot', type: 'string' },
        { name: 'booked_by', type: 'user' }, { name: 'note', type: 'string' }, { name: 'created_at', type: 'timestamp' },
      ],
    });
    expect(placeDataflow(flow, ['bookings'])).toEqual({
      queries: { days: 'browser', picked: 'browser', slots: 'browser', mine: 'browser' },
      mutations: { book: 'optimistic', cancel: 'optimistic' },
    });
    expect(placeDataflow(flow, []).queries).toEqual({ days: 'browser', picked: 'browser', slots: 'server', mine: 'server' });
  });
});
