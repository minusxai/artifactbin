/**
 * Repository-file rules that are not about the images: the lockfile's own consistency, and the ESM
 * discipline the test runner hides from you. Moved out of the app's vitest suite, which the import
 * graph could never connect them to.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

/** The repository root — these tests read the repository, not any one package. */
const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

describe('lockfile-orphans', () => {

  describe('package-lock.json', () => {
    it('carries nothing that no declared dependency reaches', () => {
      const lock = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'));
      const nameOf = (p) => p.slice(p.lastIndexOf('node_modules/') + 'node_modules/'.length);
      const byName = new Map();
      for (const [p, meta] of Object.entries(lock.packages)) {
        if (p.includes('node_modules/')) byName.set(nameOf(p), [...(byName.get(nameOf(p)) ?? []), meta]);
      }

      // Roots: the workspace package.jsons the lock itself records.
      const stack = [];
      for (const [p, meta] of Object.entries(lock.packages)) {
        if (p.includes('node_modules/')) continue;
        stack.push(...Object.keys(meta.dependencies ?? {}), ...Object.keys(meta.devDependencies ?? {}), ...Object.keys(meta.optionalDependencies ?? {}));
      }
      const reached = new Set();
      while (stack.length) {
        const name = stack.pop();
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
});

describe('esm-globals', () => {
  const ROOT = REPO_ROOT;
  /** Where node runs this package's own code. `web/` is the browser's. */
  const TREES = ['services/app/app', 'services/app/components', 'evals', 'services/app/lib', 'scripts', 'services/app/server', 'services/contracts', 'services/utils', 'services/sql', 'services/browser', 'services/proxy'];
  const SKIP = new Set(['node_modules', 'dist', '__tests__', 'data', 'public']);

  function sources(dir, out = []) {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry) || entry.startsWith('.')) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) sources(full, out);
      // `.cjs` is CommonJS by extension and keeps all three.
      else if (/\.(ts|tsx|mts|mjs)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  describe('the ESM globals a CommonJS habit reaches for', () => {
    it('nothing outside a test uses __dirname, __filename or a bare require()', () => {
      const offenders = TREES.flatMap((t) => sources(path.join(ROOT, t)))
        .filter((f) => /(?<![\w.])(__dirname|__filename)\b|(?<![\w.])require\s*\(/.test(readFileSync(f, 'utf8')))
        .map((f) => path.relative(ROOT, f));
      expect(offenders, 'these die with a ReferenceError outside vitest').toEqual([]);
    });
  });
});
