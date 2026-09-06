import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

const script = path.resolve(import.meta.dirname, '../../services/app/public/chat/install.sh');
let tmp, bin, target;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afbin-install-test-'));
  bin = path.join(tmp, 'tools'); target = path.join(tmp, 'install with spaces');
  fs.mkdirSync(bin);
  const payload = '#!/bin/sh\necho afbin-test\n';
  fs.writeFileSync(path.join(tmp, 'binary'), payload);
  const hash = createHash('sha256').update(payload).digest('hex');
  fs.writeFileSync(path.join(tmp, 'SHA256SUMS'), `${hash}  afbin-darwin-arm64\n`);
  fs.writeFileSync(path.join(bin, 'uname'), '#!/bin/sh\ncase "$1" in -s) echo Darwin;; -m) echo arm64;; esac\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/sh
out=''; url=''
while [ "$#" -gt 0 ]; do
 case "$1" in -o|--output) out="$2"; shift;; https://*) url="$1";; esac
 shift
done
case "$url" in */SHA256SUMS) cp "$AFBIN_TEST_DIR/SHA256SUMS" "$out";; */afbin-darwin-arm64) cp "$AFBIN_TEST_DIR/binary" "$out";; *) exit 22;; esac
`, { mode: 0o755 });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));
const run = args => spawnSync('sh', [script, '--dir', target, ...args], {
  encoding: 'utf8', env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, AFBIN_TEST_DIR: tmp },
});
it('installs the verified executable without Node or sudo, including paths with spaces', () => {
  const result = run([]);
  expect(result.status, result.stderr).toBe(0);
  expect(spawnSync(path.join(target, 'afbin'), [], { encoding: 'utf8' }).stdout).toBe('afbin-test\n');
});
it('leaves an existing install untouched when the download has the wrong checksum', () => {
  fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'afbin'), 'existing');
  fs.writeFileSync(path.join(tmp, 'binary'), 'tampered');
  expect(run([]).status).not.toBe(0);
  expect(fs.readFileSync(path.join(target, 'afbin'), 'utf8')).toBe('existing');
});
it('rejects invalid versions before installing', () => {
  expect(run(['--version', '../../unexpected']).status).not.toBe(0);
  expect(fs.existsSync(path.join(target, 'afbin'))).toBe(false);
});
it('rejects unsupported platforms clearly', () => {
  fs.writeFileSync(path.join(bin, 'uname'), '#!/bin/sh\necho unsupported\n', { mode: 0o755 });
  const result = run([]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Unsupported');
});
