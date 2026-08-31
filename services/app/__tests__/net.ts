/**
 * THE real-socket fixture — the one way a test stands up an HTTP endpoint on a real port.
 *
 * Every test that needs a real socket (web-ingest fetching a page, an OIDC issuer, a CSV URL, a font host) used to
 * hand-roll `createServer` + `listen(0)` + `address()` + teardown; three tests bound FIXED ports (4863, 4869, 5221)
 * that collide the moment two worktrees run at once (research risk row 6, MEASURED). This module owns all of it:
 * ephemeral ports only, IPv4 loopback, honest teardown.
 */
import { createServer, type RequestListener } from 'node:http';

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
