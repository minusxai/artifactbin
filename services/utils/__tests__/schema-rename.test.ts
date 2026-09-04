/** P3 (seeded RED) — a column rename is DECLARED: add, guarded copy, drop; idempotent across boots. */
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import type { Table } from '@artifactbin/contracts';
import { renderSchema } from '@artifactbin/utils';

const OLD: Table = { name: 'tokens', columns: [{ name: 'id', type: 'TEXT', notNull: true }, { name: 'revoked_at', type: 'TIMESTAMPTZ' }], primaryKey: ['id'] };
const NEW: Table = { name: 'tokens', columns: [{ name: 'id', type: 'TEXT', notNull: true }, { name: 'deleted_at', type: 'TIMESTAMPTZ', renamedFrom: 'revoked_at' } as never], primaryKey: ['id'] };

describe('renamedFrom', () => {
  it('renders add, a guarded copy, and the drop of the old column', () => {
    const s = renderSchema([NEW]).join('\n');
    expect(s).toContain('ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ');
    expect(s).toMatch(/information_schema\.columns/);
    expect(s).toMatch(/SET deleted_at = revoked_at/);
    expect(s).toMatch(/DROP COLUMN (IF EXISTS )?revoked_at/);
  });

  it('a revoked token stays revoked through the rename, and a second boot changes nothing', async () => {
    const db = new PGlite();
    for (const st of renderSchema([OLD])) await db.exec(st);
    await db.exec(`INSERT INTO tokens VALUES ('live', NULL), ('dead', now())`);
    for (let boot = 1; boot <= 2; boot++) {
      for (const st of renderSchema([NEW])) await db.exec(st);
      const rows = (await db.query<{ id: string; gone: boolean }>(`SELECT id, deleted_at IS NOT NULL AS gone FROM tokens ORDER BY id`)).rows;
      expect(rows, `boot ${boot}`).toEqual([{ id: 'dead', gone: true }, { id: 'live', gone: false }]);
      const cols = (await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'tokens' ORDER BY 1`)).rows.map((r) => r.column_name);
      expect(cols, `boot ${boot}`).toEqual(['deleted_at', 'id']);
    }
  });
});
