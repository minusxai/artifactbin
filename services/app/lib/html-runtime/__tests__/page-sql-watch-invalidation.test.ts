/**
 * sql.watch re-runs on a names-only invalidation for both forms: an inline statement when the invalidation names a
 * link its text mentions, and a declared query (whose SQL only the server holds) whenever any link is named.
 */
import { expect, it, vi } from 'vitest';
import { createSql, type SqlPort } from '../apollo/sql';

function port() {
  const listeners = new Set<(names?: readonly string[]) => void>();
  const sent: Array<{ sql?: string; query?: string }> = [];
  const p: SqlPort = {
    async run(request) { sent.push(request); return { columns: [{ name: 'n', type: 'number' }], rows: [{ n: sent.length }] }; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return { p, sent, invalidate: (names?: readonly string[]) => { for (const l of [...listeners]) l(names); } };
}

it('re-runs an inline statement when a named invalidation names a link it reads, and not otherwise', async () => {
  const { p, sent, invalidate } = port();
  const sql = createSql(p);
  const seen: unknown[] = [];
  const stop = sql.watch(sql`select count(*) as n from tasks`, (rows) => seen.push(rows[0]));
  await vi.waitFor(() => expect(seen).toHaveLength(1));
  invalidate(['other']);
  await Promise.resolve();
  expect(sent).toHaveLength(1);
  invalidate(['tasks']);
  await vi.waitFor(() => expect(seen).toHaveLength(2));
  stop();
});

it('re-runs a declared query when its data changes, named or not, and stops with its watch', async () => {
  const { p, sent, invalidate } = port();
  const sql = createSql(p);
  const seen: unknown[] = [];
  const stop = sql.watch(sql.query('revenue', { year: 2026 }), (rows) => seen.push(rows[0]));
  await vi.waitFor(() => expect(seen).toHaveLength(1));
  invalidate(['sales']);
  await vi.waitFor(() => expect(seen).toHaveLength(2));
  invalidate();
  await vi.waitFor(() => expect(seen).toHaveLength(3));
  expect(sent.map((request) => request.query)).toEqual(['revenue', 'revenue', 'revenue']);
  stop();
  invalidate(['sales']);
  await Promise.resolve();
  expect(sent).toHaveLength(3);
});
