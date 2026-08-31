import { spawn } from 'node:child_process';
import path from 'node:path';

import { declaredPort, loadDotEnv, resolvePort } from './dev-env.mjs';

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

  const declared = declaredPort();
  if (declared && declared !== port) {
    console.warn(`⚠ binding :${port} but PUBLIC_BASE_URL says :${declared} — links the app emits will point at :${declared}`);
  }

  const env = { ...process.env };
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
