import { spawn } from 'node:child_process';
import path from 'node:path';

import { declaredPort, loadDotEnv, resolveHmrPort, resolvePort } from './dev-env.mjs';
import { nextAvailableDevelopmentPair, unavailableDevelopmentPorts } from './dev-ports.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const APP_ROOT = path.join(ROOT, 'services', 'app');

/**
 * Shared process plumbing for the co-hosted and app-only development CLIs.
 * The entrypoints retain policy; this helper keeps their port warning,
 * story-runtime prebuild, environment shaping, and child lifecycle identical.
 *
 * @param {{ appOnly: boolean, args?: string[] }} options
 */
export async function runDev({ appOnly, args = [] }) {
  loadDotEnv();
  const port = resolvePort();
  const hmrPort = resolveHmrPort(port);

  const unavailable = await unavailableDevelopmentPorts(port, hmrPort);
  if (unavailable.length > 0) {
    const pair = await nextAvailableDevelopmentPair(port);
    const roles = unavailable.map((value) => `${value}${value === port ? ' (app)' : ' (HMR)'}`).join(', ');
    console.error(`[dev] Port ${roles} unavailable.${pair ? ` Choose a free pair with: npm run setup -- --yes --port ${pair.appPort}` : ' No adjacent app/HMR pair is available.'}`);
    process.exitCode = 1;
    return;
  }

  const declared = declaredPort();
  if (declared && declared !== port) {
    console.warn(`⚠ binding :${port} but PUBLIC_BASE_URL says :${declared} — links the app emits will point at :${declared}`);
  }

  const env = {
    ...process.env,
    // One dependable mailbox for a human or coding agent even when somebody
    // else owns the dev-server terminal. Never persisted in .env.
    EMAIL__DEV_OUTBOX_PATH: path.join(ROOT, '.artifactbin', 'dev-mail.jsonl'),
  };
  delete env.EMAIL__RESEND_BASE_URL;
  if (appOnly) {
    const carried = ['SQL__SERVICE_URL', 'BROWSER__SERVICE_URL'].filter((name) => env[name] !== undefined);
    for (const name of carried) delete env[name];
    if (carried.length > 0) {
      console.log(`[dev:app] ${carried.join(' and ')} set in the environment — dev:app runs the LOCAL sql + browser instead (unset for this child)`);
    }
  }

  const runtime = spawn('node', ['scripts/build-story-runtime.mjs'], { cwd: APP_ROOT, stdio: 'inherit' });
  await new Promise((resolve) => runtime.on('exit', resolve));

  const nodeEnv = appOnly && process.env.NODE_ENV === 'test'
    ? 'development'
    : (process.env.NODE_ENV ?? 'development');
  const child = spawn(
    'npx',
    ['tsx', path.join(ROOT, 'server.ts'), ...(appOnly ? ['--app-only'] : args)],
    {
      cwd: APP_ROOT,
      stdio: 'inherit',
      env: { ...env, APP__PORT: String(port), NODE_ENV: nodeEnv },
    },
  );
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
}
