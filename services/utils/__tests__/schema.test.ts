/** Schema as data → additive, idempotent DDL; applied twice it changes nothing; a new column appears on the next boot. */
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Queryable, Table } from '@artifactbin/contracts';
import { ensureTable, renderSchema } from '@artifactbin/utils';

const T: Table = { name: 'widgets', columns: [{ name: 'id', type: 'TEXT' }, { name: 'n', type: 'INTEGER', notNull: true, default: '0' }, { name: 'old', type: 'TEXT', retired: true }], primaryKey: ['id'], indexes: [{ name: 'idx_widgets_n', columns: ['n'], where: 'n > 0' }] };
let pg: PGlite; let db: Queryable;
beforeAll(async () => { pg = new PGlite(); await pg.exec('CREATE SCHEMA app'); db = { query: async (sql, params) => ({ rows: (await pg.query(sql, params as unknown[])).rows as never }) }; });
afterAll(() => pg.close());

describe('renderSchema', () => {
  it('emits CREATE TABLE IF NOT EXISTS, one ADD COLUMN IF NOT EXISTS per column, DROP NOT NULL for a retired column, and the indexes', () => {
    const s = renderSchema([T]);
    expect(s[0]).toMatch(/^CREATE TABLE IF NOT EXISTS widgets \(/);
    expect(s[0]).toMatch(/PRIMARY KEY \(id\)/);
    expect(s.filter((x) => /ADD COLUMN IF NOT EXISTS/.test(x))).toHaveLength(3);
    expect(s).toContainEqual('ALTER TABLE widgets ALTER COLUMN old DROP NOT NULL');
    expect(s.at(-1)).toBe('CREATE INDEX IF NOT EXISTS idx_widgets_n ON widgets (n) WHERE n > 0');
  });
  it('qualifies every statement with the schema when asked', () => {
    for (const s of renderSchema([T], { schema: 'app' })) expect(s).toMatch(/app\.widgets/);
  });
});
describe('ensureTable', () => {
  it('applies the DDL, is idempotent, and grows a table by a newly declared column', async () => {
    await ensureTable(db, [T], { schema: 'app' });
    await ensureTable(db, [T], { schema: 'app' });
    const grown: Table = { ...T, columns: [...T.columns, { name: 'extra', type: 'TEXT' }] };
    await ensureTable(db, [grown], { schema: 'app' });
    const { rows } = await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'widgets' ORDER BY ordinal_position");
    expect(rows.map((r) => r.column_name)).toEqual(['id', 'n', 'old', 'extra']);
  });
});
