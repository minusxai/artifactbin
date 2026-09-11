// Exercise the current SEA builder and a minimal lazy-remote-entry prototype.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const cli = resolve('services/cli');
const invoke = (args, env = process.env, cwd = cli) => {
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', timeout: 180000 });
  if (result.status !== 0) throw Error(`command failed (${result.status}): ${result.stderr?.slice(-1500)}`);
  return result;
};
const scratch = await mkdtemp(join(tmpdir(), 'afbin-package-probe-'));
const script = join(cli, 'scripts/.planning-binary.mjs');
try {
  invoke(['scripts/prepare-pty.mjs']);
  const original = await readFile(join(cli, 'scripts/binary.mjs'), 'utf8');
  const patched = original.replace('setup(b) {', `setup(b) {
        b.onLoad({ filter: /src\\/main\\.ts$/ }, async (args) => ({
          contents: (await readFile(args.path, 'utf8'))
            .replace('import { runRemote } from "./runner";', '')
            .replace('await runRemote(', 'await (await import("./runner")).runRemote('),
          loader: 'ts',
        }));`);
  assert.notEqual(patched, original);
  await writeFile(script, patched);
  invoke([script]);
  const binary = join(cli, `dist/afbin-${process.platform}-${process.arch}`);
  const blocker = join(scratch, 'not-a-directory'); await writeFile(blocker, 'block');
  const result = spawnSync(binary, ['--help'], { cwd: scratch, env: { ...process.env, TMPDIR: blocker, TMP: blocker, TEMP: blocker }, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /afbin/);
  invoke(['scripts/test-binary.mjs']);
  console.log(JSON.stringify({ platform: process.platform, arch: process.arch, sea: 'pass', helpWithoutPtyExtraction: 'pass', remotePtyRoundTrip: 'pass' }));
} finally { await rm(script, { force: true }); await rm(scratch, { recursive: true, force: true }); }
