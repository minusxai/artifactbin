/** Same-checkout evidence for explicit parent-agent reuse, never CI coverage.
 * Normal checks always execute. --reuse accepts only a recent successful receipt
 * for identical sources, command, environment, runtime and installed lock state.
 * This boundary assumes lockfile-managed dependencies: after manually modifying
 * ignored dependencies or external state, execute without --reuse.
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const sha = value => createHash('sha256').update(value).digest('hex');
const GENERATED = ['services/app/public/islands', 'services/app/lib/build-assets', 'services/app/public/fonts',
  'services/app/public/libraries', 'services/app/lib/data/story/story-font-manifest.json', 'services/cli/dist', 'services/cli/src/generated/teaching.json'];
function descendants(root, file) {
  const full = path.join(root, file);
  if (!existsSync(full)) return [file];
  if (!lstatSync(full).isDirectory()) return [file];
  return [file, ...readdirSync(full).sort().flatMap(name => descendants(root, path.join(file, name)))];
}
/** Tracked sources are identified by git's index (blob ids, no file reads); only files that differ
 * from it (modified, deleted or untracked) and the explicit settings files are read. Generated outputs
 * are identified by their stat: every rebuild rewrites them. */
export function fingerprint({ root, commands, env, refs = [] }) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 << 20 });
  const list = args => git(args).split('\0').filter(Boolean);
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ root, commands, env: Object.entries(env).sort(([a], [b]) => a.localeCompare(b)),
    runtime: [process.execPath, process.version, process.platform, process.arch],
    refs: refs.map(ref => git(['rev-parse', '--verify', ref]).trim()) }));
  hash.update(git(['ls-files', '--stage', '-z']));
  const read = [...new Set([...list(['diff', '--name-only', '-z']), ...list(['ls-files', '--others', '--exclude-standard', '-z']),
    ...readdirSync(root).filter(file => /^\.env(?:\.|$)/.test(file)),
    'services/app/.env', 'node_modules/.package-lock.json', '.npmrc'])].sort();
  for (const file of read) {
    hash.update(file + '\0');
    const full = path.join(root, file);
    try {
      const stat = lstatSync(full);
      hash.update(`${stat.mode}\0`);
      if (stat.isSymbolicLink()) hash.update(readlinkSync(full));
      else if (stat.isFile()) hash.update(readFileSync(full));
    } catch (error) { if (error.code !== 'ENOENT') throw error; hash.update('missing'); }
  }
  for (const file of GENERATED.flatMap(file => descendants(root, file))) {
    try { const s = lstatSync(path.join(root, file)); hash.update(JSON.stringify([file, s.mode, s.size, s.mtimeMs])); }
    catch { hash.update('missing:' + file); }
  }
  // Reinstalling even the same lock establishes new local dependency state.
  for (const file of ['node_modules', 'node_modules/.package-lock.json']) {
    try { const s = lstatSync(path.join(root, file)); hash.update(JSON.stringify([file, s.ino, s.mtimeMs, s.ctimeMs])); }
    catch { hash.update('missing:' + file); }
  }
  return hash.digest('hex');
}

/** Runs the commands concurrently; a lone command streams, several print their buffered output in order. */
async function runCommands(commands, { root, env }) {
  const stream = commands.length === 1;
  const results = await Promise.all(commands.map(([command, ...args]) => new Promise(resolve => {
    const chunks = [];
    const child = spawn(command, args, { cwd: root, env, stdio: stream ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
    if (!stream) { child.stdout.on('data', chunk => chunks.push(chunk)); child.stderr.on('data', chunk => chunks.push(chunk)); }
    child.on('error', error => resolve({ status: 1, output: Buffer.concat([...chunks, Buffer.from(error.message + '\n')]) }));
    child.on('close', (code, signal) => resolve({ status: code ?? (signal ? 1 : 0), output: Buffer.concat(chunks) }));
  })));
  for (const { output } of results) if (output.length) process.stdout.write(output);
  return results.find(result => result.status !== 0)?.status ?? 0;
}

export async function runCheck({ root, label, commands, env = process.env, refs = [], reuse = false }) {
  const options = { root, commands, env, refs };
  const folder = path.join(root, '.artifactbin/checks');
  mkdirSync(folder, { recursive: true });
  const receiptPath = path.join(folder, sha(JSON.stringify([label, commands])) + '.json');
  const before = fingerprint(options);
  let receipt;
  try { receipt = JSON.parse(readFileSync(receiptPath, 'utf8')); } catch { /* no valid receipt */ }
  if (reuse && !env.CI && receipt?.fingerprint === before && receipt.status === 0
    && Date.now() - receipt.finishedAt >= 0 && Date.now() - receipt.finishedAt < 60 * 60 * 1000) {
    console.log(`[check] Reused ${label}: passed at ${new Date(receipt.finishedAt).toISOString()} (${receipt.durationMs}ms).`);
    console.log(`[check] Same checkout and inputs; evidence: ${receiptPath}. This is prior evidence, not a new run or branch-wide CI.`);
    return 0;
  }
  rmSync(receiptPath, { force: true });
  const startedAt = Date.now();
  const status = await runCommands(commands, { root, env });
  if (status !== 0) return status;
  const after = fingerprint(options);
  if (before === after) {
    const temporary = `${receiptPath}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ label, commands, fingerprint: after, status: 0,
      finishedAt: Date.now(), durationMs: Date.now() - startedAt }, null, 2));
    renameSync(temporary, receiptPath);
    console.log(`[check] Saved ${label} evidence (${Date.now() - startedAt}ms); --reuse can reuse it for one hour.`);
  } else console.log('[check] Inputs changed during verification; no reusable evidence saved.');
  return 0;
}
