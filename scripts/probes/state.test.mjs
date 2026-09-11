import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { migrate, stage, recover, digest } from './state.mjs';

const fixture = async (fn) => { const root = await mkdtemp(join(tmpdir(), 'afbin-state-probe-')); try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); } };
test('legacy migration is private, idempotent and never overwrites new credentials', () => fixture(async root => {
  await writeFile(join(root, '.artifactbin.env'), 'ARTIFACTBIN_TOKEN=fixture_old\n');
  assert.equal(await migrate(root), 'migrated');
  assert.equal((await stat(join(root, '.artifactbin'))).mode & 0o777, 0o700);
  assert.equal((await stat(join(root, '.artifactbin/.env'))).mode & 0o777, 0o600);
  await writeFile(join(root, '.artifactbin/.env'), 'ARTIFACTBIN_TOKEN=fixture_new\n');
  assert.equal(await migrate(root), 'existing');
  assert.match(await readFile(join(root, '.artifactbin/.env'), 'utf8'), /fixture_new/);
  assert.match(await readFile(join(root, '.artifactbin.env'), 'utf8'), /fixture_old/);
}));
test('simultaneous migrations publish at most once', () => fixture(async root => {
  await writeFile(join(root, '.artifactbin.env'), 'fixture');
  const results = await Promise.all([migrate(root), migrate(root)]);
  assert.equal(results.filter(x => x === 'migrated').length, 1);
}));
for (const crash of [0, 1, 2]) test(`SIGKILL after ${crash} files recovers binary and skill as one journaled operation`, () => fixture(async root => {
  await writeFile(join(root, 'binary'), 'old-binary');
  await writeFile(join(root, 'skill'), 'old-skill');
  const files = ['binary', 'skill'].map(name => ({ path: name, before: digest('old-' + name), data: 'new-' + name, sha256: digest('new-' + name) }));
  await stage(root, files);
  const child = spawnSync(process.execPath, [new URL('./state.mjs', import.meta.url).pathname, root, String(crash)], { stdio: 'ignore' });
  assert.equal(child.signal, 'SIGKILL');
  await recover(root);
  assert.equal(await readFile(join(root, 'binary'), 'utf8'), 'new-binary');
  assert.equal(await readFile(join(root, 'skill'), 'utf8'), 'new-skill');
  assert.equal(await recover(root), 'clean');
}));
test('bad checksum and a later local edit are refused without overwriting', () => fixture(async root => {
  await writeFile(join(root, 'skill'), 'old');
  await assert.rejects(stage(root, [{ path: 'skill', before: digest('old'), data: 'new', sha256: 'wrong' }]), /checksum/);
  assert.equal(await readFile(join(root, 'skill'), 'utf8'), 'old');
  await stage(root, [{ path: 'skill', before: digest('old'), data: 'new', sha256: digest('new') }]);
  await writeFile(join(root, 'skill'), 'user-edited');
  await assert.rejects(recover(root), /changed/);
  assert.equal(await readFile(join(root, 'skill'), 'utf8'), 'user-edited');
}));
test('journal refuses a symlinked parent that would escape the installation root', () => fixture(async root => {
 const { symlink } = await import('node:fs/promises');
 await fixture(async outside => {
  await symlink(outside,join(root,'linked'));
  await assert.rejects(stage(root,[{path:'linked/skill',before:null,data:'new',sha256:digest('new')}]), /symlink/);
 });
}));
