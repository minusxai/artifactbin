/**
 * A SERVER THAT SERVES EVERY DOCUMENT ON ITS OWN ORIGIN (APP__PAGES_HOST=lvh.me), for the gates that need one.
 *
 * The gate runner's servers boot without the setting, so a gate that frames documents boots its own production
 * server (dist/server.mjs, as scripts/gates.mjs does) with `APP__PAGES_HOST=lvh.me` and the app at
 * `http://app.lvh.me:<port>` — unless the base it is handed already serves pages (a developer's
 * `npm run setup -- --pages-host` dev server), which it then drives. `*.lvh.me` is mapped to loopback in Chromium
 * (`browserArgs`) and in this process (node's dns.lookup), so no DNS is needed.
 *
 *   const pages = await pagesServer(process.argv[2], 'frame-editor');
 *   // pages.app, pages.port, pages.origin(id), pages.browserArgs, pages.booted; pages.stop() on exit (also automatic)
 */
import { spawn } from 'node:child_process';
import dns from 'node:dns';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const PAGES_HOST = 'lvh.me';

// ── *.lvh.me is loopback, in this process too (the container may have no DNS) ──
const originalLookup = dns.lookup;
dns.lookup = function lookup(hostname, options, callback) {
  if (typeof hostname === 'string' && (hostname === PAGES_HOST || hostname.endsWith(`.${PAGES_HOST}`))) {
    const cb = typeof options === 'function' ? options : callback;
    const all = typeof options === 'object' && options?.all;
    process.nextTick(() => (all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)));
    return {};
  }
  return originalLookup.call(this, hostname, options, callback);
};

/** The DNS label a document id rides as (lib/serving/pages-origin pagesLabel). */
export const pagesLabel = (id) => Buffer.from(id, 'utf8').toString('hex');

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.on('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

/** Does the server on this port serve pages at lvh.me? Its apex answers `invalid_next` to a bare exchange. */
export async function servesPages(port) {
  try {
    const res = await fetch(`http://${PAGES_HOST}:${port}/pages-session?next=x`, { signal: AbortSignal.timeout(3000) });
    return res.status === 400 && (await res.json().catch(() => ({}))).error === 'invalid_next';
  } catch { return false; }
}

export async function pagesServer(given, name) {
  let child = null;
  let scratch = null;
  const stop = () => { if (child && child.exitCode === null) child.kill('SIGKILL'); if (scratch) rmSync(scratch, { recursive: true, force: true }); scratch = null; };
  process.on('exit', stop);
  const url = given ? new URL(given) : null;
  const givenPort = url ? Number(url.port || (url.protocol === 'https:' ? 443 : 80)) : null;
  let port = givenPort && await servesPages(givenPort) ? givenPort : null;
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
        APP__PAGES_HOST: PAGES_HOST,
        APP__ASSETS_ORIGIN: '',
        AUTH__SECRET: process.env.AUTH__SECRET || `gate-${name}-${Date.now()}`,
        DATABASE_URL: 'pglite://memory',
        SQL__SERVICE_URL: '', BROWSER__SERVICE_URL: '', EVENTS__SERVICE_URL: '',
        EXPORT__INTERNAL_ORIGIN: `http://127.0.0.1:${port}`,
        OBJECT_STORE__LOCAL_DIR: objects,
        ARTIFACTS__ALLOW_PUBLIC: '1',
        EMAIL__DEV_OUTBOX_PATH: process.env.EMAIL__DEV_OUTBOX_PATH,
      },
    });
    let up = false;
    for (let i = 0; i < 120 && !up; i++) {
      if (child.exitCode !== null) throw new Error(`the ${name} server exited with ${child.exitCode}`);
      up = await servesPages(port);
      if (!up) await new Promise((r) => setTimeout(r, 500));
    }
    if (!up) throw new Error(`the ${name} server never answered`);
  }
  return {
    port,
    app: `http://app.${PAGES_HOST}:${port}`,
    origin: (id) => `http://${pagesLabel(id)}.${PAGES_HOST}:${port}`,
    browserArgs: [`--host-resolver-rules=MAP *.${PAGES_HOST} 127.0.0.1, MAP ${PAGES_HOST} 127.0.0.1`],
    booted: !!child,
    stop,
  };
}
