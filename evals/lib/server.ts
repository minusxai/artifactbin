/**
 * One product server per LEG, from the prod build (`dist/proxy-server.mjs`), with an
 * in-memory database and its own object dir — so two legs share nothing and a
 * run leaves nothing behind. The product builds every link it mints from the
 * request's Host (`lib/http.ts baseUrl`), so the driver mints the start
 * document THROUGH the proxy and the proxy forwards Host unchanged — that link
 * is how the agent finds the proxy rather than the server behind it, and
 * anything else lets the agent walk past the ledger (found by running it:
 * the first leg made zero proxied requests). `PUBLIC_BASE_URL` is set to the
 * proxy as well for whatever reads it; the exporter's headless browser is
 * pointed straight at the server so its own traffic never lands in the ledger.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface Ports { server: number; proxy: number }

export function serverPorts(portBase: number, legIndex: number): Ports {
  return { server: portBase + legIndex * 2, proxy: portBase + legIndex * 2 + 1 };
}

const PROVIDER_KEY = /_API_KEY$/;

export function serverEnv(opts: { base: Record<string, string | undefined>; ports: Ports; dataDir: string; extra: Record<string, string> }): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.base)) {
    if (v === undefined || PROVIDER_KEY.test(k)) continue;
    env[k] = v;
  }
  return {
    ...env,
    NODE_ENV: 'production',
    APP__PORT: String(opts.ports.server),
    HOSTNAME: '127.0.0.1',
    APP__PUBLIC_BASE_URL: `http://127.0.0.1:${opts.ports.proxy}`,
    EXPORT__INTERNAL_ORIGIN: `http://127.0.0.1:${opts.ports.server}`,
    DATABASE_URL: 'pglite://memory',
    OBJECT_STORE__LOCAL_DIR: path.join(opts.dataDir, 'objects'),
    AUTH__SECRET: crypto.randomBytes(32).toString('base64'),
    EMAIL__RESEND_API_KEY: 'eval-no-mail',
    ...opts.extra,
  };
}

export interface RunningServer { url: string; stop(): Promise<void> }

/**
 * Boot the bundled server and wait until `/docs` answers.
 *
 * It is run from the REPO ROOT, the way the image runs it: the bundle resolves
 * `dist/web` and `public/` against the working directory. This replaced
 * `.next/standalone`, and with it the whole overlay dance — the standalone
 * output carried neither the static chunks nor `public/` in full, and its
 * file-level dependency trace kept several packages only partially (the story
 * CSS toolchain, playwright's driver, DuckDB's shared library), so the driver
 * used to symlink the repo's own copies over them. The bundle has no trace and
 * no stubs, so there is nothing to overlay.
 */
export async function startServer(opts: { repoRoot: string; env: Record<string, string>; logPath: string; readyTimeoutMs?: number }): Promise<RunningServer> {
  const serverJs = path.join(opts.repoRoot, 'dist', 'proxy-server.mjs');
  if (!fs.existsSync(serverJs)) throw new Error(`no prod build at ${path.join('dist', 'proxy-server.mjs')} (${serverJs}) — run \`npm run build\` first`);

  const log = fs.openSync(opts.logPath, 'a');
  const stdio: ['ignore', number, number] = ['ignore', log, log];
  const child: ChildProcess = spawn('node', [serverJs], { cwd: path.join(opts.repoRoot, 'services/app'), env: opts.env as NodeJS.ProcessEnv, stdio });
  const url = `http://127.0.0.1:${opts.env.APP__PORT}`;
  const deadline = Date.now() + (opts.readyTimeoutMs ?? 60_000);
  let exited: number | null = null;
  child.on('exit', (code) => (exited = code ?? -1));
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`server exited with ${exited} before it was ready — see ${opts.logPath}`);
    try {
      const res = await fetch(`${url}/docs`);
      if (res.ok) break;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (Date.now() >= deadline) {
    child.kill('SIGKILL');
    throw new Error(`server on ${url} did not become ready — see ${opts.logPath}`);
  }
  return {
    url,
    stop: () =>
      new Promise<void>((resolve) => {
        if (exited !== null) return resolve();
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
      }),
  };
}
