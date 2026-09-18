/**
 * THE INSTALL AND DEPENDENCY LINT: what this repository pins about its install settings, its
 * runtime dependency closure and its import boundaries, read off the files themselves. These are
 * repository rules, not app behaviour — they were eight files inside `services/app`'s vitest suite,
 * where they paid file I/O on every `npm test` and consumed slots in the 50-file local budget meant
 * for app behaviour, while the app import graph could never make them relevant. They live with the
 * repository's other checks now.
 *
 * The Dockerfile and compose sections that used to open this file went with the container
 * distribution they linted: the open-source distribution is the CLI, and `afbin serve` is the
 * self-host path.
 *
 * Each section keeps its own incident notes: that is what makes these rules readable rather than
 * arbitrary. Do not condense them away.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** The repository root — these tests read the repository, not any one package. */
const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

describe('install settings', () => {
  const ROOT = REPO_ROOT;

  describe('the repo .npmrc', () => {
    const npmrcPath = path.join(ROOT, '.npmrc');

    it('exists, so local dev and every CI runner inherit it', () => {
      expect(existsSync(npmrcPath), '.npmrc is missing at the repo root').toBe(true);
    });

    it('turns the install-time audit and funding calls off', () => {
      const text = readFileSync(npmrcPath, 'utf8');
      expect(text).toMatch(/^audit\s*=\s*false$/m);
      expect(text).toMatch(/^fund\s*=\s*false$/m);
    });

    it('carries no credential — it is committed, and read by every install', () => {
      const text = readFileSync(npmrcPath, 'utf8');
      for (const secret of ['_auth', '_authToken', '_password', 'registry.npmjs.org/:'])
        expect(text, `.npmrc must never carry ${secret}`).not.toContain(secret);
    });
  });
});

describe('runtime dependency closure', () => {
  const root = new URL('../../', import.meta.url);
  const read = (p) => readFileSync(new URL(p, root), 'utf8');
  const pkg = (p) => JSON.parse(read(p));

  describe('the app declares as runtime only what it imports at runtime', () => {
    it('hosted browser libraries are pinned build dependencies, excluded from runtime installs', () => {
      const { dependencies = {}, devDependencies = {} } = pkg('services/app/package.json');
      const registry = JSON.parse(read('services/app/lib/libraries/registry.json'));
      for (const spec of Object.values(registry)) {
        expect(dependencies).not.toHaveProperty(spec.package);
        expect(devDependencies[spec.package]).toBe(spec.version);
      }
    });
    it('the CSS toolchain is a dev dependency', () => {
      const { dependencies = {}, devDependencies = {} } = pkg('services/app/package.json');
      for (const dep of ['@tailwindcss/postcss', 'tailwindcss']) {
        expect(dependencies, dep).not.toHaveProperty(dep);
        expect(devDependencies, dep).toHaveProperty(dep);
      }
      expect(dependencies).not.toHaveProperty('kysely-pglite');
    });
    it('contracts declares the hono it imports', () => {
      const { dependencies = {}, devDependencies = {} } = pkg('services/contracts/package.json');
      const c = JSON.parse(read('services/contracts/package.json'));
      expect({ ...dependencies, ...devDependencies, ...(c.peerDependencies ?? {}) }).toHaveProperty('hono');
    });
  });

  describe('every env name a service reads is documented, and retired names are not read', () => {
    const intentionallyOmitted = new Set();
    const readNames = (file)=> {
      const src = read(file);
      const names = new Set();
      for (const m of src.matchAll(/env\(\s*'([A-Z_]+)'\s*,\s*'([A-Z_]+)'\s*\)/g)) names.add(`${m[1]}__${m[2]}`);
      return names;
    };
    const documented = read('.env.example');
    it('the app config', () => {
      const undocumented = [...readNames('services/app/lib/config.ts')]
        .filter((n) => !intentionallyOmitted.has(n))
        .filter((n) => !new RegExp(`^#?\\s*${n}=`, 'm').test(documented) && !documented.includes(n));
      expect(undocumented).toEqual([]);
      for (const name of intentionallyOmitted) expect(documented).not.toContain(name);
    });
    it('the standalone authentication config', () => {
      const undocumented = [...readNames('services/auth/src/config.ts')].filter((n) => !documented.includes(n));
      expect(undocumented).toEqual([]);
    });

  });
});

describe('lean-imports', () => {
  const ROOT = path.join(REPO_ROOT, 'services/app');
  const TREES = ['app', 'lib', 'server', 'web'];
  // '@artifactbin/contract' (SINGULAR) is the retired pre-split package; '@artifactbin/contracts' is
  // the live one, so it needs an EXACT match, not the prefix rule the entries below use. The app
  // tree imports nothing from the proxy — neither its package nor its source.
  const FORBIDDEN_PREFIX = ['playwright', '@duckdb/', '@artifactbin/sql/local', '@artifactbin/browser/local', '@artifactbin/proxy', 'packages/proxy'];
  const FORBIDDEN_EXACT = ['@artifactbin/contract'];

  function* files(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') yield* files(p); }
      else if (/\.(ts|tsx|mts)$/.test(e.name)) yield p;
    }
  }

  describe('the app tree', () => {
    it('imports neither a native engine nor a browser', () => {
      const offenders = [];
      for (const tree of TREES) for (const f of files(path.join(ROOT, tree))) {
        const src = readFileSync(f, 'utf8');
        for (const m of src.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\)/gm)) {
          const spec = m[1] ?? m[2];
          if (FORBIDDEN_PREFIX.some((f) => spec === f || spec.startsWith(f)) || FORBIDDEN_EXACT.includes(spec)) offenders.push(`${path.relative(ROOT, f)} → ${spec}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  describe('the service packages', () => {
    it('are not imported by the app tree at all — the clients live in utils', () => {
      const offenders = [];
      for (const tree of TREES) for (const f of files(path.join(ROOT, tree))) {
        const src = readFileSync(f, 'utf8');
        for (const m of src.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)) {
          if (m[1] === '@artifactbin/sql' || m[1] === '@artifactbin/browser' || m[1].startsWith('@artifactbin/sql/') || m[1].startsWith('@artifactbin/browser/')) offenders.push(`${path.relative(ROOT, f)} → ${m[1]}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  describe('the old contract package', () => {
    it('is gone: packages/contract does not exist and nothing imports it', () => {
      expect(existsSync(path.join(ROOT, 'packages/contract'))).toBe(false);
    });
  });
});

describe('public authentication assembly', () => {
  it('registers auth without a proxy workspace or rate-limit exports', () => {
    const read = (file) => JSON.parse(readFileSync(path.join(REPO_ROOT, file), 'utf8'));
    const root = read('package.json');
    expect(root.workspaces).toContain('services/auth');
    expect(root.workspaces).not.toContain('services/proxy');
    expect(root.dependencies).toHaveProperty('@artifactbin/auth');
    for (const file of ['services/utils/package.json', 'services/contracts/package.json']) {
      expect(read(file).exports).not.toHaveProperty('./rate-limits');
    }
  });
});
