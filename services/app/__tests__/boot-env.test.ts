/**
 * Exercise the real composition entry: an early startup failure, a development
 * listener with logged-out admission, and the listener's occupied-port error.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { freePort } from '@artifactbin/test-support/net';
import { tempDirSync } from '@artifactbin/test-support/temp-dir';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const APP_ROOT = path.join(ROOT, 'services', 'app');
const SERVER_TS = path.join(ROOT, 'server.ts');
const scratch = tempDirSync('boot-env-', afterAll);

type BootOutcome = {
  kind: 'exited' | 'listened' | 'timed-out';
  code: number | null;
  output: string;
  loggedOutStartStatus?: number;
  loggedOutMintStatus?: number;
  guestCookieIssued?: boolean;
};

async function availablePort(offset: number): Promise<number> {
  const configuredBase = Number(process.env.ARTIFACTBIN_TEST_PORT_BASE);
  if (Number.isInteger(configuredBase) && configuredBase > 0) return configuredBase + offset;
  return freePort();
}

function bootEnvironment(port: number, overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  for (const key of ['AUTH__SECRET', 'APP__PUBLIC_BASE_URL', 'DATABASE_URL', 'S3_URL', 'SQL__SERVICE_URL', 'BROWSER__SERVICE_URL']) delete env[key];
  return {
    ...env,
    APP__PORT: String(port),
    DATABASE_URL: 'pglite://memory',
    OBJECT_STORE__LOCAL_DIR: scratch,
    SQL__SERVICE_URL: 'http://127.0.0.1:9',
    BROWSER__SERVICE_URL: 'http://127.0.0.1:9',
    EMAIL__RESEND_API_KEY: 'test-resend-key',
    ...overrides,
  };
}

async function runBoot(port: number, overrides: Record<string, string>): Promise<BootOutcome> {
  // Run the server in the child itself. A CLI wrapper may spawn a grandchild,
  // which survives when a timed-out worker kills only the wrapper.
  const child = spawn(process.execPath, ['--import', 'tsx', SERVER_TS], {
    cwd: APP_ROOT,
    env: bootEnvironment(port, overrides),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout!.on('data', (chunk: Buffer) => { output += chunk; });
  child.stderr!.on('data', (chunk: Buffer) => { output += chunk; });

  const outcome = await new Promise<BootOutcome>((resolve) => {
    let settled = false;
    const finish = (value: BootOutcome): void => {
      if (settled) return;
      settled = true;
      clearInterval(probe);
      clearTimeout(deadline);
      resolve(value);
    };
    // HTTP and stdio are independent: neither a health response nor a child log
    // alone proves that this child has finished starting on the selected port.
    let healthy = false;
    const observeReady = (): void => {
      if (healthy && child.exitCode === null && output.includes(`[boot] auth + app on http://localhost:${port} (`)) {
        finish({ kind: 'listened', code: null, output });
      }
    };
    child.stdout!.on('data', observeReady);
    child.once('close', (code) => finish({ kind: 'exited', code, output }));
    const probe = setInterval(() => {
      void fetch(`http://127.0.0.1:${port}/health`).then((response) => {
        if (response.ok && child.exitCode === null) {
          healthy = true;
          observeReady();
        }
      }).catch(() => undefined);
    }, 100);
    const deadline = setTimeout(() => finish({ kind: 'timed-out', code: child.exitCode, output }), 60_000);
  });

  if (outcome.kind === 'listened') {
    const base = `http://localhost:${port}`;
    const started = await fetch(base + '/api/start', { method: 'POST' });
    outcome.loggedOutStartStatus = started.status;
    outcome.guestCookieIssued = started.headers.getSetCookie().length > 0;
    const minted = await fetch(base + '/api/session/token', { method: 'POST' });
    outcome.loggedOutMintStatus = minted.status;
  }
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    if (child.exitCode === null && child.signalCode === null) {
      const killed = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGKILL');
      await killed;
    }
  }
  return outcome;
}

// Each case boots its own server with its own environment and port, so they boot side by side.
describe.concurrent('application boot', () => {
  it('exits before listening when AUTH__SECRET is absent', async () => {
    const port = await availablePort(0);
    const result = await runBoot(port, {
      NODE_ENV: 'production',
      APP__PUBLIC_BASE_URL: `http://localhost:${port}`,
    });

    expect(result.kind).toBe('exited');
    expect(result.code).toBe(1);
    expect(result.output).not.toContain('[boot] auth + app on');
    expect(result.output).toContain('[boot] AUTH__SECRET is required in production');
  });

  it('boots in development with both production-only names absent', async () => {
    const port = await availablePort(2);
    const result = await runBoot(port, { NODE_ENV: 'development' });

    expect(result.kind, result.output).toBe('listened');
    expect(result.output).toContain('[boot] AUTH__SECRET unset — generated per boot');
    expect(result.output).toContain(`[boot] auth + app on http://localhost:${port} (dev, db pglite)`);
    expect(result.loggedOutStartStatus).toBe(401);
    expect(result.loggedOutMintStatus).toBe(401);
    expect(result.guestCookieIssued).toBe(false);
  }, 90_000);

  it('turns an occupied port into an actionable error without an unhandled stack', async () => {
    const port = await availablePort(3);
    const blocker = net.createServer((socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(port, resolve);
    });
    try {
      const result = await runBoot(port, { NODE_ENV: 'development' });
      expect(result.kind, result.output).toBe('exited');
      expect(result.code).toBe(1);
      expect(result.output).toContain(`[boot] Port ${port} is already in use.`);
      expect(result.output).toContain('npm run setup -- --yes --port <port>');
      expect(result.output).not.toContain("Unhandled 'error' event");
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  }, 90_000);
});
