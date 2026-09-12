import path from 'node:path';
import { createHash } from 'node:crypto';
/**
 * The recording proxy — the per-leg request ledger. Sits between the agent and
 * the product server, forwards everything verbatim (streams included), and
 * appends one JSONL line per request: method, path, status, timing, UA, whether
 * a bearer rode along, the `error` code of a JSON failure body, and for
 * document writes the markup sent and the markup echoed back. That last pair
 * is `canonical_stable`; the error code is the failure taxonomy.
 *
 * Bodies are only retained for JSON on artifact routes, capped, and only in
 * memory until the response ends.
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import type { LedgerEntry } from './contracts';
import { settleWithin, TEARDOWN_MS } from './shutdown';

const BODY_CAP = 512 * 1024;
const ARTIFACT_WRITE = /^\/(api\/artifacts(\/[A-Za-z0-9]+(\/edits)?)?|echo)(\?.*)?$/;
/** `lib/story/input.ts` — a write declares exactly one of these. */
const CONTENT_TIERS = ['markup', 'dataset', 'viz', 'image','pdf','file'] as const;

/** `lib/ids.ts` — 6-12 of `[a-zA-Z0-9]`. */
const ID_RE = /^[A-Za-z0-9]{6,12}$/;

/** The artifact a write names in its URL, if any. */
function idFromPath(url: string): string | null {
  const m = /^\/api\/artifacts\/([A-Za-z0-9]+)(?:\/(?:edits|revert))?(?:\?|$)/.exec(url);
  return m ? m[1] : null;
}

/** The artifact identity in a successful HTTP response. */
function idFromBody(body:Record<string,unknown>|null):string|null{
 return typeof body?.id==='string'&&ID_RE.test(body.id)?body.id:null;
}

export interface RunningProxy { url: string; port: number; stop(): Promise<void> }

/** The client module for a target's scheme — a deployment is https, a locally booted server is not. */
export function transportFor(target: string): typeof http | typeof https {
  return new URL(target).protocol === 'https:' ? https : http;
}

/** Forward one already-decrypted exchange to `target`, recording it. Shared by the reverse proxy and the MITM. */
/**
 * The driver reaches the product through this same proxy to mint a start
 * document (and to seed one), and that traffic is not the agent's. A request
 * carrying this header is forwarded untouched but NOT recorded, so a task's
 * ledger holds exactly what its agent did.
 *
 * Marked rather than sliced by time: one ledger per task is what lets a leg's
 * tasks run concurrently, and a wall-clock window cannot survive that.
 */
export const DRIVER_HEADER = 'x-eval-driver';

/**
 * One JSON reply whose text is rewritten on the way back: the product mints its OAuth device
 * approval URL from its configured public origin (the LEG's proxy), while the agent was told THIS
 * proxy is the server. The CLI rightly refuses an approval page on an origin the caller did not
 * select, so the task proxy substitutes itself, exactly as a public host in front of the product would
 * be the origin in production.
 */
export interface BodyRewrite { path: string; from: string; to: string; /** `json` (the default) rewrites only JSON replies; `text` rewrites any text body. */ kind?: 'json' | 'text' }

/**
 * The locally built release, served by the task proxy so the `not-installed` flow installs THIS
 * checkout's CLI through the real installer: `/chat/install.sh` is rewritten to download from the
 * proxy (and, being plain http on 127.0.0.1, without the installer's https-only curl flags), and
 * `/chat/releases/afbin-v<version>/<asset>` answers the platform binary and its SHA256SUMS from `dist/`.
 */
export interface LocalRelease { version: string; distDir: string }

export function forwardExchange(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: { target: URL; transport: typeof http | typeof https; rewriteHost: boolean; record: (e: LedgerEntry) => void; rewriteBody?: BodyRewrite[] },
): void {
  const { target, transport, rewriteHost } = opts;
  const record = req.headers[DRIVER_HEADER] === undefined ? opts.record : () => {};
  const started = Date.now();
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';
  const isJson = (h: http.IncomingHttpHeaders) => String(h['content-type'] ?? '').includes('application/json');
  const keepReq = isJson(req.headers) && ARTIFACT_WRITE.test(url) && method !== 'GET';
  // The device door's reply carries the user code the driver approves for the agent (lib/approver).
  const isPairing = method === 'POST' && url.split('?')[0] === '/oauth/device';
  const reqChunks: Buffer[] = [];
  let reqSize = 0;

  // A locally booted server must see the AGENT's host, because it mints the start link from it. A live
  // deployment must see its OWN: artifactbin.dev answers a foreign Host with a 307 to its login page.
  const headers = rewriteHost ? { ...req.headers, host: target.host } : req.headers;
  const upstream = transport.request(
    { host: target.hostname, port: target.port || undefined, method, path: url, headers, servername: target.hostname },
    (up) => {
      const rewrite = (opts.rewriteBody ?? []).find((r) => url.split('?')[0] === r.path && ((r.kind ?? 'json') === 'text' || isJson(up.headers))) ?? null;
      if (!rewrite) res.writeHead(up.statusCode ?? 502, up.headers);
      const rewriteChunks: Buffer[] = [];
      // A response body is retained for a failure (its `error` code) or a write (its echo + the artifact id).
      const keepRes = isJson(up.headers) && ((up.statusCode ?? 0) >= 400 || keepReq || isPairing);
      const resChunks: Buffer[] = [];
      let resSize = 0;
      // Counted for EVERY response (the docs-cost metric reads it); retained only per keepRes.
      let resBytes = 0;
      up.on('data', (chunk: Buffer) => {
        resBytes += chunk.length;
        if (keepRes && resSize < BODY_CAP) { resChunks.push(chunk); resSize += chunk.length; }
        if (rewrite) rewriteChunks.push(chunk);
      });
      if (!rewrite) up.pipe(res);
      up.on('end', () => {
        if (rewrite) {
          const text = Buffer.concat(rewriteChunks).toString('utf8');
          const body = Buffer.from(rewrite.kind === 'text' ? rewriteInstallerForLocal(text, rewrite.from, rewrite.to) : text.split(rewrite.from).join(rewrite.to));
          res.writeHead(up.statusCode ?? 502, { ...up.headers, 'content-length': String(body.length) });
          res.end(body);
        }
        const status = up.statusCode ?? 502;
        const entry: LedgerEntry = {
          t: started, ms: Date.now() - started, method, path: url, status,
          ua: (req.headers['user-agent'] as string | undefined) ?? null,
          auth: /^bearer /i.test(String(req.headers.authorization ?? '')) ? 'bearer' : null,
          error: null,
          bytes: resBytes,
        };
        const pathId = idFromPath(url);
        if (pathId) entry.artifactId = pathId;
        if (keepRes) {
          const bytes = Buffer.concat(resChunks);
          const body = parseJson(bytes);
          const output = body;
          if (status >= 400 && body && typeof body.error === 'string') entry.error = body.error;
          if (isPairing && status === 200 && body && typeof body.user_code === 'string') {
            entry.userCode = body.user_code;
            if (typeof body.expires_in === 'number' && Number.isFinite(body.expires_in)) entry.pairingExpiresAt = started + body.expires_in * 1000;
          }
          if (keepReq && output && typeof output.markup === 'string') entry.resMarkup = output.markup;
          if (keepReq && output && typeof output.markup_changed === 'boolean') entry.markupUnchanged = !output.markup_changed;
          if (!entry.artifactId) {
            const bodyId = idFromBody(body);
            if (bodyId) entry.artifactId = bodyId;
          }
        }
        if (keepReq) {
          const body = parseJson(Buffer.concat(reqChunks));
          const input = body;
          if(input){const source=input.markup??input.source;if(typeof source==='string')entry.reqMarkup=source;}
          const format = CONTENT_TIERS.find((k) => input && input[k] !== undefined);
          if (format) entry.reqFormat = format;else if(typeof input?.source==='string')entry.reqFormat='markup';
        }
        record(entry);
      });
    },
  );
  upstream.on('error', (e) => {
    record({ t: started, ms: Date.now() - started, method, path: url, status: 502, ua: (req.headers['user-agent'] as string | undefined) ?? null, auth: null, error: 'proxy_upstream_unreachable' });
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`proxy: upstream unreachable: ${e.message}`);
  });
  req.on('data', (chunk: Buffer) => {
    if (keepReq && reqSize < BODY_CAP) { reqChunks.push(chunk); reqSize += chunk.length; }
  });
  req.pipe(upstream);
}

/** Append-only ledger writer; the file exists from the start so an empty ledger is a finding, not a crash. */
export function createRecorder(ledgerPath: string): (e: LedgerEntry) => void {
  fs.writeFileSync(ledgerPath, '', { flag: 'a' });
  return (entry: LedgerEntry) => fs.appendFileSync(ledgerPath, JSON.stringify(entry) + '\n');
}

export async function startProxy(opts: { port: number; target: string; ledgerPath: string; rewriteHost?: boolean; /** The origin the product advertises on its OAuth device door; rewritten to this proxy's own. */ rewriteDeviceOrigin?: string; localRelease?: LocalRelease }): Promise<RunningProxy> {
  const target = new URL(opts.target);
  const transport = transportFor(opts.target);
  const record = createRecorder(opts.ledgerPath);
  let self = '';
  const rewrites = (): BodyRewrite[] => {
    if (!self) return [];
    const list: BodyRewrite[] = [];
    if (opts.rewriteDeviceOrigin) list.push({ path: '/oauth/device', from: opts.rewriteDeviceOrigin, to: self });
    if (opts.localRelease) list.push({ path: '/chat/install.sh', from: 'https://github.com/minusxai/artifactbin/releases/download/afbin-v', to: `${self}/chat/releases/afbin-v`, kind: 'text' });
    return list;
  };
  const server = http.createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0];
    if (opts.localRelease && pathname.startsWith(`/chat/releases/afbin-v${opts.localRelease.version}/`)) return serveLocalRelease(pathname, opts.localRelease, res);
    forwardExchange(req, res, { target, transport, rewriteHost: !!opts.rewriteHost, record, rewriteBody: rewrites() });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as { port: number }).port;
  self = `http://127.0.0.1:${port}`;
  return {
    url: self,
    port,
    // Bounded: `close()` calls back only when every connection is gone, and one that never is
    // would hold the whole run open. See `lib/shutdown.ts`.
    stop: () => settleWithin(new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }), TEARDOWN_MS).then(() => undefined),
  };
}

/** The installer's https-only curl flags cannot fetch from a plain-http loopback proxy; the local rewrite drops them. */
export function rewriteInstallerForLocal(body: string, from: string, to: string): string {
  return body.split(from).join(to).replace(/--proto '=https' --proto-redir '=https' --tlsv1\.2 /g, '');
}

/** The only files the proxy will ever serve; a request selects one of these constants or nothing. */
const RELEASE_BINARIES = ['afbin-darwin-arm64', 'afbin-darwin-x64', 'afbin-linux-arm64', 'afbin-linux-x64'] as const;
const RELEASE_ASSETS = [...RELEASE_BINARIES.flatMap(name => [name, `${name}.gz`, `${name}.manifest.json`, `${name}.sizes.json`, `${name.replace('afbin-', 'afbin-sql-')}.gz`, `${name.replace('afbin-', 'afbin-sql-')}.manifest.json`]), 'afbin-skills.json', 'afbin.1'];
function serveLocalRelease(pathname: string, release: LocalRelease, res: http.ServerResponse): void {
  const requested = pathname.split('/').pop() ?? '';
  if (requested === 'SHA256SUMS') {
    const lines = RELEASE_ASSETS.filter((n) => fs.existsSync(path.join(release.distDir, n)))
      .map((n) => `${createHash('sha256').update(fs.readFileSync(path.join(release.distDir, n))).digest('hex')}  ${n}`);
    const body = lines.join('\n') + '\n';
    res.writeHead(200, { 'content-type': 'text/plain', 'content-length': String(Buffer.byteLength(body)) });
    res.end(body); return;
  }
  // The path is built from the allowlist constant, never from the request string.
  const name = RELEASE_ASSETS.find((n) => n === requested);
  const file = name ? path.join(release.distDir, name) : null;
  if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(fs.statSync(file).size) });
  fs.createReadStream(file).pipe(res);
}

function parseJson(buf: Buffer): Record<string, unknown> | null {
  try {
    const v = JSON.parse(buf.toString('utf8'));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
