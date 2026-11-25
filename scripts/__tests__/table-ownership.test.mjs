/**
 * The validate guard covers app and identity table writes and identity row locks.
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
    expect(check('scripts/lib/any.mjs', 'run("update users set name = $1")')[0]).toContain('call the identity service');
    for (const table of ['groups', 'group_members', 'group_invitations', 'group_hierarchy', 'handle_reservations', 'group_mail_outbox'])
      expect(check(OUTSIDE, `q.query('DELETE FROM ${table} WHERE id=$1')`), table).toHaveLength(1);
    expect(check(OUTSIDE, 'q.query(`UPDATE ${schema}.users SET name=$2`)')).toHaveLength(1);
  });

  it('keeps region state, snapshots and updates under artifacts', () => {
    for (const statement of [
      "UPDATE region_states SET last_seq = $3 WHERE artifact_id = $1 AND region_id = $2",
      "INSERT INTO region_snapshots (artifact_id,region_id,version,snapshot) VALUES ($1,$2,$3,$4)",
      "DELETE FROM region_updates WHERE artifact_id = $1",
    ]) {
      const text = `tx.query(${JSON.stringify(statement)})`;
      expect(check('services/app/lib/region-sessions/sessions.ts', text)).toHaveLength(1);
      expect(check('services/app/lib/artifacts/regions.ts', text)).toEqual([]);
    }
  });

  it('checks product writers of sharing, connections, notifications and audit, even with schema qualifiers', () => {
    for (const [table, owner] of [
      ['artifact_shares', 'artifact-access'],
      ['dataset_connections', 'artifacts'],
      ['member_notifications', 'notifications'],
      ['group_audit', 'groups'],
      ['artifact_versions', 'artifacts'],
      ['user_blocks', 'notifications'],
    ]) {
      const text = `tx.query('UPDATE "arbitrary_schema"."${table}" SET x = 1')`;
      expect(check(OUTSIDE, text), table).toHaveLength(1);
      expect(check(`services/app/lib/${owner}/store.ts`, text), table).toEqual([]);
    }
    expect(check(OUTSIDE, 'q.query(`TRUNCATE TABLE public.artifacts`)')).toHaveLength(1);
    expect(check(OUTSIDE, 'q.query("TRUNCATE other, ONLY app.artifacts, app.relations")')).toHaveLength(2);
    expect(check(OUTSIDE, 'q.query(`MERGE INTO ${schema}.dataset_connections USING temp ON false WHEN NOT MATCHED THEN DO NOTHING`)')).toHaveLength(1);
    expect(check(OUTSIDE, 'q.query("UPDATE analytics_events SET x=1")')).toHaveLength(1);
    expect(check(OUTSIDE, String.raw`q.query("UPDATE\n\"app\".\"artifacts\" SET title=$1")`)).toHaveLength(1);
  });

  it('grants only the reviewed file, write operation and table for each cross-owner transaction', () => {
    const dismiss = 'services/app/lib/artifacts/membership/membership.ts';
    const erase = 'services/app/lib/operations/testuser-erase.ts';
    const boot = 'services/app/lib/platform/db.ts';
    const scripts = ['prepare-company-root', 'enroll-company-root'].map(name => `services/auth/scripts/${name}.ts`);
    expect(check(dismiss, 'q.query("UPDATE member_notifications SET kind=\'dismissed\'")')).toEqual([]);
    expect(check(dismiss, 'q.query("DELETE FROM member_notifications")')).toHaveLength(1);
    expect(check(erase, 'q.query("DELETE FROM member_notifications")')).toEqual([]);
    expect(check(erase, 'q.query("DELETE FROM dataset_connections")')).toHaveLength(1);
    expect(check(erase, 'q.query("UPDATE artifacts SET title=$2")')).toHaveLength(1);
    expect(check(boot, 'q.query("UPDATE relations SET initiated_by=subject_id")')).toEqual([]);
    expect(check(boot, 'q.query("DELETE FROM relations")')).toHaveLength(1);
    for (const file of scripts) {
      expect(check(file, 'q.query(`INSERT INTO ${app}.group_audit VALUES ($1)`)')).toEqual([]);
      expect(check(file, 'q.query(`DELETE FROM ${app}.group_audit`)')).toHaveLength(1);
    }
    expect(check('services/auth/scripts/other.ts', 'q.query("INSERT INTO app.group_audit VALUES ($1)")')).toHaveLength(1);
  });

  it("passes the owner's own writes and the listed importers", () => {
    expect(check('services/app/lib/artifacts/store.ts', "q.query('UPDATE artifacts SET title=$2 WHERE id=$1')")).toEqual([]);
    expect(check('services/auth/src/identity-store/accounts.ts', "q.query('UPDATE users SET name=$2'); q.query('DELETE FROM tokens'); q.query('SELECT id FROM users WHERE id=$1 FOR UPDATE')")).toEqual([]);
    expect(check('services/app/lib/accounts/users.ts', "q.query('UPDATE users SET name=$2')")).toHaveLength(1);
    expect(check('services/app/lib/accounts/users.ts', "q.query('UPDATE artifacts SET user_id=$1')")).toHaveLength(1);
    expect(check('services/app/lib/native-history-import/index.ts', "q.query('UPDATE artifacts SET version=$2')")).toHaveLength(1);
    expect(check('services/test-support/src/db.ts', "q.query('INSERT INTO tokens (id) VALUES ($1)')")).toEqual([]);
    expect(check('services/app/lib/operations/testuser-erase.ts', "q.query('DELETE FROM artifacts WHERE id = $1')")).toEqual([]);
    // An importer of app rows is not one of identity's: the erase asks the identity module for those.
    expect(check('services/app/lib/operations/testuser-erase.ts', "q.query('DELETE FROM users WHERE id = $1')")).toHaveLength(1);
  });

  it('refuses a row lock covering an identity table outside the identity module, by alias or whole statement', () => {
    for (const text of [
      "q.query('SELECT id FROM tokens WHERE id=$1 FOR SHARE')",
      "q.query('SELECT id FROM users WHERE id=$1 FOR UPDATE')",
      "q.query('SELECT s.role FROM artifact_group_shares s JOIN group_members m ON m.group_id=s.group_id FOR SHARE OF s, m')",
      "q.query('SELECT id FROM groups WHERE id=ANY($1) ORDER BY id FOR UPDATE NOWAIT')",
    ]) expect(check(OUTSIDE, text), text).toHaveLength(1);
    expect(check(OUTSIDE, "q.query('SELECT s.role FROM artifact_group_shares s JOIN group_members m ON m.group_id=s.group_id FOR SHARE OF s')")).toEqual([]);
  });

  it('passes reads, joins, artifact locks, comments, tests and tables whose names merely start with an owned one', () => {
    const fine = [
      "q.query('SELECT id FROM artifacts WHERE id=$1 FOR UPDATE')",
      "q.query('SELECT id FROM tokens WHERE id=$1')",
      "q.query('SELECT 1 FROM users u JOIN artifacts a ON a.user_id=u.id FOR UPDATE OF a')",
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
