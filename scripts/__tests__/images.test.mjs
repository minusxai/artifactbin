/**
 * THE IMAGE LINT: everything this repository pins about its Dockerfiles, its compose files and its
 * install layers, read off the files themselves. These are repository rules, not app behaviour —
 * they were eight files inside `services/app`'s vitest suite, where they paid file I/O on every
 * `npm test` and consumed slots in the 50-file local budget meant for app behaviour, while the app
 * import graph could never make them relevant. They live with the repository's other checks now.
 *
 * Each section keeps its own incident notes: that is what makes these rules readable rather than
 * arbitrary. Do not condense them away.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import yaml from 'yaml';

/** The repository root — these tests read the repository, not any one package. */
const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

describe('dockerfile-copies-root-files', () => {
  const APP_ROOT_FILES = ['services/app/auth.ts', 'server.ts', 'vite.config.mts', 'services/app/postcss.config.mjs', 'tsconfig.json'];
  const ROOT = REPO_ROOT;

  describe('Dockerfile', () => {
    const dockerfile = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    const copied = dockerfile
      .split('\n')
      .filter((l) => /^COPY /.test(l) && !l.includes('--from='))
      .join(' ');

    it.each(APP_ROOT_FILES)('copies %s into the builder', (file) => {
      expect(copied).toContain(file);
    });
  });

  /**
   * Runtime shape of the images themselves. Moved here from the retired app-layout
   * placement seed, whose layout archaeology is gone but whose image pins are not.
   */
  describe('every runtime image', () => {
    const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

    it('probes DuckDB without assuming the host architecture', () => {
      const df = read('Dockerfile');
      expect(df).not.toContain('@duckdb/node-bindings-linux-x64/libduckdb.so');
      expect(df).toContain("require('@duckdb/node-api')");
    });

    it('drops root before starting the service', () => {
      for (const file of ['Dockerfile', 'services/app/Dockerfile', 'services/proxy/Dockerfile', 'services/sql/Dockerfile', 'services/browser/Dockerfile']) {
        expect(read(file), file).toMatch(/^USER node$/m);
      }
    });

    it('provisions the default local object store for the unprivileged user in the app images', () => {
      for (const file of ['Dockerfile', 'services/app/Dockerfile']) {
        const dockerfile = read(file);
        expect(dockerfile, file).toContain('/app/.artifact-objects');
        expect(dockerfile, file).toMatch(/chown[^\n]*node:node[^\n]*\/app\/\.artifact-objects/);
      }
    });
  });
});

describe('docker-build-inputs', () => {
  const ROOT = path.join(REPO_ROOT, 'services/app');
  const dockerfile = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  /** The scripts/ files the image's build command runs, transitively through npm. */
  function scriptsNeededByBuild() {
    const seen = new Set();
    const out = [];
    const walk = (name) => {
      if (seen.has(name)) return;
      seen.add(name);
      const body = pkg.scripts[name];
      if (!body) return;
      for (const m of body.matchAll(/scripts\/[\w.-]+\.(?:mjs|cjs|js|ts)/g)) out.push(m[0]);
      // npm runs pre<name>/post<name> around it, and `npm run x` chains
      for (const m of body.matchAll(/npm run ([\w:-]+)/g)) walk(m[1]);
      walk(`pre${name}`);
      walk(`post${name}`);
    };
    walk('build');
    return [...new Set(out)];
  }

  /** Paths the builder stage makes available before `npm run build` runs. */
  const copiedInBuilder = (p)=> {
    const dir = p.split('/')[0]; // e.g. "scripts"
    return (
      dockerfile.includes('COPY services ./services') ||
      dockerfile.includes(`COPY ${p} `) ||
      new RegExp(`^COPY ${dir} `, 'm').test(dockerfile) ||
      new RegExp(`^COPY ${dir}/ `, 'm').test(dockerfile)
    );
  };

  describe('the image can run npm run build', () => {
    it('finds at least the runtime build step (the scan is not vacuous)', () => {
      expect(scriptsNeededByBuild()).toContain('scripts/build-story-runtime.mjs');
    });

    it.each(scriptsNeededByBuild())('copies %s into the builder stage', (p) => {
      expect(copiedInBuilder(p), `Dockerfile never copies ${p}, so the image build cannot run it`).toBe(true);
    });

    it('also copies whatever postinstall needs, before npm ci', () => {
      // `npm ci` triggers postinstall (copy-assets), so its script must land first.
      //
      // This used to be satisfied by `COPY services ./services` sitting above the
      // install, which copied the whole repo to get one file — and made every
      // source edit rebuild the install and re-upload its ~518 MB layer
      // (docker-install-layer.test.ts). The tree now lands AFTER the install, so
      // the postinstall script is named on its own. Its requirement really is
      // just the file: it chdirs to its own package dir and reads node_modules.
      const scriptRunningInstall = dockerfile
        .split(/^FROM /m)
        .map((stage) => stage.split('\n'))
        .find((lines) => lines.some((l) => /^RUN /.test(l) && /npm ci/.test(l) && !l.includes('--ignore-scripts')));
      expect(scriptRunningInstall, 'no stage runs npm ci with its lifecycle scripts').toBeDefined();
      const before = (scriptRunningInstall ?? []).slice(
        0,
        (scriptRunningInstall ?? []).findIndex((l) => /^RUN /.test(l) && /npm ci/.test(l)),
      );
      expect(before.join('\n'), 'the postinstall script must reach the image before the install that runs it').toContain(
        'services/app/scripts/copy-assets.mjs',
      );
    });
  });
});

describe('docker-install-layer', () => {
  const ROOT = REPO_ROOT;

  /** Every Dockerfile in the repo, DISCOVERED — a new service image joins by existing. */
  function dockerfiles() {
    const found = [];
    if (existsSync(path.join(ROOT, 'Dockerfile'))) found.push('Dockerfile');
    for (const entry of readdirSync(path.join(ROOT, 'services'), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const rel = path.join('services', entry.name, 'Dockerfile');
      if (existsSync(path.join(ROOT, rel))) found.push(rel);
    }
    return found;
  }

  /** The workspace manifests `npm ci` reads, from package.json's own globs. */
  const WORKSPACES = (
    JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  ).workspaces;

  /**
   * Each `npm ci` in a Dockerfile, with the COPY lines that precede it IN ITS OWN
   * STAGE — a `FROM` resets what the filesystem holds, so a copy in the builder
   * says nothing about the runtime stage.
   */
  function installsWithPrecedingCopies(rel) {
    const out = [];
    let copies = [];
    readFileSync(path.join(ROOT, rel), 'utf8').split('\n').forEach((text, i) => {
      if (/^FROM /.test(text)) copies = [];
      else if (/^COPY /.test(text)) copies.push(text);
      else if (/^RUN /.test(text) && /(^|\s)npm ci(\s|$)/.test(text)) out.push({ line: i + 1, copies: [...copies] });
    });
    return out;
  }

  describe('every install layer', () => {
    const files = dockerfiles();
    const all = files.flatMap((rel) => installsWithPrecedingCopies(rel).map((i) => ({ rel, ...i })));

    it('finds the installs to judge (the scan is not vacuous)', () => {
      expect(files.length).toBeGreaterThanOrEqual(5);
      expect(all.length).toBeGreaterThanOrEqual(9);
      expect(WORKSPACES.length).toBeGreaterThanOrEqual(6);
    });

    it.each(all.map((i) => [`${i.rel}:${i.line}`, i]))(
      '%s is not preceded by the whole source tree',
      (_name, install) => {
        for (const copy of install.copies)
          expect(
            copy,
            `${_name}: this COPY sits above the install, so every source edit rebuilds it and re-uploads its layer`,
          ).not.toMatch(/^COPY services \.\/services\s*$/);
      },
    );

    it.each(all.map((i) => [`${i.rel}:${i.line}`, i]))(
      '%s gets every workspace manifest first',
      (_name, install) => {
        const copied = install.copies.join('\n');
        expect(copied, `${_name}: the root manifests are what npm ci reads first`).toMatch(/^COPY package/m);
        for (const ws of WORKSPACES)
          expect(copied, `${_name}: npm ci reads ${ws}/package.json and cannot resolve the workspace without it`).toContain(
            `${ws}/package.json`,
          );
      },
    );
  });
});

describe('npm-ci-no-audit', () => {
  const ROOT = REPO_ROOT;

  /** Every Dockerfile in the repo, DISCOVERED — a new service image joins by existing. */
  function dockerfiles() {
    const found = [];
    if (existsSync(path.join(ROOT, 'Dockerfile'))) found.push('Dockerfile');
    const services = path.join(ROOT, 'services');
    for (const entry of readdirSync(services, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const rel = path.join('services', entry.name, 'Dockerfile');
      if (existsSync(path.join(ROOT, rel))) found.push(rel);
    }
    return found;
  }

  /** The `npm ci` invocations of one Dockerfile, as `[line number, text]`. */
  function npmCiLines(rel) {
    return readFileSync(path.join(ROOT, rel), 'utf8')
      .split('\n')
      .map((text, i)=> [i + 1, text])
      // The invocation, never the prose about it: a `#` comment is not a command.
      .filter(([, text]) => /(^|\s)npm ci(\s|$)/.test(text) && !text.trimStart().startsWith('#'));
  }

  describe('every npm ci in every image', () => {
    const files = dockerfiles();

    it('finds the five images (the scan is not vacuous)', () => {
      expect(files).toContain('Dockerfile');
      expect(files.length).toBeGreaterThanOrEqual(5);
      expect(files.flatMap(npmCiLines).length).toBeGreaterThanOrEqual(9);
    });

    it.each(files)('%s passes --no-audit to every npm ci', (rel) => {
      for (const [line, text] of npmCiLines(rel)) {
        expect(
          text,
          `${rel}:${line} runs npm ci without --no-audit — one npm advisory-endpoint outage stalls this build for minutes`,
        ).toContain('--no-audit');
      }
    });
  });

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

describe('lean-closure', () => {
  const root = new URL('../../', import.meta.url);
  const read = (p) => readFileSync(new URL(p, root), 'utf8');
  const pkg = (p) => JSON.parse(read(p));

  describe('the image guard names what each lean image must NOT carry', () => {
    const guard = read('scripts/image-checks.mjs');
    const kind = (name) => guard.slice(guard.indexOf(`  ${name}: {`), guard.indexOf('budgetMB', guard.indexOf(`  ${name}: {`)));
    it('the lean proxy carries no PGLite engine or dialect (28 MB measured), no Vite/Vitest, no React DOM', () => {
      const proxy = kind('proxy');
      for (const dep of ['@electric-sql/pglite', 'kysely-pglite', 'vite', 'vitest', 'react-dom']) expect(proxy, dep).toContain(`'${dep}'`);
    });
    it('the lean app carries no build-time CSS toolchain (Tailwind/PostCSS/lightningcss, 42 MB measured) and no Vite', () => {
      const app = kind('app');
      for (const dep of ['@tailwindcss/postcss', 'tailwindcss', 'lightningcss', 'vite']) expect(app, dep).toContain(`'${dep}'`);
    });
    it('boots protected SQL/browser images with an explicit service credential', () => {
      for (const name of ['sql', 'browser']) expect(kind(name)).toContain('INTERNAL__SERVICE_SECRET');
      expect(guard).toContain('x-artifactbin-service-secret');
    });
    it('binds image probes only inside the assigned 7000-7200 range', () => {
      expect(guard).toContain('7120');
      expect(guard).toContain('7129');
      expect(guard).not.toContain('5220');
    });
  });

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
    const intentionallyOmitted = new Set(['MIXPANEL__TOKEN', 'MIXPANEL__HOST']);
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
    it('the standalone proxy config', () => {
      const undocumented = [...readNames('services/proxy/src/config.ts')].filter((n) => !documented.includes(n));
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

describe('lean-compose-security', () => {
  const root = REPO_ROOT;
  const source = readFileSync(path.join(root, 'docker-compose.lean.yml'), 'utf8');
  const compose = yaml.parse(source);

  describe('lean compose security boundary', () => {
    it('shares one required service credential between app clients and protected services', () => {
      for (const name of ['app', 'sql', 'browser']) {
        expect(compose.services[name].environment.INTERNAL__SERVICE_SECRET).toContain(':?');
      }
    });

    it('separates the published edge, compute services, and database', () => {
      expect(compose.services.proxy.networks).toEqual(expect.arrayContaining(['edge', 'compute', 'db']));
      expect(Object.keys(compose.services.app.networks)).toEqual(expect.arrayContaining(['compute', 'db', 'egress']));
      expect(compose.services.sql.networks).toEqual(['compute']);
      expect(compose.services.browser.networks).toEqual(['compute']);
      expect(compose.services.postgres.networks).toEqual(['db']);
      expect(compose.networks).toMatchObject({ edge: { internal: false }, compute: { internal: true }, db: { internal: true }, egress: { internal: false } });
    });

    it('does not use trust authentication and hardens stateless services', () => {
      expect(source).not.toContain('POSTGRES_HOST_AUTH_METHOD: trust');
      for (const name of ['proxy', 'app', 'sql', 'browser']) {
        expect(compose.services[name]).toMatchObject({ read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'] });
      }
    });
  });
});
