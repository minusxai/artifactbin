/**
 * THE LOCKFILE MAY NOT CARRY WHAT NOTHING NEEDS.
 *
 * `next` was removed from `package.json` and stayed in the lockfile, so
 * `npm ci` kept installing it — 155 MB of framework, plus `sharp` and its 23
 * platform binaries (Next's image optimiser), `styled-jsx`, `client-only` and
 * eight `@next/swc-*`. Every one of them shipped in the image. Nothing
 * referenced them: `better-auth` names `next` as an OPTIONAL peer, but no
 * matching package appears in the lock; the entries were simply left behind.
 *
 * A dependency the lockfile installs but nothing declares is invisible in
 * review — package.json reads clean — so the check is against the SOURCE OF
 * TRUTH: every package in the lock must be reachable from a declared
 * dependency of the root or a workspace.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface LockEntry {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

describe('package-lock.json', () => {
  it('carries nothing that no declared dependency reaches', () => {
    const lock = JSON.parse(readFileSync(path.resolve(__dirname, '../../../../package-lock.json'), 'utf8')) as {
      packages: Record<string, LockEntry>;
    };
    const nameOf = (p: string) => p.slice(p.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const byName = new Map<string, LockEntry[]>();
    for (const [p, meta] of Object.entries(lock.packages)) {
      if (p.includes('node_modules/')) byName.set(nameOf(p), [...(byName.get(nameOf(p)) ?? []), meta]);
    }

    // Roots: the workspace package.jsons the lock itself records.
    const stack: string[] = [];
    for (const [p, meta] of Object.entries(lock.packages)) {
      if (p.includes('node_modules/')) continue;
      stack.push(...Object.keys(meta.dependencies ?? {}), ...Object.keys(meta.devDependencies ?? {}), ...Object.keys(meta.optionalDependencies ?? {}));
    }
    const reached = new Set<string>();
    while (stack.length) {
      const name = stack.pop()!;
      if (reached.has(name)) continue;
      reached.add(name);
      for (const meta of byName.get(name) ?? []) {
        stack.push(...Object.keys(meta.dependencies ?? {}), ...Object.keys(meta.optionalDependencies ?? {}));
        // npm records and installs a satisfiable optional peer by default
        // (nunjucks → chokidar is one). If it is present, it is reachable;
        // if absent, adding its name to the traversal has no package to admit.
        stack.push(...Object.keys(meta.peerDependencies ?? {}));
      }
    }
    // Workspace links (`packages/*`) appear under node_modules by name too.
    const workspaces = new Set(Object.keys(lock.packages).filter((p) => !p.includes('node_modules/') && p).map((p) => p));
    const orphans = [...byName.keys()]
      .filter((n) => !reached.has(n))
      .filter((n) => !workspaces.has(`packages/${n.split('/').pop()}`) && !n.startsWith('@artifactbin/'));

    expect(orphans, 'in the lockfile, reachable from nothing — `npm ci` installs these anyway').toEqual([]);
  });
});
