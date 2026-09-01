/**
 * Production's two durable-identity inputs are startup contracts: fail before
 * a listener exists, while development keeps the zero-config boot used on a
 * fresh checkout. Drive the real composition entry as a child process because
 * importing it cannot observe process exit or socket binding honestly.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const APP_ROOT = path.join(ROOT, 'services', 'app');
const SERVER_TS = path.join(ROOT, 'server.ts');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'boot-env-'));

type BootOutcome = {
  kind: 'exited' | 'listened' | 'timed-out';
  code: number | null;
  output: string;
};

async function availablePort(offset: number): Promise<number> {
  const configuredBase = Number(process.env.ARTIFACTBIN_TEST_PORT_BASE);
  if (Number.isInteger(configuredBase) && configuredBase > 0) return configuredBase + offset;
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
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
  const child = spawn(TSX, [SERVER_TS], {
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
    child.once('exit', (code) => finish({ kind: 'exited', code, output }));
    const probe = setInterval(() => {
      void fetch(`http://127.0.0.1:${port}/health`).then(async (response) => {
        if (response.ok && child.exitCode === null) {
          // stdout can arrive just after the health response on a busy runner.
          await new Promise((resolve) => setTimeout(resolve, 50));
          finish({ kind: 'listened', code: child.exitCode, output });
        }
      }).catch(() => undefined);
    }, 100);
    const deadline = setTimeout(() => finish({ kind: 'timed-out', code: child.exitCode, output }), 20_000);
  });

  if (child.exitCode === null) child.kill('SIGTERM');
  return outcome;
}

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('production boot environment', () => {
  it('exits before listening when AUTH__SECRET is absent', async () => {
    const port = await availablePort(0);
    const result = await runBoot(port, {
      NODE_ENV: 'production',
      APP__PUBLIC_BASE_URL: `http://localhost:${port}`,
    });

    expect(result.kind).toBe('exited');
    expect(result.code).toBe(1);
    expect(result.output).toContain('[boot] AUTH__SECRET is required in production (sessions and the agent cookie must survive a restart). Generate one: openssl rand -base64 32 — or run: npm run setup');
  });

  it('exits before listening when APP__PUBLIC_BASE_URL is absent', async () => {
    const result = await runBoot(await availablePort(1), {
      NODE_ENV: 'production',
      AUTH__SECRET: 'test-production-secret',
    });

    expect(result.kind).toBe('exited');
    expect(result.code).toBe(1);
    expect(result.output).toContain('[boot] APP__PUBLIC_BASE_URL is required in production (every published link is minted from it). Set it to the URL people reach this on.');
  });

  it('boots in development with both production-only names absent', async () => {
    const port = await availablePort(2);
    const result = await runBoot(port, { NODE_ENV: 'development' });

    expect(result.kind).toBe('listened');
    expect(result.output).toContain('[boot] AUTH__SECRET unset — generated per boot');
    expect(result.output).toContain(`[boot] proxy + app on http://localhost:${port} (dev, db pglite)`);
  });
});
