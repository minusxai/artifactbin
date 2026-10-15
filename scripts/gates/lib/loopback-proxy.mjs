/**
 * THE GATES' WEBKIT REACHES THE LOOPBACK NAMES THROUGH THIS PROXY.
 *
 * Chromium is told the mapping by flag (lib/browser.mjs `PAGES_BROWSER_ARGS`) and Firefox by its resolver
 * prefs; WebKit has neither, and on its own it asks public DNS for `app.lvh.me` and `<hex id>.lvh.me`, which
 * a gate container without a network cannot answer. Handed this proxy (`webkit.launch({ proxy })`), WebKit
 * sends every request here and this process connects instead, resolving with the shared lookup
 * (utils/node/loopback-lookup): loopback names never reach a resolver, every other name does, unchanged.
 *
 * Byte for byte otherwise: the request line's path, the headers as the browser sent them (its `Host`, cookies,
 * `Origin`, `Sec-Fetch-*` — what the server's per-document origins are decided by), the answer's status and
 * headers (its cookies) and its body, piped as it arrives so an event stream stays live. `CONNECT` tunnels
 * (WebSockets, https) are spliced to the target's socket.
 */
import http from 'node:http';
import net from 'node:net';
import { loopbackLookup } from '@artifactbin/utils/node/loopback-lookup';

/** Headers that describe the hop to the proxy, not the request: never forwarded. */
const HOP = new Set(['proxy-connection', 'proxy-authorization', 'keep-alive', 'connection']);

/**
 * Start the proxy on an ephemeral 127.0.0.1 port. It never holds the process open (`unref`).
 * @returns {Promise<{ port: number, server: string, close: () => Promise<void> }>}
 */
export async function startLoopbackProxy() {
  const lookup = loopbackLookup();
  const sockets = new Set();
  const proxy = http.createServer((request, response) => {
    let target;
    try { target = new URL(request.url ?? ''); } catch { target = null; }
    if (!target || target.protocol !== 'http:') { response.writeHead(400).end('absolute http:// request target required'); return; }
    // As raw `[name, value, …]` pairs: names, order and repeats exactly as the browser sent them.
    const headers = [];
    for (let i = 0; i < request.rawHeaders.length; i += 2) {
      if (!HOP.has(request.rawHeaders[i].toLowerCase())) headers.push(request.rawHeaders[i], request.rawHeaders[i + 1]);
    }
    const upstream = http.request({
      host: target.hostname.replace(/^\[|\]$/g, ''), port: target.port || 80, method: request.method, path: `${target.pathname}${target.search}`,
      headers, setHost: false, lookup, agent: false,
    }, (answer) => {
      const kept = [];
      for (let i = 0; i < answer.rawHeaders.length; i += 2) if (!HOP.has(answer.rawHeaders[i].toLowerCase())) kept.push(answer.rawHeaders[i], answer.rawHeaders[i + 1]);
      response.writeHead(answer.statusCode ?? 502, answer.statusMessage, kept);
      response.flushHeaders();
      answer.pipe(response);
    });
    upstream.on('error', (error) => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' }).end(`loopback proxy: ${error.message}`);
      else response.destroy();
    });
    response.on('close', () => upstream.destroy());
    request.pipe(upstream);
  });
  proxy.on('connect', (request, client, head) => {
    const [host, port] = (request.url ?? '').replace(/^\[([^\]]+)\]/, '$1').split(/:(?=\d+$)/);
    const upstream = net.connect({ host, port: Number(port) || 443, lookup }, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    const end = () => { upstream.destroy(); client.destroy(); };
    upstream.on('error', () => { if (client.writable) client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); end(); });
    client.on('error', end);
    sockets.add(client); client.on('close', () => sockets.delete(client));
  });
  proxy.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  proxy.unref();
  const { port } = /** @type {import('node:net').AddressInfo} */ (proxy.address());
  return {
    port,
    server: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => { for (const socket of sockets) socket.destroy(); proxy.close(() => resolve()); }),
  };
}
