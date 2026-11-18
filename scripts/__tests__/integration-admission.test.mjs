/** Fast-lane regression: exercise Vitest's actual admission policy with cheap stand-ins for server boots.
 * Three file workers must not multiply into five simultaneous server boots each. No server, DB or browser starts.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it, onTestFinished } from 'vitest';
import {tempDirSync} from '../../services/test-support/src/temp-dir.ts';
import { serverReaderFresh } from '../../services/app/scripts/server-reader-cache.mjs';

const root = path.resolve(import.meta.dirname, '../..');
it('admits one concurrent integration case per worker without losing cases', () => {
  mkdirSync(path.join(root, 'tmp'), { recursive: true });
  const dir = tempDirSync('integration-admission-', onTestFinished, path.join(root, 'tmp'));
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
});

it('admits one case per worker in both integration projects', async () => {
  const { default: config } = await import('../../vitest.config.ts');
  const projects = config.test.projects.filter(project => /^integration/.test(project.test?.name ?? ''));
  expect(projects.map(project => project.test.name)).toEqual(['integration', 'integration-databases']);
  for (const project of projects) expect(project.test.maxConcurrency, project.test.name).toBe(1);
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
  expect(config).toMatch(/name: 'integration-databases',[^}]*?include: \[[^\]]*?\.\.\.REAL_DATABASE_TESTS/);
  const source = readFileSync(path.join(root, file), 'utf8');
  expect(source).not.toMatch(/ANALYTICS_TEST_DATABASE_URL|describe\.skip|describe\.skipIf/);
  expect(source).toContain("'127.0.0.1::5432'");
  expect(source).toContain("'postgres:17-alpine'");
  const ci = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  expect(ci).toMatch(/integration:[\s\S]*?project: integration-databases[\s\S]*?docker pull postgres:17-alpine[\s\S]*?vitest\.mjs run --project=\$\{\{ matrix\.project \}\}/);
});

it('runs every real-database proof where CI provides its image: no opt-in variable, and a missing image fails there', () => {
  const config = readFileSync(path.join(root, 'vitest.config.ts'), 'utf8');
  const files = [...(config.match(/const REAL_DATABASE_TESTS = \[([\s\S]*?)\];/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(match => match[1]);
  expect(files).toEqual(expect.arrayContaining(['services/events/__tests__/feed-position-postgres.test.ts', 'services/auth/__tests__/oauth-postgres.test.ts', 'services/app/__tests__/region-processes-postgres.test.ts']));
  for (const file of [...files, 'scripts/__tests__/reserved-ids-proof.test.mjs']) {
    const source = readFileSync(path.join(root, file), 'utf8');
    // A variable no workflow sets kept three of these suites from ever running.
    expect(source, file).not.toMatch(/process\.env\.[A-Z_]+/);
    // Skipping is test-support/docker's decision: false locally without the image, a failure under CI.
    expect(source, file).not.toMatch(/['"]image['"],\s*['"]inspect['"]/);
    if (/\b(describe|it)\.(skipIf|runIf)\(/.test(source)) expect(source, file).toContain('dockerImage(');
  }
  const docker = readFileSync(path.join(root, 'services/test-support/src/docker.ts'), 'utf8');
  expect(docker).toMatch(/if \(process\.env\.CI\) throw/);
});

// The S3 suites never ran: gated on TEST_S3_URL, which no job set. Now the databases part starts a real S3-compatible
// server for them, and under CI a missing URL fails the file instead of skipping it.
it('runs the S3 object-store suites in the databases part against a digest-pinned server, and fails them in CI without one', async () => {
  const file = 'services/app/lib/object-store/__tests__/store-s3.test.ts';
  const { default: config } = await import('../../vitest.config.ts');
  const project = (name) => config.test.projects.find(entry => entry.test?.name === name).test;
  expect(project('integration-databases').include).toContain(file);
  expect(project('node').exclude).toContain(file);
  expect(project('integration').include).not.toContain(file);
  const { jobs } = (await import('yaml')).default.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
  const steps = jobs.integration.steps;
  const start = steps.findIndex(step => step.name === 'Start the S3-compatible server and its bucket');
  const run = steps.findIndex(step => /vitest\.mjs run --project=/.test(step.run ?? ''));
  expect(start).toBeGreaterThan(steps.findIndex(step => step.name === 'Wait for the images'));
  expect(start).toBeLessThan(run);
  expect(steps[start].if).toBe('matrix.images');
  for (const step of [steps[0], steps[start]]) expect(step.env.S3_IMAGE).toMatch(/^[\w./-]+:[\w.-]+@sha256:[0-9a-f]{64}$/);
  expect(steps[0].run).toContain('docker pull "$S3_IMAGE"');
  expect(steps[start].run).toContain('curl -fsS -X PUT -o /dev/null http://127.0.0.1:8333/artifactbin-test');
  expect(steps[start].run).toContain(`echo 'TEST_S3_URL=http://test:test@127.0.0.1:8333/artifactbin-test/ci' >> "$GITHUB_ENV"`);
  // Under CI, without the URL, the file fails rather than skips. The two runs are Vitest processes of their own (7s
  // apiece on a pr fast guard runner, the lane's slowest guard test one after the other), so they run side by side.
  const vitest = (env) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--project=integration-databases', file], { cwd: root, timeout: 60_000, env: { ...env, PATH: process.env.PATH, HOME: process.env.HOME } });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
    child.on('error', reject).on('close', (status) => resolve({ status, output }));
  });
  // Each run's global setup rebuilds a stale page runtime into the same files: built here once first, so two side by
  // side never write one file at once (a component change made one read the other's half-written output).
  if (!serverReaderFresh()) spawnSync(process.execPath, [path.join(root, 'services/app/scripts/build-server-reader.mjs'), '--cache'], { cwd: path.join(root, 'services/app'), stdio: 'inherit' });
  const [ci, local] = await Promise.all([vitest({ CI: 'true' }), vitest({})]);
  expect(ci.status, ci.output).toBe(1);
  expect(ci.output).toContain('TEST_S3_URL is not set');
  expect(local.status, local.output).toBe(0);
});
