/**
 * ONE PROCESS PER PGLITE DATA DIRECTORY (lib/platform/db holdDataDir). A server holds its directory; a second process
 * (a test, a script that boots the app, another server) is refused instead of rewriting files under it, and the
 * directory is free again once the holder closes it or dies.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { afterAll, afterEach, expect, it } from 'vitest';
import { configureDb, getDb, resetDb } from '@/lib/platform/db';

const suiteOptions = globalThis.__artifact_bin_db_options__;
const root = mkdtempSync(path.join(tmpdir(), 'afbin-pglite-lock-'));
const dataDir = path.join(root, 'pglite');
const children: ChildProcess[] = [];

/** Another process that opens `dataDir` exactly as a server does, and holds it until killed. */
async function holder(): Promise<ChildProcess> {
  const db = path.resolve(import.meta.dirname, '../db.ts');
  const script = `const {configureDb,getDb}=await import(${JSON.stringify(db)});configureDb({target:{engine:'pglite',dataDir:${JSON.stringify(dataDir)}}});await getDb();process.stdout.write('open\\n');setInterval(()=>{},1<<30);`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
  children.push(child);
  let output = '';
  child.stdout!.setEncoding('utf8');
  await new Promise<void>((ready, failed) => {
    child.stdout!.on('data', (chunk: string) => { output += chunk; if (output.includes('open\n')) ready(); });
    child.once('exit', (code) => failed(new Error(`holder exited (${code}) before opening: ${output}`)));
  });
  return child;
}

afterEach(async () => {
  await resetDb();
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
});

afterAll(async () => {
  configureDb(suiteOptions);
  await resetDb();
  rmSync(root, { recursive: true, force: true });
});

it('refuses a directory another process holds open, and opens it once that process is gone', async () => {
  const server = await holder();
  configureDb({ target: { engine: 'pglite', dataDir } });
  await expect(getDb()).rejects.toThrow(/^database_busy: another process has the PGLite directory .*pglite open/);

  server.kill('SIGKILL'); // a crash: the OS lock goes with the process, nothing to clean up
  await once(server, 'exit');
  const db = await getDb();
  expect((await db.query<{ ok: number }>('SELECT 1 AS ok')).rows).toEqual([{ ok: 1 }]);
}, 60_000);

it('gives the directory back on close, so the same or another process opens it next', async () => {
  configureDb({ target: { engine: 'pglite', dataDir } });
  await getDb();
  await resetDb();
  await getDb(); // the same process, reopened
  await resetDb();
  const next = await holder(); // another process, after this one closed
  expect(next.exitCode).toBeNull();
}, 60_000);
