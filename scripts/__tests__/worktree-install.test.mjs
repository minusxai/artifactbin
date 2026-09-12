import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureDependencies } from '../lib/worktree-install.mjs';

function fixture(test) {
  const root = mkdtempSync(path.join(tmpdir(), 'worktree-install-'));
  const calls = [];
  const put = (name, text) => { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), text); };
  put('package.json', JSON.stringify({ workspaces: [] })); put('package-lock.json', '{}'); put('.npmrc', 'audit=false');
  const run = (cmd, args) => { calls.push([cmd, ...args]); put('node_modules/.package-lock.json', '{}'); return { status: 0 }; };
  try { test({ root, calls, put, run }); } finally { rmSync(root, { recursive: true, force: true }); }
}
describe('worktree dependencies', () => {
  it('installs the pinned lock once, reuses it, and reinstalls on lock changes', () => fixture(({ root, calls, put, run }) => {
    ensureDependencies(root, run); ensureDependencies(root, run);
    expect(calls.filter(c => c[0] === 'npm')).toEqual([['npm', 'ci']]);
    put('package-lock.json', '{"changed":true}'); ensureDependencies(root, run);
    expect(calls.filter(c => c[0] === 'npm')).toHaveLength(2);
  }));
  it('propagates installation failures and never caches them', () => fixture(({ root, calls, run }) => {
    expect(() => ensureDependencies(root, () => ({ status: 7 }))).toThrow(/install/i);
    ensureDependencies(root, run);
    expect(calls[0]).toEqual(['npm', 'ci']);
  }));
  it('invalidates missing or changed installed dependency state', () => fixture(({ root, calls, put, run }) => {
    ensureDependencies(root, run); put('node_modules/.package-lock.json', '{"changed":true}');
    ensureDependencies(root, run);
    expect(calls.filter(c => c[0] === 'npm')).toHaveLength(2);
  }));
});
