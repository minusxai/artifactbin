import { generateTeaching } from './generate-teaching.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
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
  generateTeaching();
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
    console.warn(`⚠ binding :${port} but APP__PUBLIC_BASE_URL says :${declared} — links the app emits will point at :${declared}`);
  }

  const env = {
    ...process.env,
    // One dependable mailbox for a human or coding agent even when somebody
    // else owns the dev-server terminal. Never persisted in .env.
    EMAIL__DEV_OUTBOX_PATH: path.join(ROOT, '.artifactbin', 'dev-mail.jsonl'),

    /*
     * LIVE SESSIONS ON THIS HOST. The session worker is contained by Linux
     * bubblewrap and a cgroup, which a macOS dev machine has neither of — so
     * `afbin sessions` could not run outside CI at all, and every change to the
     * CLI or the skill waited on a release and a deploy to be tried. Off the
     * Linux host, and only in development, the switch defaults on so the local
     * loop simply works. An explicit setting always wins, and production is
     * refused at the service's own boundary regardless of what is written here.
     */
    ...(process.platform !== 'linux' && process.env.BROWSER__SANDBOX === undefined && process.env.NODE_ENV !== 'production'
      ? { BROWSER__SANDBOX: 'none' }
      : {}),
  };
  delete env.EMAIL__RESEND_BASE_URL;
  if (appOnly) {
    const carried = ['SQL__SERVICE_URL', 'BROWSER__SERVICE_URL'].filter((name) => env[name] !== undefined);
    for (const name of carried) delete env[name];
    if (carried.length > 0) {
      console.log(`[dev:app] ${carried.join(' and ')} set in the environment — dev:app runs the LOCAL sql + browser instead (unset for this child)`);
    }
  }

  const build = (script) => new Promise((resolve, reject) => {
    const run = spawn('node', [script, '--cache'], { cwd: APP_ROOT, stdio: 'inherit' });
    run.once('error', reject);
    run.once('exit', (code) => resolve(code ?? 1));
  });
  const [serverStatus, islandsStatus] = await Promise.all([build('scripts/build-server-reader.mjs'), build(ISLANDS_BUILD)]);
  if (serverStatus !== 0 || islandsStatus !== 0) { process.exitCode = 1; return; }
  watchServerSources();
  watchIslandSources();

  const nodeEnv = appOnly && process.env.NODE_ENV === 'test'
    ? 'development'
    : (process.env.NODE_ENV ?? 'development');
  const child = spawn(
    'npx',
    /*
     * LIVE. `tsx watch` restarts the server when any file it imports changes —
     * the document renderer, the chrome CSS the server inlines, a route. The
     * server SSR and offline assets are rebuilt by the watcher below.
     */
    // node_modules is excluded by name: Vite bundles its config into
    // node_modules/.vite-temp on every boot, and a watcher that sees that file
    // appear and vanish restarts forever.
    ['tsx', 'watch', '--clear-screen=false', '--include', 'public/islands/manifest.json',
      '--exclude', path.join(ROOT, 'node_modules/**'), '--exclude', '**/.vite-temp/**',
      path.join(ROOT, 'server.ts'), ...(appOnly ? ['--app-only'] : args)],
    {
      cwd: APP_ROOT,
      stdio: 'inherit',
      env: { ...env, APP__PORT: String(port), NODE_ENV: nodeEnv },
    },
  );
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
}

/**
 * The sources used by server SSR and the offline editor. Rebuild their assets
 * when one changes, then let tsx restart the server from the changed bundle.
 */
const RUNTIME_SOURCES = ['lib/story-runtime', 'lib/story-ui', 'lib/story', 'lib/offline', 'lib/viz', 'lib/data/story', 'components/kit', 'components/offline'];

function watchServerSources() {
  let timer = null;
  let building = false;
  let again = false;
  const rebuild = () => {
    if (building) { again = true; return; }
    building = true;
    console.log('[dev] server reader source changed — rebuilding server assets');
    const run = spawn('node', ['scripts/build-server-reader.mjs', '--cache'], { cwd: APP_ROOT, stdio: 'inherit' });
    run.on('exit', () => {
      building = false;
      if (again) { again = false; rebuild(); }
    });
  };
  const onChange = (_event, file) => {
    if (!file || !/\.(tsx?|css|mjs|json)$/.test(String(file)) || String(file).includes('__tests__')) return;
    clearTimeout(timer);
    timer = setTimeout(rebuild, 250);
  };
  for (const dir of RUNTIME_SOURCES) {
    const full = path.join(APP_ROOT, dir);
    if (fs.existsSync(full)) fs.watch(full, { recursive: true }, onChange);
  }
}

/**
 * The compiled reader's shared island build (scripts/build-islands.mjs → public/islands): the island
 * runtime, the Solid kit and the behaviour chunks. A change under their sources rebuilds it, debounced
 * and serialised like the runtime above; the new manifest (a new compiler build id, so every stored
 * compile recompiles) restarts the server through tsx's watch list.
 */
const ISLANDS_BUILD = path.join(ROOT, 'scripts/build-islands.mjs');
const ISLAND_SOURCES = ['lib/islands'];

function watchIslandSources() {
  let timer = null;
  let building = false;
  let again = false;
  const rebuild = () => {
    if (building) { again = true; return; }
    building = true;
    console.log('[dev] island source changed — rebuilding public/islands');
    const run = spawn('node', [ISLANDS_BUILD, '--cache'], { cwd: APP_ROOT, stdio: 'inherit' });
    run.on('exit', () => {
      building = false;
      if (again) { again = false; rebuild(); }
    });
  };
  const onChange = (_event, file) => {
    if (!file || !/\.(tsx?|css|mjs|json)$/.test(String(file)) || String(file).includes('__tests__')) return;
    clearTimeout(timer);
    timer = setTimeout(rebuild, 250);
  };
  for (const dir of ISLAND_SOURCES) {
    const full = path.join(APP_ROOT, dir);
    if (fs.existsSync(full)) fs.watch(full, { recursive: true }, onChange);
  }
}
