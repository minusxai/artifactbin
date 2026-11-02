/**
 * THE MIGRATION SCRIPT END TO END on a disposable PGLite directory: the schema the server boots, a v1, a v2
 * (named reader and writer) and a no-policy dataset written as stored rows, then `--dry-run` (exit 0, report
 * file, nothing written), `--apply` (v3 stored, shares added) and a second `--apply` (nothing left to do).
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { SCHEMA_STATEMENTS } from '@/lib/platform';

const ROOT = path.resolve(import.meta.dirname, '../../../../..');
const SCRIPT = path.join(ROOT, 'scripts/migrate-dataset-policies.ts');
let dir: string;

async function withDb<T>(fn: (db: PGlite) => Promise<T>): Promise<T> {
  const db = new PGlite(path.join(dir, 'pglite'));
  try { return await fn(db); } finally { await db.close(); }
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-migration-'));
  await withDb(async (db) => {
    for (const statement of SCHEMA_STATEMENTS) await db.query(statement);
    for (const [id, email] of [['usr_owner', 'owner@example.test'], ['usr_reader', 'reader@example.test'], ['usr_writer', 'writer@example.test']])
      await db.query("INSERT INTO users (id,email,kind) VALUES ($1,$2,'account')", [id, email]);
    const dataset = (id: string, policy: unknown, access = 'read') => db.query(
      "INSERT INTO artifacts (id,user_id,creator_user_id,format,meta,visibility,access,dataset_policy,policy_revision,edit_id) VALUES ($1,'usr_owner','usr_owner','dataset','{}'::jsonb,'unlisted',$2,$3::jsonb,$4,$5)",
      [id, access, policy === null ? null : JSON.stringify(policy), policy === null ? 0 : 1, `edit_${id}`]);
    await dataset('DsNone01', null, 'readwrite');
    await dataset('DsV1Wrt1', { version: 1, enforcement: 'enabled', tables: [{ table: { schema: 'public', name: 'rows' }, insert_permissions: [{ role: 'viewer', permission: { columns: '*', check: {} } }] }] });
    await dataset('DsV2Nmd1', { version: 2, allow: [{ actions: ['read'], from: { user: 'usr_reader' } }, { actions: ['insert'], from: { user: 'usr_writer' } }] });
  });
}, 60_000);
afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

const run = async (...args: string[]) => {
  try {
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', SCRIPT, '--database', `pglite://${path.join(dir, 'pglite')}`, ...args], { cwd: ROOT, env: { ...process.env, DATABASE_URL: 'postgres://never-used.invalid/db' } });
    return { code: 0, stdout };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
};
const stored = () => withDb(async (db) => ({
  policies: (await db.query<{ id: string; version: string | null; policy_revision: number; access: string }>("SELECT id,dataset_policy->>'version' AS version,policy_revision,access FROM artifacts ORDER BY id")).rows,
  shares: (await db.query('SELECT artifact_id,email,role FROM artifact_shares ORDER BY email')).rows,
}));

it('dry run, apply and rerun through the script on a disposable database', async () => {
  const before = await stored();
  const json = path.join(dir, 'report.json');

  const dry = await run('--json', json);
  expect(dry).toMatchObject({ code: 0 });
  expect(dry.stdout).toContain('Dataset policy migration (dry-run): 3 datasets scanned');
  expect(dry.stdout).toMatch(/DsV2Nmd1 v2 planned read_named_user\[usr_reader\] write_named_user\[usr_writer\] share editor:usr_writer,viewer:usr_reader/);
  expect(dry.stdout).not.toContain('@example.test');
  expect(JSON.parse(fs.readFileSync(json, 'utf8'))).toMatchObject({ mode: 'dry-run', scanned: 3, counts: { outcome: { planned: 3 } } });
  expect(await stored()).toEqual(before);

  const apply = await run('--apply');
  expect(apply).toMatchObject({ code: 0 });
  expect(apply.stdout).toContain('outcome: migrated=3');
  expect(await stored()).toEqual({
    policies: [
      { id: 'DsNone01', version: '3', policy_revision: 1, access: 'readwrite' },
      { id: 'DsV1Wrt1', version: '3', policy_revision: 2, access: 'read' },
      { id: 'DsV2Nmd1', version: '3', policy_revision: 2, access: 'readwrite' },
    ],
    shares: [
      { artifact_id: 'DsV2Nmd1', email: 'reader@example.test', role: 'viewer' },
      { artifact_id: 'DsV2Nmd1', email: 'writer@example.test', role: 'editor' },
    ],
  });

  const again = await run('--apply');
  expect(again).toMatchObject({ code: 0 });
  expect(again.stdout).toContain('outcome: already_v3=3');

  expect(await run('--apply', '--dry-run')).toMatchObject({ code: 2 });
}, 120_000);
