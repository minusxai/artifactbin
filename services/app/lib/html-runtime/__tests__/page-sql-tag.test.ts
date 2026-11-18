import { expect, it, vi } from 'vitest';
import { createSql, SqlError, type SqlPort } from '../apollo/sql';

function port(reply: (request: { sql?: string; query?: string; params: Record<string, unknown> }) => unknown = () => ({ columns: [{ name: 'n', type: 'number' }], rows: [{ n: 1 }] })) {
  const listeners = new Set<(names?: readonly string[]) => void>();
  const sent: Array<{ sql?: string; query?: string; params: Record<string, unknown>; idempotencyKey: string }> = [];
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
  const { p, sent } = port((r) => (r.sql?.startsWith('insert') ? { affected: 1, returning: [{ _id: 'r_1', title: 't' }] } : { error: 'permission_denied', message: 'no' }));
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

it('sends a declared query by name with its values, never SQL text, and watches it like a statement', async () => {
  const { p, sent, invalidate } = port();
  const sql = createSql(p);
  expect(await sql.query('revenue', { year: 2026, since: new Date('2026-01-01T00:00:00Z') })).toEqual([{ n: 1 }]);
  expect(sent[0]).toEqual({ query: 'revenue', params: { year: 2026, since: '2026-01-01T00:00:00.000Z' }, idempotencyKey: expect.any(String) });
  expect(sent[0]).not.toHaveProperty('sql');
  expect(() => sql.query('revenue', { bad: {} as never })).toThrow(TypeError);
  expect(() => sql.query('' as never)).toThrow(TypeError);
  const seen: unknown[] = [];
  const stop = sql.watch(sql.query('mine'), (rows) => seen.push(rows));
  await vi.waitFor(() => expect(seen).toHaveLength(1));
  invalidate();
  await vi.waitFor(() => expect(seen).toHaveLength(2));
  stop();
  expect(sent.slice(1).map((r) => r.query)).toEqual(['mine', 'mine']);
});

it('rejects a failed read with the reader\'s sentence and the reason apart, and keeps a cut-off answer\'s rows and its mark', async () => {
  const notice = 'You don\'t have access to this data. Ask the page\'s owner for access.';
  const { p } = port((r) => r.sql === 'select 1' ? { error: 'permission_denied', message: '42501 orders is not yours to read', notice }
    : r.sql === 'select 2' ? { columns: [{ name: 'n', type: 'number' }], rows: [{ n: 1 }, { n: 2 }], truncated: true }
    : { columns: [{ name: 'n', type: 'number' }], rows: [{ n: 1 }] });
  const sql = createSql(p);
  const denied = await sql`select 1`.then(() => null, (e: unknown) => e);
  expect(denied).toBeInstanceOf(SqlError);
  expect(denied).toMatchObject({ code: 'permission_denied', message: notice, detail: '42501 orders is not yours to read' });
  const cut = await sql`select 2` as unknown as Array<unknown> & { truncated?: boolean };
  expect(cut).toEqual([{ n: 1 }, { n: 2 }]);
  expect(cut.truncated).toBe(true);
  // Out of iteration and JSON, like columns; a whole answer has no mark at all.
  expect(Object.keys(cut)).toEqual(['0', '1']);
  expect(((await sql`select 3`) as unknown as { truncated?: boolean }).truncated).toBeUndefined();
});

it('keeps where an answer\'s rows came from on the rows, out of iteration and JSON', async () => {
  const source = { kind: 'snapshot', at: '2026-11-02T09:05:00.000Z', names: ['orders'] };
  const { p } = port((r) => r.sql === 'select 1' ? { columns: [{ name: 'n', type: 'number' }], rows: [{ n: 1 }], source }
    : { columns: [{ name: 'n', type: 'number' }], rows: [{ n: 1 }] });
  const sql = createSql(p);
  const rows = await sql`select 1` as unknown as Array<unknown> & { source?: unknown };
  expect(rows.source).toEqual(source);
  expect(Object.keys(rows)).toEqual(['0']);
  expect(JSON.stringify(rows)).toBe('[{"n":1}]');
  expect(((await sql`select 2`) as unknown as { source?: unknown }).source).toBeUndefined();
});

it('names a reply that never came unavailable and one it cannot read unexpected, each with the list\'s sentence', async () => {
  const { p } = port();
  p.run = async () => { throw new Error('Remote request outcome unknown'); };
  const sql = createSql(p);
  const lost = await sql`select 1`.then(() => null, (e: unknown) => e);
  expect(lost).toBeInstanceOf(SqlError);
  expect(lost).toMatchObject({ code: 'unavailable', message: 'The data can\'t be reached right now.', detail: 'Remote request outcome unknown' });
  // A SqlError the transport already named (a local preview, an offline copy) keeps its code and words.
  p.run = async () => { throw new SqlError('unavailable', 'sql runs in a page the app frames'); };
  expect(await sql`select 1`.then(() => null, (e: unknown) => e)).toMatchObject({ code: 'unavailable', message: 'sql runs in a page the app frames' });
  p.run = async () => 'nonsense' as never;
  expect(await sql`select 1`.then(() => null, (e: unknown) => e)).toMatchObject({ code: 'unexpected', message: 'This data could not be read.' });
});

it('rejects a declared query a reader may not run with the sentence the server named, whom to ask included', async () => {
  const named = 'You don\'t have access to this data. Ask Team, who owns this page, for access.';
  const { p, sent } = port(() => ({ error: 'permission_denied', message: '42501 sales are not shared with this reader', notice: named }));
  const denied = await createSql(p).query('totals', { region: 'EU' }).then(() => null, (e: unknown) => e);
  expect(sent[0]).toMatchObject({ query: 'totals', params: { region: 'EU' } });
  expect(denied).toBeInstanceOf(SqlError);
  expect(denied).toMatchObject({ code: 'permission_denied', message: named, detail: '42501 sales are not shared with this reader' });
});

it('watch: a read that starts failing reaches its error callback, and without one is reported, never dropped', async () => {
  let failing = false;
  const { p, invalidate } = port(() => failing ? { error: 'unavailable', message: 'the database could not be reached', notice: 'The data can\'t be reached right now.' } : { columns: [], rows: [{ n: 1 }] });
  const sql = createSql(p);
  const seen: unknown[] = [], errors: SqlError[] = [];
  const stop = sql.watch(sql`select n from tasks`, (rows) => seen.push(rows[0]), (e) => errors.push(e));
  await vi.waitFor(() => expect(seen).toEqual([{ n: 1 }]));
  failing = true; invalidate(['tasks']);
  await vi.waitFor(() => expect(errors.map((e) => e.code)).toEqual(['unavailable']));
  expect(seen).toEqual([{ n: 1 }]);
  stop();
  const reported: unknown[] = [];
  const original = globalThis.reportError;
  globalThis.reportError = (e: unknown) => { reported.push(e); };
  try {
    const silent = sql.watch(sql`select n from tasks`, (rows) => seen.push(rows[0]));
    await vi.waitFor(() => expect(reported).toHaveLength(1));
    expect(reported[0]).toMatchObject({ code: 'unavailable', detail: 'the database could not be reached' });
    silent();
  } finally { globalThis.reportError = original; }
});

it('gives the uniform not_found, which carries no words, the list\'s sentence for the reader', async () => {
  const { p } = port(() => ({ error: 'not_found' }));
  expect(await createSql(p)`select 1`.then(() => null, (e: unknown) => e)).toMatchObject({ code: 'not_found', message: 'This page\'s data can\'t be read: the page is gone, or you no longer have access to it.', detail: 'not_found' });
});
