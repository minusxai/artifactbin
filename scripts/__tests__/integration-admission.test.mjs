/** Fast-lane regression: exercise Vitest's actual admission policy with cheap stand-ins for server boots.
 * Three file workers must not multiply into five simultaneous server boots each. No server, DB or browser starts.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
it('admits one concurrent integration case per worker without losing cases', () => {
  mkdirSync(path.join(root, 'tmp'), { recursive: true });
  const dir = mkdtempSync(path.join(root, 'tmp/integration-admission-'));
  try {
    writeFileSync(path.join(dir, 'vitest.config.mjs'), `
import source from '../../vitest.config.ts';
const integration = source.test.projects.find(project => project.test.name === 'integration');
export default { test: { root: ${JSON.stringify(dir)}, include: ['probe.test.mjs'],
  maxWorkers: 1, ...(integration.test.maxConcurrency === undefined ? {} : { maxConcurrency: integration.test.maxConcurrency }) } };
`);
    writeFileSync(path.join(dir, 'probe.test.mjs'), `
import { afterAll, expect, it } from 'vitest';
let active = 0, finished = 0;
it.concurrent.each([1,2,3,4,5,6,7])('boot case %s', async () => {
  active++;
  try { await new Promise(setImmediate); expect(active).toBe(1); }
  finally { active--; finished++; }
});
afterAll(() => expect(finished).toBe(7));
`);
    const run = spawnSync(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', path.join(dir, 'vitest.config.mjs')], { cwd: root, encoding: 'utf8', timeout: 20_000 });
    expect(run.error).toBeUndefined();
    expect(run.status, run.stdout + run.stderr).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('keeps both secret precedence cases and fresh-database bearer coverage in integration', () => {
  const config = readFileSync(path.join(root, 'vitest.config.ts'), 'utf8');
  expect(config).toContain("'scripts/__tests__/app-only-auth.test.mjs'");
  const source = readFileSync(path.join(root, 'scripts/__tests__/app-only-auth.test.mjs'), 'utf8');
  expect(source).toContain("['AUTH__SECRET', 'CONTRACT__ACTOR_SECRET']");
  expect(source).toContain('expect(bearer.status).toBe(200)');
  expect(source).toContain("expect(await bearer.json()).toMatchObject({ user: null })");
});

it('runs the canonical overlap proof in the provisioned real-database lane without an optional database URL', () => {
  const config = readFileSync(path.join(root, 'vitest.config.ts'), 'utf8');
  const file = 'services/app/lib/analytics/__tests__/canonical-totals-postgres.test.ts';
  const realDatabases = config.match(/const REAL_DATABASE_TESTS = \[([\s\S]*?)\];/)?.[1];
  expect(realDatabases).toContain(`'${file}'`);
  expect(config).toMatch(/exclude: \[[\s\S]*?\.\.\.REAL_DATABASE_TESTS/);
  expect(config).toMatch(/name: 'integration'[\s\S]*?include: \[[\s\S]*?\.\.\.REAL_DATABASE_TESTS/);
  const source = readFileSync(path.join(root, file), 'utf8');
  expect(source).not.toMatch(/ANALYTICS_TEST_DATABASE_URL|describe\.skip|describe\.skipIf/);
  expect(source).toContain("'127.0.0.1::5432'");
  expect(source).toContain("'postgres:17-alpine'");
  const ci = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  expect(ci).toMatch(/integration:[\s\S]*?docker pull postgres:17-alpine[\s\S]*?npm run test:integration/);
});
