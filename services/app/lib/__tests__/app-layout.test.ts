/**
 * P3b-X SEED — RED at handoff. The app is a package under services/app, the
 * `@/*` alias points there, the lean entry knows no local engine, and the lean
 * image asserts its own shape at build time. Layout facts only: no server boots.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

const MOVED = ['app', 'lib', 'server', 'web', 'components', 'orchestrator', 'skills', 'public', 'auth.ts', 'test'];

describe('the app lives in services/app (P3b-X seed)', () => {
  it('1. is a package with exact pins', () => {
    const pkg = JSON.parse(read('services/app/package.json')) as { name: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(pkg.name).toBe('@artifactbin/app');
    const loose = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(([, v]) => /^[\^~]/.test(v));
    expect(loose).toEqual([]);
  });

  it('2. moved: nothing of the app is left at the root', () => {
    expect(MOVED.filter((p) => exists(p))).toEqual([]);
    expect(MOVED.filter((p) => !exists(path.join('services/app', p)))).toEqual([]);
  });

  it('3. the @/* alias points at services/app in tsconfig, vite and vitest', () => {
    const ts = JSON.parse(read('tsconfig.json')) as { compilerOptions: { paths: Record<string, string[]> } };
    expect(ts.compilerOptions.paths['@/*']).toEqual(['./services/app/*']);
    expect(read('vite.config.mts')).toMatch(/'services\/app'/);
    expect(read('vitest.config.ts')).toMatch(/'services\/app'/);
  });

  it('4. the lean entry imports no local engine or browser', () => {
    const src = read('services/app/src/main.ts');
    expect(src).not.toMatch(/\/local['"]/);
    expect(src).not.toMatch(/@artifactbin\/(sql|browser)/);
    expect(src).toMatch(/SQL__SERVICE_URL/);
    expect(src).toMatch(/BROWSER__SERVICE_URL/);
  });

  it('5. the lean image asserts its own shape', () => {
    const df = read('services/app/Dockerfile');
    expect(df).toMatch(/-w services\/app/);
    for (const a of ['test ! -e node_modules/@duckdb', 'test ! -e node_modules/playwright', 'test ! -e node_modules/playwright-core',
      'test ! -e node_modules/@artifactbin/sql', 'test ! -e node_modules/@artifactbin/browser', 'test -d node_modules/react', 'test -d node_modules/@artifactbin/utils']) {
      expect(df, a).toContain(a);
    }
    expect(df).toMatch(/^HEALTHCHECK/m);
  });

  it('6. the test setup enforces the cwd contract first', () => {
    const setup = read('services/app/test/setup/vitest.setup.ts').split('\n').filter((l) => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'));
    expect(setup.find((l) => /^import/.test(l) === false)).toMatch(/process\.chdir\(.*services\/app/);
  });

  it('7. the full image probes DuckDB without assuming the host architecture', () => {
    const df = read('Dockerfile');
    expect(df).not.toContain('@duckdb/node-bindings-linux-x64/libduckdb.so');
    expect(df).toContain("require('@duckdb/node-api')");
  });

  it('8. every OSS runtime image drops root before starting the service', () => {
    for (const file of ['Dockerfile', 'services/app/Dockerfile', 'services/proxy/Dockerfile', 'services/sql/Dockerfile', 'services/browser/Dockerfile']) {
      expect(read(file), file).toMatch(/^USER node$/m);
    }
  });

  it('9. app images provision the default local object store for the unprivileged user', () => {
    for (const file of ['Dockerfile', 'services/app/Dockerfile']) {
      const dockerfile = read(file);
      expect(dockerfile, file).toContain('/app/.artifact-objects');
      expect(dockerfile, file).toMatch(/chown[^\n]*node:node[^\n]*\/app\/\.artifact-objects/);
    }
  });
});
