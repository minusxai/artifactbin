/**
 * The identity-reservation proofs, formerly .github/workflows/reserved-ids-proof.yml (its own runner
 * and an uncached `npm ci` on every identity change). They now run in the `integration` project, in
 * the node job's shard 1, which already pulls `postgres:17-alpine`. Both proofs run unchanged as the
 * child processes the workflow ran; every assertion still lives in the proof scripts themselves.
 */
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const run = promisify(execFile);
// Only what a runner's shell carries, plus the proof's own settings: the test process's environment
// (its PGLite harness, VITEST flags) must not reach the app the proof boots.
const baseEnv = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'SystemRoot'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
const proof = (args, env = {}) => run(process.execPath, ['--import', 'tsx', ...args], {
  cwd: root, env: { ...baseEnv, ...env }, maxBuffer: 16 * 1024 * 1024, timeout: 120_000,
});

it('reserves draft identities across 12 concurrent CLI processes without duplicates or loss', async () => {
  const { stdout } = await proof(['scripts/reserved-ids-local-proof.ts']);
  expect(stdout).toContain('PASS actual registration: 12 processes, 100 unique identities');
}, 150_000);

const dockerAvailable = spawnSync('docker', ['image', 'inspect', 'postgres:17-alpine'], { stdio: 'ignore' }).status === 0;
describe.skipIf(!dockerAvailable)('reserved ids on pooled PostgreSQL (disposable real server)', () => {
  let container = '';
  let url = '';
  beforeAll(async () => {
    container = execFileSync('docker', ['run', '--rm', '-d', '-e', 'POSTGRES_USER=proof', '-e', 'POSTGRES_PASSWORD=proof', '-e', 'POSTGRES_DB=proof', '-p', '127.0.0.1::5432', 'postgres:17-alpine'], { encoding: 'utf8' }).trim();
    const port = Number(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }).trim().split('\n')[0].split(':').at(-1));
    url = `postgres://proof:proof@127.0.0.1:${port}/proof`;
    // Ready on the published port, not just inside the container (the entrypoint restarts the server once).
    for (let attempt = 0; ; attempt++) {
      const ready = spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'proof', '-d', 'proof'], { stdio: 'ignore' }).status === 0;
      if (ready) break;
      if (attempt > 60) throw new Error('postgres:17-alpine never became ready');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }, 60_000);
  afterAll(() => { if (container) execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' }); });

  it('replays one batch, keeps separate batches distinct and lets exactly one competing claim win', async () => {
    const { stdout } = await proof(['-r', './scripts/register-yaml.cjs', 'scripts/reserved-ids-postgres-proof.ts'], {
      NODE_ENV: 'production',
      DATABASE_URL: url,
      APP__PUBLIC_BASE_URL: 'http://app.lvh.me:7445',
      APP__PAGES_HOST: 'lvh.me',
      AUTH__SECRET: 'reserved-identities-disposable-ci-secret',
    });
    const result = JSON.parse(stdout.trim().split('\n').at(-1));
    expect(result).toMatchObject({ passed: true, distinctIds: 900, winners: 1, rollback: true, foreignOwnerRejected: true, ordinaryCollisionRejected: true });
    expect(result.connections).toBeGreaterThan(1);
  }, 150_000);
});
