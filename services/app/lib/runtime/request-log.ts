/**
 * ONE STRUCTURED LINE PER REQUEST, written at the server entry once the response has finished:
 * method, path, status, duration. The path is the pathname ONLY — a query string carries tokens, codes and
 * search text, so it is cut off before anything is recorded — and no header or body is ever read.
 * The liveness probes (`/health`, `/api/health`) are skipped: an orchestrator polls them every few seconds.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { log } from '@artifactbin/utils';

const SKIPPED_PATHS = new Set(['/health', '/api/health']);
const requests = log('http');

/** The pathname of a raw request target, without query string or fragment. */
export function requestPath(target: string | undefined): string {
  const raw = target ?? '/';
  const end = raw.search(/[?#]/);
  return end === -1 ? raw : raw.slice(0, end);
}

/** Wrap the server's request listener so every finished response writes one line. */
export function withRequestLog<Req extends IncomingMessage, Res extends ServerResponse>(
  listener: (req: Req, res: Res) => unknown,
  write: (fields: { method: string; path: string; status: number; ms: number }) => void = (fields) => requests.info('request', fields),
): (req: Req, res: Res) => unknown {
  return (req, res) => {
    const path = requestPath(req.url);
    if (!SKIPPED_PATHS.has(path)) {
      const started = process.hrtime.bigint();
      let written = false;
      const finish = () => {
        if (written) return;
        written = true;
        write({ method: req.method ?? 'GET', path, status: res.statusCode, ms: Math.round(Number(process.hrtime.bigint() - started) / 1e5) / 10 });
      };
      res.once('finish', finish);
      res.once('close', finish);
    }
    return listener(req, res);
  };
}
