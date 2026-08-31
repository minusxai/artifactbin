/**
 * The proxied environment a run against a live deployment puts the agent in.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { agentProxyEnv, createCa, startMitmProxy } from '../lib/mitm';
import { parseLedger } from '../lib/ledger';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'eval-mitm-'));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('createCa', () => {
  it('mints a CA and a bundle that is the system roots PLUS it', () => {
    const dir = tmp(); dirs.push(dir);
    const ca = createCa(dir);
    const count = (p: string) => (fs.readFileSync(p, 'utf8').match(/BEGIN CERTIFICATE/g) ?? []).length;
    expect(count(ca.caPath)).toBe(1);
    // The distinction is the whole point: SSL_CERT_FILE REPLACES the trust store, so a bundle
    // of our CA alone makes every real certificate untrusted (Codex: "UnknownIssuer" on its
    // provider WebSocket). The bundle must therefore carry the system roots too.
    expect(count(ca.bundlePath)).toBeGreaterThan(1);
    expect(fs.readFileSync(ca.bundlePath, 'utf8')).toContain(fs.readFileSync(ca.caPath, 'utf8').trim());
  });

  it('is idempotent — a second run reuses the same CA rather than invalidating every issued cert', () => {
    const dir = tmp(); dirs.push(dir);
    const first = fs.readFileSync(createCa(dir).caPath, 'utf8');
    expect(fs.readFileSync(createCa(dir).caPath, 'utf8')).toBe(first);
  });
});

describe('agentProxyEnv', () => {
  const dir = tmp(); dirs.push(dir);
  const ca = createCa(dir);
  const env = agentProxyEnv('http://127.0.0.1:9', ca);

  it('covers every client family the harnesses actually use', () => {
    // curl (the agents' shell tool), Node (Claude Code, Pi, OpenCode), Rust/openssl (Codex), Python.
    for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'CURL_CA_BUNDLE', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE', 'NODE_EXTRA_CA_CERTS', 'NODE_USE_ENV_PROXY']) {
      expect(env[k]).toBeTruthy();
    }
  });

  it('gives the COMBINED bundle to the variables that replace the trust store, and the bare CA to the additive one', () => {
    expect(env.SSL_CERT_FILE).toBe(ca.bundlePath);
    expect(env.CURL_CA_BUNDLE).toBe(ca.bundlePath);
    expect(env.REQUESTS_CA_BUNDLE).toBe(ca.bundlePath);
    expect(env.NODE_EXTRA_CA_CERTS).toBe(ca.caPath); // additive: our CA alone is correct here
  });
});

describe('startMitmProxy', () => {
  let upstream: http.Server;
  let upstreamPort: number;
  let other: net.Server;
  let otherPort: number;

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      res.writeHead(req.url === '/bad' ? 400 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(req.url === '/bad' ? { error: 'invalid_jsx' } : { id: 'abc123', ok: req.url }));
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    upstreamPort = (upstream.address() as { port: number }).port;
    other = net.createServer((s) => s.end('TUNNELLED'));
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
    otherPort = (other.address() as { port: number }).port;
  });
  afterAll(async () => {
    await new Promise<void>((r) => upstream.close(() => r()));
    await new Promise<void>((r) => other.close(() => r()));
  });

  /** Speak CONNECT to the proxy, then TLS over the tunnel, exactly as curl or Node would. */
  async function throughProxy(proxyUrl: string, hostname: string, ca: string, reqPath: string): Promise<{ status: number; body: string }> {
    const p = new URL(proxyUrl);
    const socket: net.Socket = await new Promise((resolve, reject) => {
      const r = http.request({ host: p.hostname, port: Number(p.port), method: 'CONNECT', path: `${hostname}:443` });
      // No `head` handling needed here: the TLS handshake starts from the CLIENT, so the server
      // cannot have sent anything before this point.
      r.on('connect', (_res, sock) => resolve(sock));
      r.on('error', reject);
      r.end();
    });
    return new Promise((resolve, reject) => {
      const secure = tls.connect({ socket, servername: hostname, ca: fs.readFileSync(ca) }, () => {
        const req = http.request({ createConnection: () => secure, path: reqPath, headers: { host: hostname } }, (res) => {
          let b = ''; res.on('data', (c) => (b += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: b }));
        });
        req.on('error', reject);
        req.end();
      });
      secure.on('error', reject);
    });
  }

  it('decrypts, records and forwards the host under test', async () => {
    const dir = tmp(); dirs.push(dir);
    const ledger = path.join(dir, 'ledger.jsonl');
    const mitm = await startMitmProxy({ port: 0, host: 'faux.test', ledgerPath: ledger, caDir: path.join(dir, 'ca'), upstream: `http://127.0.0.1:${upstreamPort}` });
    const res = await throughProxy(mitm.url, 'faux.test', mitm.ca.caPath, '/docs/llm');
    await mitm.stop();
    expect(res.status).toBe(200);
    expect(res.body).toContain('/docs/llm');
    const entries = parseLedger(fs.readFileSync(ledger, 'utf8'));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ method: 'GET', path: '/docs/llm', status: 200 });
  });

  it('records the error code of a JSON failure, as the reverse proxy does', async () => {
    const dir = tmp(); dirs.push(dir);
    const ledger = path.join(dir, 'ledger.jsonl');
    const mitm = await startMitmProxy({ port: 0, host: 'faux.test', ledgerPath: ledger, caDir: path.join(dir, 'ca'), upstream: `http://127.0.0.1:${upstreamPort}` });
    const res = await throughProxy(mitm.url, 'faux.test', mitm.ca.caPath, '/bad');
    await mitm.stop();
    expect(res.status).toBe(400);
    expect(parseLedger(fs.readFileSync(ledger, 'utf8'))[0]).toMatchObject({ status: 400, error: 'invalid_jsx' });
  });

  it('blind-tunnels every OTHER host — a provider call must not cross our TLS termination or reach the ledger', async () => {
    const dir = tmp(); dirs.push(dir);
    const ledger = path.join(dir, 'ledger.jsonl');
    const mitm = await startMitmProxy({ port: 0, host: 'faux.test', ledgerPath: ledger, caDir: path.join(dir, 'ca'), upstream: `http://127.0.0.1:${upstreamPort}` });
    const p = new URL(mitm.url);
    const body: string = await new Promise((resolve, reject) => {
      const r = http.request({ host: p.hostname, port: Number(p.port), method: 'CONNECT', path: `127.0.0.1:${otherPort}` });
      // `head` can already hold the tunnelled bytes: the 200 and the payload may arrive in ONE
      // segment, and then nothing is left for a 'data' listener. Ignoring it passes locally and
      // loses the race on a busier machine.
      r.on('connect', (_res, sock, head) => {
        let b = head?.toString() ?? '';
        sock.on('data', (c) => (b += c));
        sock.on('end', () => resolve(b));
      });
      r.on('error', reject);
      r.end();
    });
    await mitm.stop();
    expect(body).toBe('TUNNELLED');
    expect(parseLedger(fs.readFileSync(ledger, 'utf8'))).toHaveLength(0);
  });

  it('the ledger file exists from the start, so a run with no agent traffic reads as empty rather than crashing', async () => {
    const dir = tmp(); dirs.push(dir);
    const ledger = path.join(dir, 'ledger.jsonl');
    const mitm = await startMitmProxy({ port: 0, host: 'faux.test', ledgerPath: ledger, caDir: path.join(dir, 'ca') });
    expect(fs.existsSync(ledger)).toBe(true);
    expect(parseLedger(fs.readFileSync(ledger, 'utf8'))).toEqual([]);
    await mitm.stop();
  });
});

describe('shutdown', () => {
  /**
   * A blind tunnel is a pair of raw `net` sockets owned by NEITHER the HTTP server
   * nor the TLS one, so closing those leaves it open and the process never exits.
   * Observed for real: a run printed PASS and then sat for an hour.
   */
  it('closes tunnelled sockets, so nothing is left holding the event loop', async () => {
    const dir = tmp(); dirs.push(dir);
    const keepAlive = net.createServer(() => { /* accept and hold */ });
    await new Promise<void>((r) => keepAlive.listen(0, '127.0.0.1', r));
    const port = (keepAlive.address() as { port: number }).port;

    const mitm = await startMitmProxy({ port: 0, host: 'faux.test', ledgerPath: path.join(dir, 'l.jsonl'), caDir: path.join(dir, 'ca') });
    const p = new URL(mitm.url);
    const tunnel: net.Socket = await new Promise((resolve, reject) => {
      const r = http.request({ host: p.hostname, port: Number(p.port), method: 'CONNECT', path: `127.0.0.1:${port}` });
      r.on('connect', (_res, sock) => resolve(sock));
      r.on('error', reject);
      r.end();
    });
    expect(tunnel.destroyed).toBe(false);
    await mitm.stop();
    await new Promise((r) => setTimeout(r, 50));
    expect(tunnel.destroyed).toBe(true);
    await new Promise<void>((r) => keepAlive.close(() => r()));
  });
});
