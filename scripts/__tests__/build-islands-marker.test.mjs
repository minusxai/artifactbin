/**
 * The `--cache` marker must survive a workspace version bump and nothing else: a workspace's version line in
 * package-lock.json resolves no dependency, and hashing it raw rebuilt every island (~30 s per job, "this
 * build added 0 B") in every test shard.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { toolHash } from '../build/build-islands.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const withLock = (edit, check) => {
  const root = mkdtempSync(path.join(tmpdir(), 'islands-marker-'));
  try {
    const lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
    edit(lock);
    writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
    check(toolHash(root));
  } finally { rmSync(root, { recursive: true, force: true }); }
};

describe('the island build marker', () => {
  it('ignores a workspace version bump in the lockfile', () => {
    withLock((lock) => { lock.packages['services/app'].version = '999.0.0'; }, (hash) => expect(hash).toBe(toolHash()));
  });
  it('still rebuilds when a resolved dependency moves', () => {
    withLock((lock) => {
      const dependency = Object.keys(lock.packages).find((name) => name.startsWith('node_modules/') && lock.packages[name].version);
      lock.packages[dependency].version += '-moved';
    }, (hash) => expect(hash).not.toBe(toolHash()));
  });
});
