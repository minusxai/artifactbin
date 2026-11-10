import { expect, it, vi } from 'vitest';
import { createSql, SqlError, type SqlPort } from '../apollo/sql';

function port(reply: (request: { sql: string; params: Record<string, unknown> }) => unknown = () => ({ columns: [{ name: 'n', type: 'number' }], rows: [{ n: 1 }] })) {
  const listeners = new Set<(names?: readonly string[]) => void>();
  const sent: Array<{ sql: string; params: Record<string, unknown>; idempotencyKey: string }> = [];
  const p: SqlPort = {
    async run(request) { sent.push(request); return reply(request) as never; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return { p, sent, invalidate: (names?: readonly string[]) => { for (const l of [...listeners]) l(names); }, listeners };
}

it('binds every ${…} as a parameter, never as SQL text, and answers rows with their columns', async () => {
  const { p, sent } = port();
  const sql = createSql(p);
  const year = 2024, name = "x' or 1=1 --";
  const rows = await sql`select region, sum(amount) as total from sales where year = ${year} and name = ${name} group by region`;
  expect(sent[0]).toEqual({ sql: 'select region, sum(amount) as total from sales where year = $p0 and name = $p1 group by region', params: { p0: 2024, p1: name }, idempotencyKey: expect.stringMatching(/^[A-Za-z0-9_-]{16,128}$/) });
  expect(rows).toEqual([{ n: 1 }]);
  expect((rows as unknown as { columns: unknown }).columns).toEqual([{ name: 'n', type: 'number' }]);
  // Out of iteration and JSON, and an ordinary property a library handed the rows may delete (Vega does).
  expect(Object.keys(rows)).toEqual(['0']);expect(JSON.stringify(rows)).toBe('[{"n":1}]');
  expect(delete (rows as unknown as { columns?: unknown }).columns).toBe(true);
  // A date is its ISO instant, a boolean stays a boolean; anything else is refused before anything is sent.
  await sql`select ${new Date('2024-01-02T03:04:05Z')}, ${true}, ${null}`;
  expect(sent[1]!.params).toEqual({ p0: '2024-01-02T03:04:05.000Z', p1: true, p2: null });
  for (const bad of [undefined, {}, [1], Number.NaN, () => 1]) expect(() => sql`select ${bad as never}`).toThrow(TypeError);
  expect(sent).toHaveLength(2);
});

it('answers a write as {affected, returning}, each run its own Idempotency-Key, and rejects a refusal with its code', async () => {
  const { p, sent } = port((r) => (r.sql.startsWith('insert') ? { affected: 1, returning: [{ _id: 'r_1', title: 't' }] } : { error: 'permission_denied', message: 'no' }));
  const sql = createSql(p);
  const insert = sql`insert into tasks (title) values (${'t'})`;
  expect(await insert).toEqual({ affected: 1, returning: [{ _id: 'r_1', title: 't' }] });
  await insert;
  expect(sent[0]!.idempotencyKey).not.toBe(sent[1]!.idempotencyKey);
  const refused = await sql`update tasks set done = true`.then(() => null, (e: unknown) => e);
  expect(refused).toBeInstanceOf(SqlError);
  expect(refused).toMatchObject({ code: 'permission_denied', message: 'no' });
});

it('watch: answers at once, again on an invalidation naming a link it reads, one request in flight, and stops', async () => {
  let n = 0, release: () => void = () => {};
  const gate = () => new Promise<void>((resolve) => { release = resolve; });
  let waiting: Promise<void> | null = null;
  const { p, sent, invalidate, listeners } = port();
  p.run = vi.fn(async (request) => { sent.push(request); if (waiting) await waiting; return { columns: [], rows: [{ n: ++n }] } as never; });
  const sql = createSql(p);
  const seen: unknown[] = [];
  const stop = sql.watch(sql`select count(*) as open from tasks where not done`, (rows) => seen.push(rows[0]));
  await vi.waitFor(() => expect(seen).toEqual([{ n: 1 }]));
  invalidate(['other']);
  await Promise.resolve();
  expect(sent).toHaveLength(1);
  waiting = gate();
  invalidate(['tasks']); invalidate(['tasks']); invalidate();
  await vi.waitFor(() => expect(sent).toHaveLength(2));
  waiting = null; release();
  // Invalidations while one ran coalesce into exactly one more.
  await vi.waitFor(() => expect(seen).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]));
  expect(sent).toHaveLength(3);
  stop();
  expect(listeners.size).toBe(0);
  invalidate(['tasks']);
  await Promise.resolve();
  expect(sent).toHaveLength(3);
});
