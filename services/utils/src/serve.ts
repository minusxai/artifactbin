import { getRequestListener } from '@hono/node-server';
import type { Hono } from 'hono';
import http, { type Server } from 'node:http';

export interface Listening {
  server: Server;
  /** Known synchronously when no host is given (the port is bound before `serve` returns); after `ready` otherwise. */
  port: number;
  url: string;
  /** Resolves once the socket is listening — only a hostname bind is asynchronous. */
  ready: Promise<void>;
  /** Drops open connections FIRST — an SSE client would otherwise hold `close()` forever. */
  close(): Promise<void>;
}

/** Listen. Port 0 picks a free one; the real port is on the result. */
export function serve(app: Pick<Hono, 'fetch'>, port: number, opts: { host?: string } = {}): Listening {
  const server = http.createServer(getRequestListener(app.fetch));
  const ready = new Promise<void>((resolve) => server.once('listening', resolve));
  if (opts.host) server.listen(port, opts.host); else server.listen(port);
  const addr = server.address();
  const bound = typeof addr === 'object' && addr ? addr.port : port;
  const host = opts.host ?? '127.0.0.1';
  return {
    server,
    port: bound,
    url: `http://${host}:${bound}`,
    ready,
    close: () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close((e) => (e ? reject(e) : resolve())); }),
  };
}
