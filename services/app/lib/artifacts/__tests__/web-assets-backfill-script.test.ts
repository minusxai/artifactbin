/**
 * THE WEB ASSETS BACKFILL SCRIPT AS PRODUCTION RUNS IT: scripts/backfill-web-assets.ts bundled by esbuild with the
 * options its header documents (only `pg` and PGLite left external), run by plain node against a disposable PGLite
 * directory holding the schema the server boots and two pages written before meta.webAssets: a dry run writes
 * nothing, `--apply` fills both, a rerun finds nothing left; output is ids and counts only.
 */
// harness-exempt: reset the script runs in a child process against an on-disk PGLite directory, which this file seeds and reopens itself
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { PGlite } from '@electric-sql/pglite';
import { build } from 'esbuild';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { urlHash } from '@/lib/document';
import { SCHEMA_STATEMENTS } from '@/lib/platform';

const ROOT = path.resolve(import.meta.dirname, '../../../../..');
const IMAGE = 'https://images.example.test/secret-name.png';
let dir: string, bundle: string;

async function withDb<T>(fn: (db: PGlite) => Promise<T>): Promise<T> {
  const db = new PGlite(path.join(dir, 'pglite'));
  try { return await fn(db); } finally { await db.close(); }
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-assets-backfill-'));
  // Inside the repository, so the externals resolve from its node_modules as they do from the image's /runtime.
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  bundle = path.join(fs.mkdtempSync(path.join(ROOT, 'tmp', 'backfill-')), 'backfill-web-assets.mjs');
  await build({ entryPoints: [path.join(ROOT, 'scripts/backfill-web-assets.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node22',
    external: ['pg', '@electric-sql/pglite'], outfile: bundle, logLevel: 'silent', tsconfig: path.join(ROOT, 'tsconfig.json') });
  await withDb(async (db) => {
    for (const statement of SCHEMA_STATEMENTS) await db.query(statement);
    await db.query("INSERT INTO users (id,email,kind) VALUES ('usr_owner','owner@example.test','account')");
    for (const [id, source] of [['PageImg1', `<img src="${IMAGE}">`], ['PageTxt1', '<p>Secret title</p>']])
      await db.query("INSERT INTO artifacts (id,user_id,creator_user_id,format,source,meta,visibility,edit_id) VALUES ($1,'usr_owner','usr_owner','html',$2,'{}'::jsonb,'public',$3)", [id, source, `edit_${id}`]);
  });
}, 60_000);
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  if (bundle) fs.rmSync(path.dirname(bundle), { recursive: true, force: true });
});

const run = async (...args: string[]) => {
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [bundle, '--database', `pglite://${path.join(dir, 'pglite')}`, ...args], { cwd: ROOT });
    return { code: 0, stdout };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
};
const stored = () => withDb(async (db) => (await db.query<{ id: string; web_assets: unknown }>("SELECT id, meta->'webAssets' AS web_assets FROM artifacts ORDER BY id")).rows);

it('dry run, apply and rerun through the bundled script on a disposable database', async () => {
  const dry = await run();
  expect(dry).toEqual({ code: 0, stdout: 'chunk 1: PageImg1..PageTxt1 scanned=2 planned=2 with_assets=1\nweb assets backfill (dry-run): scanned=2 planned=2 with_assets=1 changed=0 remaining=2\n' });
  expect(await stored()).toEqual([{ id: 'PageImg1', web_assets: null }, { id: 'PageTxt1', web_assets: null }]);

  const apply = await run('--apply', '--chunk', '1');
  expect(apply).toEqual({ code: 0, stdout: [
    'chunk 1: PageImg1..PageImg1 scanned=1 written=1 with_assets=1', 'chunk 2: PageTxt1..PageTxt1 scanned=1 written=1 with_assets=0',
    'web assets backfill (apply): scanned=2 written=2 with_assets=1 changed=0 remaining=0', ''].join('\n') });
  expect(await stored()).toEqual([{ id: 'PageImg1', web_assets: [urlHash(IMAGE)] }, { id: 'PageTxt1', web_assets: [] }]);

  expect(await run('--apply')).toEqual({ code: 0, stdout: 'web assets backfill (apply): scanned=0 written=0 with_assets=0 changed=0 remaining=0\n' });
  expect((await run('--bogus')).code).toBe(2);
}, 60_000);
