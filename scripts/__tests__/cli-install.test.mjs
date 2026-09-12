import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

const checkout = path.resolve(import.meta.dirname, '../..');
const script = path.join(checkout, 'services/app/public/chat/install.sh');
const version = JSON.parse(fs.readFileSync(path.join(checkout, 'services/cli/package.json'), 'utf8')).version;
let tmp, bin, home, target;

/**
 * A local release directory stands in for the published one, so the installer's own
 * download, checksum and replacement paths run unchanged from a clean home outside
 * this checkout. Assembling it here is not a published release.
 */
const publish = (release, payload, checksum = createHash('sha256').update(payload).digest('hex')) => {
  const dir = path.join(tmp, 'releases', release);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'afbin-darwin-arm64'), payload);
  fs.writeFileSync(path.join(dir, 'SHA256SUMS'), `${checksum}  afbin-darwin-arm64\n`);
};
const installed = (dir) => spawnSync(path.join(dir, 'afbin'), [], { encoding: 'utf8' }).stdout;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afbin-install-test-'));
  bin = path.join(tmp, 'tools'); home = path.join(tmp, 'clean home'); target = path.join(tmp, 'install with spaces');
  fs.mkdirSync(bin); fs.mkdirSync(home);
  publish(version, '#!/bin/sh\necho afbin-test\n');
  fs.writeFileSync(path.join(bin, 'uname'), '#!/bin/sh\ncase "$1" in -s) echo Darwin;; -m) echo arm64;; esac\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/sh
out=''; url=''
while [ "$#" -gt 0 ]; do
 case "$1" in -o|--output) out="$2"; shift;; https://*) url="$1";; esac
 shift
done
release=\${url%/*}; release=\${release##*/afbin-v}
file=\${url##*/}
[ -f "$AFBIN_TEST_DIR/releases/$release/$file" ] || exit 22
cp "$AFBIN_TEST_DIR/releases/$release/$file" "$out"
`, { mode: 0o755 });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));
const run = (args = [], { dir = target } = {}) => spawnSync('sh', [script, ...(dir ? ['--dir', dir] : []), ...args], {
  encoding: 'utf8', cwd: home, env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, AFBIN_TEST_DIR: tmp },
});
it('installs the verified executable without Node or sudo, including paths with spaces', () => {
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(installed(target)).toBe('afbin-test\n');
});
it('installs into a clean home outside the checkout by default, and names the version it pins', () => {
  const result = run([], { dir: null });
  expect(result.status, result.stderr).toBe(0);
  const destination = path.join(home, '.local', 'bin');
  expect(destination.startsWith(checkout)).toBe(false);
  expect(installed(destination)).toBe('afbin-test\n');
  expect(result.stdout).toContain(`Installed afbin ${version}`);
  expect(result.stdout).toContain('afbin help');
});
it('updates a working installation in place when a newer release is requested', () => {
  expect(run().status).toBe(0);
  publish('9.9.9', '#!/bin/sh\necho afbin-next\n');
  const update = run(['--version', '9.9.9']);
  expect(update.status, update.stderr).toBe(0);
  expect(installed(target)).toBe('afbin-next\n');
  expect(update.stdout).toContain('Installed afbin 9.9.9');
});
it('leaves the working installation untouched when an update has the wrong checksum', () => {
  expect(run().status).toBe(0);
  publish('9.9.9', '#!/bin/sh\necho tampered\n', createHash('sha256').update('something else').digest('hex'));
  const update = run(['--version', '9.9.9']);
  expect(update.status).not.toBe(0);
  expect(update.stderr).toContain('existing installation was not changed');
  expect(installed(target)).toBe('afbin-test\n');
  expect(fs.readdirSync(target)).toEqual(['afbin']);
});
it('leaves an existing install untouched when the download has the wrong checksum', () => {
  fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'afbin'), 'existing');
  publish(version, 'tampered', createHash('sha256').update('afbin').digest('hex'));
  expect(run().status).not.toBe(0);
  expect(fs.readFileSync(path.join(target, 'afbin'), 'utf8')).toBe('existing');
});
it('rejects invalid versions before installing', () => {
  expect(run(['--version', '../../unexpected']).status).not.toBe(0);
  expect(fs.existsSync(path.join(target, 'afbin'))).toBe(false);
});
it('rejects unsupported platforms clearly', () => {
  fs.writeFileSync(path.join(bin, 'uname'), '#!/bin/sh\necho unsupported\n', { mode: 0o755 });
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Unsupported');
});
