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
describe('renderSchema: an access method, an expression column, and a dropped column', () => {
  const D: Table = {
    name: 'gadgets',
    columns: [{ name: 'id', type: 'TEXT' }, { name: 'trail', type: 'TEXT[]', notNull: true, default: "'{}'" }],
    primaryKey: ['id'],
    // `using` picks the access method; a column that is not a plain name is an
    // EXPRESSION and is emitted verbatim, parens and all.
    indexes: [
      { name: 'idx_gadgets_trail', columns: ['trail'], using: 'gin' },
      { name: 'idx_gadgets_parent', columns: ['(trail[cardinality(trail)])'] },
    ],
    dropped: ['legacy'],
  };
  it('renders USING <method>, the expression verbatim, and an idempotent DROP COLUMN', () => {
    const s = renderSchema([D]);
    expect(s).toContainEqual('CREATE INDEX IF NOT EXISTS idx_gadgets_trail ON gadgets USING gin (trail)');
    expect(s).toContainEqual('CREATE INDEX IF NOT EXISTS idx_gadgets_parent ON gadgets ((trail[cardinality(trail)]))');
    expect(s).toContainEqual('ALTER TABLE gadgets DROP COLUMN IF EXISTS legacy');
  });
  it('drops the column BEFORE the indexes, so an index on a dropped column cannot be created after it', () => {
    const s = renderSchema([D]);
    expect(s.findIndex((x) => x.includes('DROP COLUMN IF EXISTS legacy')))
      .toBeLessThan(s.findIndex((x) => x.includes('CREATE INDEX')));
  });
  it('applies against a real engine, twice, and the dropped column is gone after the first', async () => {
    // The column exists first — the drop is a MIGRATION, so the interesting
    // case is a database that still has it.
    await pg.exec('CREATE TABLE IF NOT EXISTS app.gadgets (id TEXT PRIMARY KEY, legacy TEXT)');
    await ensureTable(db, [D], { schema: 'app' });
    await ensureTable(db, [D], { schema: 'app' });
    const { rows } = await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'gadgets' ORDER BY ordinal_position");
    expect(rows.map((r) => r.column_name)).toEqual(['id', 'trail']);
    const idx = await db.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE schemaname = 'app' AND tablename = 'gadgets' ORDER BY indexname");
    expect(idx.rows.map((r) => r.indexname)).toContain('idx_gadgets_trail');
    expect(idx.rows.map((r) => r.indexname)).toContain('idx_gadgets_parent');
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
