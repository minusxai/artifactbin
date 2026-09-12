/** Worktree installation boundary. Reuse requires our own successful receipt,
 * matching install inputs and npm's installed lock. Postinstall assets belong to
 * the checkout, so refresh them even when dependencies can be reused.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const digest = value => createHash('sha256').update(value).digest('hex');
export function ensureDependencies(root, run = spawnSync) {
  const read = name => existsSync(path.join(root, name)) ? readFileSync(path.join(root, name)) : Buffer.from('missing');
  const workspace = JSON.parse(read('package.json').toString()).workspaces ?? [];
  const inputs = ['package.json', 'package-lock.json', '.npmrc', ...workspace.map(w => `${w}/package.json`),
    'services/app/scripts/copy-assets.mjs', 'services/cli/scripts/prepare-pty.mjs'];
  const key = digest(Buffer.concat([Buffer.from(JSON.stringify([process.version, process.platform, process.arch])),
    ...inputs.map(name => Buffer.concat([Buffer.from(name + '\0'), read(name)]))]));
  const receiptPath = path.join(root, 'node_modules/.cache/artifactbin-install.json');
  const installed = () => digest(read('node_modules/.package-lock.json'));
  let receipt;
  try { receipt = JSON.parse(readFileSync(receiptPath, 'utf8')); } catch { /* cold install */ }
  const checked = (cmd, args) => {
    const result = run(cmd, args, { cwd: root, stdio: 'inherit' });
    if (result.error || result.status !== 0) throw new Error(`Dependency install/setup failed (${result.status ?? result.error?.message}): ${cmd} ${args.join(' ')}`);
  };
  if (receipt?.key === key && existsSync(path.join(root, 'node_modules/.package-lock.json')) && receipt.installed === installed()) {
    console.log('[worktree] Reusing pinned dependencies; refreshing checkout assets.');
    for (const script of ['services/app/scripts/copy-assets.mjs', 'services/cli/scripts/prepare-pty.mjs']) {
      if (existsSync(path.join(root, script))) checked(process.execPath, [script]);
    }
    return;
  }
  rmSync(receiptPath, { force: true });
  checked('npm', ['ci']);
  mkdirSync(path.dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, JSON.stringify({ key, installed: installed() }));
}
