/**
 * The gates' WebKit has no host-resolver switch (Chromium's flag) or resolver prefs (Firefox's), so it reaches
 * `app.lvh.me` and `<hex>.lvh.me` through this proxy, which resolves them the way every Node client here does
 * (utils/node/loopback-lookup): never through DNS. These tests stand in a resolver that fails every name.
 */
import dns from 'node:dns';
import http from 'node:http';
import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withHttpServer } from '@artifactbin/test-support/net';
import { startLoopbackProxy } from '../gates/lib/loopback-proxy.mjs';

const asked = [];
const real = dns.lookup;
/** An offline machine's resolver: address literals answer themselves (as getaddrinfo's do), every name fails. */
const offline = (hostname, options, callback) => {
  if (net.isIP(hostname)) return real.call(dns, hostname, options, callback);
  const cb = typeof options === 'function' ? options : callback;
  asked.push(hostname);
  process.nextTick(cb, Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND', hostname }));
};

/** One request in proxy form: the absolute URL as the request target, as a browser sends it to an HTTP proxy. */
function viaProxy(proxyPort, url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port: proxyPort, method: 'GET', path: url, headers: { host: new URL(url).host, ...headers } }, resolve);
    request.on('error', reject);
    request.end();
  });
}
const text = (response) => new Promise((resolve) => { let body = ''; response.on('data', (chunk) => { body += chunk; }); response.on('end', () => resolve(body)); });

describe('startLoopbackProxy', () => {
  const original = dns.lookup;
  let origin;
  let proxy;
  let port;
  beforeEach(async () => {
    dns.lookup = offline;
    asked.length = 0;
    origin = await withHttpServer((request, response) => {
      if (request.url === '/stream') {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write('data: first\n\n');
        return;
      }
      response.setHeader('set-cookie', 'afbin_pages=1; Path=/; HttpOnly; SameSite=Lax');
      response.end(JSON.stringify({ host: request.headers.host, url: request.url, cookie: request.headers.cookie ?? null }));
    });
    port = origin.port;
    proxy = await startLoopbackProxy();
  });
  afterEach(async () => {
    dns.lookup = original;
    await origin.close();
    await proxy.close();
  });

  it('forwards a request for a loopback name to loopback, byte for byte: the host the browser addressed, its cookies, the answer\'s cookies', async () => {
    const response = await viaProxy(proxy.port, `http://6162.lvh.me:${port}/a/b?c=1`, { cookie: 'afbin_pages=0' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toEqual(['afbin_pages=1; Path=/; HttpOnly; SameSite=Lax']);
    expect(JSON.parse(await text(response))).toEqual({ host: `6162.lvh.me:${port}`, url: '/a/b?c=1', cookie: 'afbin_pages=0' });
    expect(asked).toEqual([]);
  });

  it('streams: an event stream\'s first event arrives while the stream is still open', async () => {
    const response = await viaProxy(proxy.port, `http://app.lvh.me:${port}/stream`);
    const first = await new Promise((resolve) => response.once('data', (chunk) => resolve(String(chunk))));
    expect(first).toBe('data: first\n\n');
    response.destroy();
  });

  it('tunnels CONNECT to a loopback name (WebSockets and https through a proxy)', async () => {
    const socket = net.connect(proxy.port, '127.0.0.1');
    socket.write(`CONNECT app.localhost:${port} HTTP/1.1\r\nHost: app.localhost:${port}\r\n\r\n`);
    let received = '';
    socket.on('data', (chunk) => {
      received += chunk;
      if (received.includes('\r\n\r\n') && !received.includes('GET-SENT')) {
        expect(received.startsWith('HTTP/1.1 200')).toBe(true);
        received += 'GET-SENT';
        socket.write(`GET /tunnel HTTP/1.1\r\nHost: app.localhost:${port}\r\nConnection: close\r\n\r\n`);
      }
    });
    await new Promise((resolve) => socket.on('end', resolve));
    expect(received).toContain(`"host":"app.localhost:${port}"`);
    expect(asked).toEqual([]);
  });

  it('asks the resolver for any other name, and answers 502 when it cannot be reached', async () => {
    const response = await viaProxy(proxy.port, `http://elsewhere.example:${port}/`);
    expect(response.statusCode).toBe(502);
    await text(response);
    expect(asked).toEqual(['elsewhere.example']);
  });
});
