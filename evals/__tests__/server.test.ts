/**
 * The environment a per-leg product server boots with. Pure — the spawn itself
 * is exercised by the eval run.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { devOutboxPath, serverDataDir, serverEnv, serverPorts, startServer } from '../lib/server';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('serverPorts', () => {
  it('gives each leg a server port and a proxy port beside it', () => {
    expect(serverPorts(3100, 0)).toEqual({ server: 3100, proxy: 3101 });
    expect(serverPorts(3100, 2)).toEqual({ server: 3104, proxy: 3105 });
  });
});

describe('serverEnv', () => {
  const base = { PATH: '/usr/bin', HOME: '/home/u', ANTHROPIC_API_KEY: 'k1', FIREWORKS_API_KEY: 'k2', RANDOM: 'x' };
  const env = serverEnv({ base, ports: { server: 3100, proxy: 3101 }, dataDir: '/tmp/leg', repoRoot: REPO_ROOT, extra: {} });

  it('strips every provider key — the product never needs them and every child would inherit them', () => {
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.FIREWORKS_API_KEY).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
    expect(env.RANDOM).toBe('x');
  });

  it('makes the PROXY the public base URL (the start link is minted from it) and keeps the exporter on the server itself', () => {
    expect(env.APP__PUBLIC_BASE_URL).toBe('http://127.0.0.1:3101');
    expect(env.EXPORT__INTERNAL_ORIGIN).toBe('http://127.0.0.1:3100');
    expect(env.APP__PORT).toBe('3100');
    expect(env.HOSTNAME).toBe('127.0.0.1');
  });

  it('isolates state: in-memory database, a per-leg object dir, and its own auth secret', () => {
    expect(env.DATABASE_URL).toBe('pglite://memory');
    expect(env.OBJECT_STORE__LOCAL_DIR).toBe('/tmp/leg/objects');
    expect(env.AUTH__SECRET).toBeTruthy();
    expect(env.EMAIL__RESEND_API_KEY).toBeTruthy();
    expect(env.NODE_ENV).toBe('production');
  });

  it('applies config extras last', () => {
    const withExtra = serverEnv({ base, ports: { server: 3100, proxy: 3101 }, dataDir: '/tmp/leg', repoRoot: REPO_ROOT, extra: { QUOTA__ARTIFACTS_PER_TOKEN: '0' } });
    expect(withExtra.QUOTA__ARTIFACTS_PER_TOKEN).toBe('0');
  });

  /**
   * THE POLICY FILE IS AN ABSOLUTE PATH, AND THE CHILD'S CWD IS NOT WHERE IT WOULD BE FOUND.
   *
   * `startServer` spawns the bundle with `cwd: <repo>/services/app` (the bundle resolves `dist/web` and
   * `public/` against it), so a RELATIVE `PROXY__RATE_LIMIT_CONFIG_FILE` resolves to
   * `services/app/services/proxy/dev_rate_limits.yml` — which does not exist, and the loader refuses the
   * boot rather than quietly meeting requests with numbers nobody chose. That is the loader working; the
   * bug was handing it a path that depends on a cwd this driver deliberately does not control. It cost the
   * four "agent smoke" jobs on PR #32, and no unit test could see it because the env builder was handed a
   * relative literal and asked only whether it came back unchanged.
   *
   * So the RUNNER resolves it, against the repo root it already knows, and the test asks the filesystem.
   */
  it('hands the server an ABSOLUTE policy-file path that EXISTS — a relative one resolves under the child\'s cwd and refuses the boot', () => {
    expect(path.isAbsolute(env.PROXY__RATE_LIMIT_CONFIG_FILE!)).toBe(true);
    expect(env.PROXY__RATE_LIMIT_CONFIG_FILE).toBe(path.join(REPO_ROOT, 'services/proxy/dev_rate_limits.yml'));
    expect(fs.existsSync(env.PROXY__RATE_LIMIT_CONFIG_FILE!), `${env.PROXY__RATE_LIMIT_CONFIG_FILE} does not exist`).toBe(true);
  });

  it('and a RELATIVE one in the config extras is resolved too, not passed through', () => {
    // config.json is edited by hand; the guarantee must not depend on it holding an absolute path.
    const relative = serverEnv({
      base, ports: { server: 3100, proxy: 3101 }, dataDir: '/tmp/leg', repoRoot: REPO_ROOT,
      extra: { PROXY__RATE_LIMIT_CONFIG_FILE: 'services/proxy/dev_rate_limits.yml' },
    });
    expect(relative.PROXY__RATE_LIMIT_CONFIG_FILE).toBe(path.join(REPO_ROOT, 'services/proxy/dev_rate_limits.yml'));
    expect(fs.existsSync(relative.PROXY__RATE_LIMIT_CONFIG_FILE!)).toBe(true);
    // an absolute one is left exactly as given
    const abs = serverEnv({
      base, ports: { server: 3100, proxy: 3101 }, dataDir: '/tmp/leg', repoRoot: REPO_ROOT,
      extra: { PROXY__RATE_LIMIT_CONFIG_FILE: path.join(REPO_ROOT, 'services/proxy/selfhost_rate_limits.yml') },
    });
    expect(abs.PROXY__RATE_LIMIT_CONFIG_FILE).toBe(path.join(REPO_ROOT, 'services/proxy/selfhost_rate_limits.yml'));
  });
});

/**
 * WHICH SERVER A LEG BOOTS. It was `.next/standalone/server.js` — a build that
 * does not exist any more, so every leg died before its agent ran (the CI smoke
 * job, on the first run after Next was removed). The build the product ships is
 * the bundled `dist/proxy-server.mjs`, run from the repo root the way the image
 * runs it, which also retires the standalone overlay dance: the bundle carries
 * its dependencies, so there are no partially-traced packages to symlink over.
 */
describe('the build a leg boots', () => {
  it('names the bundled server, and says so when it is not built', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-server-'));
    await expect(
      startServer({ repoRoot: empty, env: { APP__PORT: '3199' }, logPath: path.join(empty, 'log') }),
    ).rejects.toThrow(/dist\/proxy-server\.mjs/);
  });
});

/**
 * A LOCAL server has no inbox, so it writes its login mail to the dev outbox the gates read
 * (`services/proxy/src/mail.ts` — a localhost origin always uses the file, which is why the public base
 * URL above matters). That file is what lets the driver log in against a server it booted itself; the
 * Resend key stays a dummy so a local server can never send anything.
 */
describe('the local server can send login mail to a file', () => {
  it('serverEnv names a dev outbox under the data dir and never a real Resend key', () => {
    // (the seeded call named parameters `serverEnv` does not have — corrected to the real signature,
    // assertions unchanged)
    const env = serverEnv({ base: {}, ports: { server: 3100, proxy: 3101 }, dataDir: '/tmp/eval-data', repoRoot: REPO_ROOT, extra: {} });
    expect(env.EMAIL__DEV_OUTBOX_PATH).toMatch(/^\/tmp\/eval-data\//);
    expect(env.EMAIL__RESEND_API_KEY).toBe('eval-no-mail');
  });
  it('names the same file the driver reads the code from — one definition, two readers', () => {
    const env = serverEnv({ base: {}, ports: { server: 3100, proxy: 3101 }, dataDir: serverDataDir('/tmp/leg'), repoRoot: REPO_ROOT, extra: {} });
    expect(env.EMAIL__DEV_OUTBOX_PATH).toBe(devOutboxPath(serverDataDir('/tmp/leg')));
    expect(env.OBJECT_STORE__LOCAL_DIR).toBe('/tmp/leg/server/objects');
  });
});
