/**
 * The table-ownership check (scripts/ci/table-ownership.mjs) bites on a write outside its owner, reads only
 * literals (a comment quoting a statement is not one), passes locks and other tables, and the real tree is clean.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tableOwnershipViolations } from '../ci/table-ownership.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const check = (file, text) => tableOwnershipViolations([{ path: file, text }]);
const OUTSIDE = 'services/app/lib/workspace/trash.ts';

describe('table ownership', () => {
  it('refuses an UPDATE, INSERT or DELETE of an owned table outside its owner, naming file, line and owner', () => {
    expect(check(OUTSIDE, "const a = 1;\nawait tx.query('UPDATE artifacts SET deleted_at = NULL WHERE id = $1', [id]);\n"))
      .toEqual(['  services/app/lib/workspace/trash.ts:2 UPDATE artifacts — call a lib/artifacts function with this transaction instead']);
    expect(check(OUTSIDE, 'q.query(`insert into "tokens"(id) values ($1)`);')).toHaveLength(1);
    expect(check(OUTSIDE, "q.query('DELETE FROM ONLY public.users WHERE id=$1');")).toHaveLength(1);
    expect(check(OUTSIDE, 'q.query(`WITH updated AS (\n  UPDATE\n    artifacts SET meta = ${meta}\n) SELECT 1`);')).toHaveLength(1);
    expect(check('scripts/lib/any.mjs', 'run("update users set name = $1")')[0]).toContain('lib/accounts function');
  });

  it("passes the owner's own writes and the listed importers", () => {
    expect(check('services/app/lib/artifacts/store.ts', "q.query('UPDATE artifacts SET title=$2 WHERE id=$1')")).toEqual([]);
    expect(check('services/app/lib/accounts/users.ts', "q.query('UPDATE users SET name=$2'); q.query('DELETE FROM tokens')")).toEqual([]);
    expect(check('services/app/lib/accounts/users.ts', "q.query('UPDATE artifacts SET user_id=$1')")).toHaveLength(1);
    expect(check('services/app/lib/native-history-import/index.ts', "q.query('UPDATE artifacts SET version=$2')")).toEqual([]);
    expect(check('services/test-support/src/db.ts', "q.query('INSERT INTO tokens (id) VALUES ($1)')")).toEqual([]);
    expect(check('services/app/lib/operations/testuser-erase.ts', "q.query('DELETE FROM users WHERE id = $1')")).toEqual([]);
  });

  it('passes reads, joins, locks, comments, tests and tables whose names merely start with an owned one', () => {
    const fine = [
      "q.query('SELECT id FROM artifacts WHERE id=$1 FOR UPDATE')",
      "q.query('SELECT id FROM tokens WHERE id=$1 FOR SHARE')",
      "q.query('SELECT 1 FROM users u JOIN artifacts a ON a.user_id=u.id FOR UPDATE OF a')",
      "q.query('INSERT INTO artifact_versions (artifact_id) VALUES ($1)')",
      "q.query('DELETE FROM user_blocks WHERE user_id=$1')",
      "q.query('INSERT INTO x VALUES (1) ON CONFLICT (id) DO UPDATE SET n = 1')",
      '// UPDATE artifacts SET user_id is the merge this calls\n/** DELETE FROM users, as the docs say */\nconst n = 1;',
      'q.query(`UPDATE ${table} SET seen=1`)',
    ];
    for (const text of fine) expect(check(OUTSIDE, text), text).toEqual([]);
    expect(check('services/app/lib/workspace/__tests__/trash.test.ts', "q.query('UPDATE artifacts SET x=1')")).toEqual([]);
    expect(check('services/app/__tests__/harness.ts', "q.query('INSERT INTO users (id) VALUES ($1)')")).toEqual([]);
  });

  it('the real tree holds', () => {
    const run = spawnSync(process.execPath, ['scripts/ci/table-ownership.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
  });
});
