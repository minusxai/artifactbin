import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { loopbackLookup } from '@artifactbin/utils/node/loopback-lookup';

/**
 * THE RENDER BROWSER'S ONLY WAY TO A NETWORK. Every Chromium this service launches for a render is pointed at a proxy
 * this process runs on loopback, and every page's context at one of its own (`openEgress`), which opens a connection
 * only to the exact `host:port` of the origins that render may load and refuses everything else with one fixed answer,
 * before any name is resolved or any address dialled: so a refusal says nothing of what is listening there. The launch
 * (`EGRESS_ARGS`) closes the rest: no name resolves inside Chromium (only the proxy's loopback address is excluded),
 * loopback goes through the proxy too (Playwright adds `<-loopback>`), WebRTC may use no UDP that is not proxied (an
 * HTTP proxy carries none, so STUN and UDP TURN have nowhere to go, and TURN over TCP meets the same refusal), QUIC is
 * off, and hyperlink pings are not sent. Request interception (local.ts) still decides each HTTP request first; this is
 * the floor beneath it for what interception never sees (WebSocket, WebRTC, speculative and background connections).
 */
export const EGRESS_ARGS = [
  '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--disable-quic',
  '--no-pings',
  '--dns-prefetch-disable',
  '--disable-domain-reliability',
  '--disable-sync',
] as const;

/** One proxy: its `http://127.0.0.1:<port>` address, and its close (every tunnel with it). */
export interface Egress { readonly server: string; close(): Promise<void> }

/** The `host:port` an origin is reached at (default ports spelled out), lowercased; null for anything else. */
function originAddress(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.hostname.toLowerCase()}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
  } catch { return null; }
}

const REFUSED = 'HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\nconnection: close\r\n\r\n';
const lookup = loopbackLookup();

/**
 * A proxy that reaches exactly `origins` (http and https only; nothing at all when empty): a CONNECT to one of their
 * `host:port`s is tunnelled, a proxied plain-HTTP request to one is forwarded (its proxy headers dropped), and anything
 * else (another address, a request not in proxy form, an upgrade outside a tunnel) answers the same 403.
 */
export async function openEgress(origins: readonly string[]): Promise<Egress> {
  const allowed = new Set(origins.map(originAddress).filter((address): address is string => !!address));
  const open = new Set<Duplex>();
  const track = (socket: Duplex) => { open.add(socket); socket.on('close', () => open.delete(socket)); socket.on('error', () => socket.destroy()); };
  const split = (address: string) => { const at = address.lastIndexOf(':'); return { host: address.slice(0, at).replace(/^\[|\]$/g, ''), port: Number(address.slice(at + 1)) }; };

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let target: URL | null = null;
    try { target = /^http:\/\//i.test(request.url ?? '') ? new URL(request.url!) : null; } catch { target = null; }
    const address = target ? originAddress(target.origin) : null;
    if (!target || !address || !allowed.has(address)) { response.writeHead(403, { 'content-length': '0', connection: 'close' }); response.end(); return; }
    const headers = { ...request.headers };
    for (const name of Object.keys(headers)) if (/^proxy-/i.test(name)) delete headers[name];
    const { host, port } = split(address);
    const upstream = httpRequest({ host, port, method: request.method, path: target.pathname + target.search, headers, lookup, setHost: false }, (answer) => {
      response.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(response);
    });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502, { 'content-length': '0', connection: 'close' }); response.end(); });
    response.on('close', () => upstream.destroy());
    request.pipe(upstream);
  });
  server.on('connection', track);
  server.on('connect', (request: IncomingMessage, client: Duplex, head: Buffer) => {
    const address = (request.url ?? '').toLowerCase();
    if (!allowed.has(address)) { client.end(REFUSED); return; }
    const { host, port } = split(address);
    const upstream: Socket = connect({ host, port, lookup }, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client); client.pipe(upstream);
    });
    track(upstream);
    upstream.on('error', () => client.end('HTTP/1.1 502 Bad Gateway\r\ncontent-length: 0\r\nconnection: close\r\n\r\n'));
    client.on('close', () => upstream.destroy());
  });
  server.on('upgrade', (_request: IncomingMessage, client: Duplex) => { client.end(REFUSED); });
  server.on('clientError', (_error: Error, client: Duplex) => { client.destroy(); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const { port } = server.address() as { port: number };
  return {
    server: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => { for (const socket of open) socket.destroy(); server.close(() => resolve()); }),
  };
}
