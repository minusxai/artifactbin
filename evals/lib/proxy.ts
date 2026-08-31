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
const ARTIFACT_WRITE = /^\/(api\/artifacts(\/[A-Za-z0-9]+(\/edits)?)?|mcp|echo)(\?.*)?$/;
/** `lib/story/input.ts` — a write declares exactly one of these. */
const CONTENT_TIERS = ['markup', 'dataset', 'viz', 'image'] as const;

/** `lib/ids.ts` — 6-12 of `[a-zA-Z0-9]`. */
const ID_RE = /^[A-Za-z0-9]{6,12}$/;

const objectValue = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

/**
 * REST sends an operation's input as the request body. MCP wraps that same
 * input in JSON-RPC's `params.arguments`; normalize both transports before
 * extracting the content tier and markup. Without this, a real MCP dataset
 * create is recorded as an untyped POST and the eval falsely fails
 * `dataset_created`.
 */
function operationInput(body: Record<string, unknown> | null, url: string): Record<string, unknown> | null {
  if (!body || url.split('?')[0] !== '/mcp') return body;
  const params = objectValue(body.params);
  return objectValue(params?.arguments);
}

/** MCP returns an operation's JSON body as text inside `result.content`. */
function operationOutput(body: Record<string, unknown> | null, url: string): Record<string, unknown> | null {
  if (!body || url.split('?')[0] !== '/mcp') return body;
  const result = objectValue(body.result);
  const content = Array.isArray(result?.content) ? result.content : [];
  for (const part of content) {
    const item = objectValue(part);
    if (typeof item?.text !== 'string') continue;
    try {
      const output = objectValue(JSON.parse(item.text));
      if (output) return output;
    } catch {
      // A non-JSON text result carries no artifact metadata.
    }
  }
  return null;
}

/** The artifact a write names in its URL, if any. */
function idFromPath(url: string): string | null {
  const m = /^\/api\/artifacts\/([A-Za-z0-9]+)(?:\/(?:edits|revert))?(?:\?|$)/.exec(url);
  return m ? m[1] : null;
}

/**
 * The artifact a response names. `POST /api/artifacts` answers `{id}` directly;
 * an MCP tool result carries the same JSON as TEXT inside `result.content[]`.
 */
function idFromBody(body: Record<string, unknown> | null): string | null {
  if (!body) return null;
  if (typeof body.id === 'string' && ID_RE.test(body.id)) return body.id;
  const content = (body.result as { content?: Array<{ text?: string }> } | undefined)?.content;
  for (const part of content ?? []) {
    if (typeof part.text !== 'string') continue;
    try {
      const inner = JSON.parse(part.text) as { id?: unknown };
      if (typeof inner.id === 'string' && ID_RE.test(inner.id)) return inner.id;
    } catch {
      // a tool result that is not JSON
    }
  }
  return null;
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

export function forwardExchange(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: { target: URL; transport: typeof http | typeof https; rewriteHost: boolean; record: (e: LedgerEntry) => void },
): void {
  const { target, transport, rewriteHost } = opts;
  const record = req.headers[DRIVER_HEADER] === undefined ? opts.record : () => {};
  const started = Date.now();
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';
  const isJson = (h: http.IncomingHttpHeaders) => String(h['content-type'] ?? '').includes('application/json');
  const keepReq = isJson(req.headers) && ARTIFACT_WRITE.test(url) && method !== 'GET';
  const reqChunks: Buffer[] = [];
  let reqSize = 0;

  // A locally booted server must see the AGENT's host, because it mints the start link from it. A live
  // deployment must see its OWN: artifactbin.dev answers a foreign Host with a 307 to its login page.
  const headers = rewriteHost ? { ...req.headers, host: target.host } : req.headers;
  const upstream = transport.request(
    { host: target.hostname, port: target.port || undefined, method, path: url, headers, servername: target.hostname },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      // A response body is retained for a failure (its `error` code) or a write (its echo + the artifact id).
      const keepRes = isJson(up.headers) && ((up.statusCode ?? 0) >= 400 || keepReq);
      const resChunks: Buffer[] = [];
      let resSize = 0;
      // Counted for EVERY response (the docs-cost metric reads it); retained only per keepRes.
      let resBytes = 0;
      up.on('data', (chunk: Buffer) => {
        resBytes += chunk.length;
        if (keepRes && resSize < BODY_CAP) { resChunks.push(chunk); resSize += chunk.length; }
      });
      up.pipe(res);
      up.on('end', () => {
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
          const body = parseJson(Buffer.concat(resChunks));
          const output = operationOutput(body, url);
          if (status >= 400 && body && typeof body.error === 'string') entry.error = body.error;
          if (keepReq && output && typeof output.markup === 'string') entry.resMarkup = output.markup;
          if (keepReq && output && typeof output.markup_changed === 'boolean') entry.markupUnchanged = !output.markup_changed;
          if (!entry.artifactId) {
            const bodyId = idFromBody(body);
            if (bodyId) entry.artifactId = bodyId;
          }
        }
        if (keepReq) {
          const body = parseJson(Buffer.concat(reqChunks));
          const input = operationInput(body, url);
          if (input && typeof input.markup === 'string') entry.reqMarkup = input.markup;
          const format = CONTENT_TIERS.find((k) => input && input[k] !== undefined);
          if (format) entry.reqFormat = format;
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

export async function startProxy(opts: { port: number; target: string; ledgerPath: string; rewriteHost?: boolean }): Promise<RunningProxy> {
  const target = new URL(opts.target);
  const transport = transportFor(opts.target);
  const record = createRecorder(opts.ledgerPath);
  const server = http.createServer((req, res) =>
    forwardExchange(req, res, { target, transport, rewriteHost: !!opts.rewriteHost, record }));

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    // Bounded: `close()` calls back only when every connection is gone, and one that never is
    // would hold the whole run open. See `lib/shutdown.ts`.
    stop: () => settleWithin(new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }), TEARDOWN_MS).then(() => undefined),
  };
}

function parseJson(buf: Buffer): Record<string, unknown> | null {
  try {
    const v = JSON.parse(buf.toString('utf8'));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
