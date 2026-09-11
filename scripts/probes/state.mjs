// Planning prototype: journaled local replacement, with real crash/restart probes.
import { mkdir, readFile, open, rename, link, unlink, chmod, lstat } from 'node:fs/promises';
import { join, dirname, resolve, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const digest = data => createHash('sha256').update(data).digest('hex');
const missing = error => { if (error.code !== 'ENOENT') throw error; return null; };
const read = path => readFile(path, 'utf8').catch(missing);
async function syncDir(path) { const fd = await open(path, 'r'); try { await fd.sync(); } finally { await fd.close(); } }
async function atomic(path, data, noClobber = false) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  const fd = await open(temp, 'wx', 0o600);
  try { await fd.writeFile(data); await fd.sync(); } finally { await fd.close(); }
  try {
    if (noClobber) { await link(temp, path); await unlink(temp); }
    else await rename(temp, path);
    await syncDir(dirname(path));
  } finally { await unlink(temp).catch(missing); }
}
export async function migrate(home) {
  const dir = join(home, '.artifactbin');
  const target = join(dir, '.env');
  if (await read(target) !== null) return 'existing';
  const prior = await read(join(home, '.artifactbin.env'));
  if (prior === null) return 'absent';
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  try { await atomic(target, prior, true); return 'migrated'; }
  catch (error) { if (error.code === 'EEXIST') return 'existing'; throw error; }
}
async function target(root, path) {
  const resolved = resolve(root, path), rel = relative(root, resolved);
  if (!rel || rel.startsWith('..') || path.startsWith('/')) throw Error('outside root');
  let cursor = resolve(root);
  for (const part of rel.split('/')) { cursor = join(cursor, part); const info = await lstat(cursor).catch(missing); if (info?.isSymbolicLink()) throw Error('symlink destination'); }
  return resolved;
}
export async function stage(root, files) {
  for (const file of files) {
    await target(root, file.path);
    if (digest(file.data) !== file.sha256) throw Error('checksum mismatch');
  }
  await atomic(join(root, 'pending.json'), JSON.stringify(files), true);
}
export async function recover(root, crash = -1) {
  const path = join(root, 'pending.json'), pending = await read(path);
  if (pending === null) return 'clean';
  const files = JSON.parse(pending);
  let count = 0;
  const interrupt = () => { if (count === crash) process.kill(process.pid, 'SIGKILL'); };
  interrupt();
  for (const file of files) {
    const destination = await target(root, file.path), current = await read(destination);
    if (digest(file.data) !== file.sha256) throw Error('checksum mismatch');
    if (current === null || digest(current) !== file.sha256) {
      if ((current === null ? null : digest(current)) !== file.before) throw Error('file changed after staging');
      await atomic(destination, file.data);
    }
    count++; interrupt();
  }
  await unlink(path); await syncDir(root);
  return 'recovered';
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await recover(process.argv[2], Number(process.argv[3]));
}
