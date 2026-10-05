/** Legacy URLs delegate to the one npm distribution; prerequisite coverage lives in node-bootstrap. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
const root = path.resolve(import.meta.dirname, '../..');
const script = path.join(root, 'services/app/public/chat/install.sh');
let dir;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'afbin npm wrapper ')); mkdirSync(path.join(dir, 'tools')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const run = (args = [], fail = false) => {
  const bin = path.join(dir, 'tools');
  writeFileSync(path.join(bin, 'curl'), `#!/bin/sh\nwhile [ "$#" -gt 0 ]; do case "$1" in -o) output="$2"; shift;; esac; shift; done\n${fail ? 'exit 22' : `printf 'export PATH="%s:$PATH"\\n' "$AFBIN_TEST_BIN" > "$output"`}\n`, { mode: 0o755 });
  writeFileSync(path.join(bin, 'npx'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$AFBIN_TEST_ARGS"\n', { mode: 0o755 });
  return spawnSync('sh', [script, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: `${bin}:/usr/bin:/bin`, AFBIN_TEST_BIN: bin, AFBIN_TEST_ARGS: path.join(dir, 'args') }, timeout: 10000 });
};
it('prepares Node then delegates setup to npx, without installing a binary', () => {
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(readFileSync(path.join(dir, 'args'), 'utf8')).toBe('--yes\n@afbin/cli@latest\nsetup\n');
  expect(result.stdout).toContain('npx --yes @afbin/cli@latest');
});
it('refuses old binary installer flags with actionable npm instructions', () => {
  const result = run(['--dir', 'legacy-bin']);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Legacy installer flags are no longer supported');
  expect(result.stderr).toContain('npx --yes @afbin/cli@latest setup');
});
it('stops if preparing Node fails, before executing npm', () => {
  const result = run([], true);
  expect(result.status).not.toBe(0);
});
it('Windows wrapper uses npm cmd shims and never changes execution policy', () => {
  const source = readFileSync(path.join(root, 'services/app/public/chat/install.ps1'), 'utf8');
  expect(source).toContain('ensure-node.ps1');
  expect(source).toContain('npx.cmd');
  expect(source).not.toMatch(/Set-ExecutionPolicy|ExecutionPolicy Bypass|afbin-windows/);
});
