/**
 * THE real-socket fixture — the one way a test stands up an HTTP endpoint on a real port.
 *
 * Every test that needs a real socket (web-ingest fetching a page, an OIDC issuer, a CSV URL, a font host) comes
 * through here rather than hand-rolling `createServer` + `listen(0)` + `address()` + teardown: ephemeral ports
 * only, IPv4 loopback, honest teardown. A fixed port collides the moment two worktrees run at once.
 *
 * It lives in this package because tests in several packages need it. Nothing here imports a test runner, so
 * the CLI's `node:test` suite can use it too.
 */
import http, { createServer, type RequestListener } from 'node:http';

export interface RunningServer {
  /** `http://127.0.0.1:<port>` — never `localhost` (IPv6 resolution surprises). */
  base: string;
  port: number;
  /** Idempotent; resolves once every connection is gone. */
  close(): Promise<void>;
}

/** A port that was free a moment ago — for a CHILD PROCESS that must be told its port (the SQL service tests). */
export async function freePort(): Promise<number> {
  const running = await withHttpServer((_req, res) => res.end());
  await running.close();
  return running.port;
}

/** Serve `handler` on an ephemeral loopback port. Tests call it in `beforeAll` and `close()` in `afterAll`. */
export async function withHttpServer(handler: RequestListener): Promise<RunningServer> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => reject(error);
    server.once('error', failed);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', failed);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('HTTP test server did not bind a TCP port');
  }

  let closing: Promise<void> | undefined;
  return {
    base: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close: () => {
      closing ??= new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => error ? reject(error) : resolve());
      });
      return closing;
    },
  };
}

/** One request on a raw socket, the body kept as the bytes written — for content-length and range assertions. */
export interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  /** The bytes as written, never decoded or re-encoded. */
  body: Buffer;
  /** `content-length` as a number, or null when the server sent none. */
  promised: number | null;
}

export function readRawResponse(
  port: number,
  path: string,
  options: { headers?: Record<string, string>; method?: string } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    http.request({ host: '127.0.0.1', port, path, headers: options.headers ?? {}, method: options.method ?? 'GET' }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const length = response.headers['content-length'];
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
          promised: length === undefined ? null : Number(length),
        });
      });
      response.on('error', reject);
    }).on('error', reject).end();
  });
}
