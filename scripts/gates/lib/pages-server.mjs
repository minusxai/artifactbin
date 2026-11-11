/**
 * A SERVER THAT SERVES EVERY DOCUMENT ON ITS OWN ORIGIN (APP__PAGES_HOST=lvh.me), for the gates that need one.
 *
 * `pagesHost` names another pages host for the server it boots: `localhost` serves documents at `<hex id>.localhost`, a
 * site of its own beside the app's `app.lvh.me` (production's shape: Chromium then runs the frame out of process).
 * Chromium and this process resolve `*.localhost` to loopback themselves. A base is driven rather than a server booted
 * only when it already frames documents under that host (its app page's `frame-src` names `*.<host>:<port>`).
 *
 * The gate runner's servers boot without the setting, so a gate that frames documents boots its own production
 * server (dist/server.mjs, as scripts/gates.mjs does) with `APP__PAGES_HOST=lvh.me` and the app at
 * `http://app.lvh.me:<port>` — unless the base it is handed already serves pages (a developer's
 * `npm run setup -- --pages-host` dev server), which it then drives. `*.lvh.me` is mapped to loopback in Chromium
 * (`browserArgs`) and in this process (node's dns.lookup), so no DNS is needed.
 *
 *   const pages = await pagesServer(process.argv[2], 'frame-editor');
 *   const crossSite = await pagesServer(process.argv[2], 'live-regions-oop', { pagesHost: 'localhost' });
 *   const shell = await pagesServer(process.argv[2], 'host-comments', { env: { APP__SHELL_FILE: file }, drives: isShell });
 *   // `env`: settings for the server it boots; a given base is driven only when `drives(base)` says it is set up so.
 *   // pages.app, pages.port, pages.origin(id), pages.browserArgs, pages.booted; pages.stop() on exit (also automatic)
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES_BROWSER_ARGS, PAGES_HOST } from './browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The DNS label a document id rides as (lib/http/pages-origin pagesLabel). */
const pagesLabel = (id) => Buffer.from(id, 'utf8').toString('hex');

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.on('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

/** Does the server on this port serve pages at `host`? Its apex is not a document and answers every path 404 `not_found`. */
async function servesPages(port, host = PAGES_HOST) {
  try {
    const res = await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(3000) });
    return res.status === 404 && (await res.json().catch(() => ({}))).error === 'not_found';
  } catch { return false; }
}
/** Does the app on this port frame documents under `host`? Its pages' `frame-src` says so (another host's apex may 404 alike). */
async function framesPagesAt(port, host) {
  try {
    const res = await fetch(`http://app.${PAGES_HOST}:${port}/login`, { signal: AbortSignal.timeout(3000) });
    const frameSrc = (res.headers.get('content-security-policy') ?? '').split(';').find((directive) => directive.trim().startsWith('frame-src')) ?? '';
    return frameSrc.split(/\s+/).includes(`http://*.${host}:${port}`);
  } catch { return false; }
}

export async function pagesServer(given, name, { pagesHost = PAGES_HOST, env = {}, drives = async () => true } = {}) {
  let child = null;
  let scratch = null;
  const stop = () => { if (child && child.exitCode === null) child.kill('SIGKILL'); if (scratch) rmSync(scratch, { recursive: true, force: true }); scratch = null; };
  process.on('exit', stop);
  const url = given ? new URL(given) : null;
  const givenPort = url ? Number(url.port || (url.protocol === 'https:' ? 443 : 80)) : null;
  let port = givenPort && await servesPages(givenPort, pagesHost) && (pagesHost === PAGES_HOST || await framesPagesAt(givenPort, pagesHost)) && await drives(`http://app.${PAGES_HOST}:${givenPort}`) ? givenPort : null;
  if (!port) {
    const bundle = path.join(ROOT, 'dist/server.mjs');
    if (!existsSync(bundle)) throw new Error(`the ${name} gate boots its own server from dist/server.mjs: run \`npm run build\` first`);
    port = await freePort();
    scratch = mkdtempSync(path.join(os.tmpdir(), `gate-${name}-`));
    const objects = path.join(scratch, 'objects');
    mkdirSync(objects, { recursive: true });
    // A login code is read from the outbox this server writes: the runner's, or our own.
    process.env.EMAIL__DEV_OUTBOX_PATH ??= path.join(scratch, 'dev-mail.jsonl');
    child = spawn(process.execPath, [bundle], {
      cwd: path.join(ROOT, 'services/app'),
      stdio: ['ignore', 'ignore', 'inherit'],
      env: {
        ...process.env,
        NODE_ENV: 'production',
        APP__PORT: String(port),
        APP__PUBLIC_BASE_URL: `http://app.${PAGES_HOST}:${port}`,
        APP__PAGES_HOST: pagesHost,
        APP__ASSETS_ORIGIN: '',
        AUTH__SECRET: process.env.AUTH__SECRET || `gate-${name}-${Date.now()}`,
        DATABASE_URL: 'pglite://memory',
        SQL__SERVICE_URL: '', BROWSER__SERVICE_URL: '', EVENTS__SERVICE_URL: '',
        EXPORT__INTERNAL_ORIGIN: `http://127.0.0.1:${port}`,
        OBJECT_STORE__LOCAL_DIR: objects,
        ARTIFACTS__ALLOW_PUBLIC: '1',
        EMAIL__DEV_OUTBOX_PATH: process.env.EMAIL__DEV_OUTBOX_PATH,
        ...env,
      },
    });
    let up = false;
    for (let i = 0; i < 120 && !up; i++) {
      if (child.exitCode !== null) throw new Error(`the ${name} server exited with ${child.exitCode}`);
      up = await servesPages(port, pagesHost);
      if (!up) await new Promise((r) => setTimeout(r, 500));
    }
    if (!up) throw new Error(`the ${name} server never answered`);
  }
  return {
    port,
    app: `http://app.${PAGES_HOST}:${port}`,
    origin: (id) => `http://${pagesLabel(id)}.${pagesHost}:${port}`,
    browserArgs: PAGES_BROWSER_ARGS,
    booted: !!child,
    stop,
  };
}
