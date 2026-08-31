/**
 * A recording proxy for a run that targets a LIVE deployment.
 *
 * The reverse proxy in `proxy.ts` works by BEING the base URL, which a locally
 * booted server is happy to mint links from. A deployment is not: artifactbin.dev
 * answers a foreign `Host` with a 307 to its login page, so it must always see
 * its own name — and then it mints links pointing at itself, and the agent walks
 * straight past any reverse proxy.
 *
 * So for a deployment the agent is put in a PROXIED ENVIRONMENT instead:
 * `HTTPS_PROXY` plus a CA it trusts. Its traffic arrives here as `CONNECT`, and
 * for the host under test this proxy terminates TLS with a certificate it mints
 * itself, records the decrypted exchange, and re-originates upstream. Every
 * other host is blind-tunnelled untouched — the agent's own provider calls
 * (Anthropic, OpenAI, Fireworks) never cross this TLS termination and never
 * enter the ledger.
 *
 * Verified against all four harnesses: each one's tool traffic is recorded with
 * method, path and status, while its provider traffic passes through.
 *
 * One sharp edge, learned by hitting it: `SSL_CERT_FILE` and `CURL_CA_BUNDLE`
 * REPLACE the trust store rather than adding to it. Pointing them at this CA
 * alone makes every real certificate untrusted — Codex failed its provider
 * WebSocket with `invalid peer certificate: UnknownIssuer`. `caBundlePath` is
 * therefore the system roots PLUS this CA. (`NODE_EXTRA_CA_CERTS` is additive,
 * which is why Node clients kept working and hid the problem.)
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import type { LedgerEntry } from './contracts';
import { createRecorder, forwardExchange, transportFor } from './proxy';
import { settleWithin, TEARDOWN_MS } from './shutdown';

/** Where the OS keeps its root bundle. First hit wins; both are plain concatenated PEM. */
const SYSTEM_ROOTS = ['/etc/ssl/cert.pem', '/etc/ssl/certs/ca-certificates.crt'];

export interface Ca {
  dir: string;
  /** Our CA alone — for `NODE_EXTRA_CA_CERTS`, which ADDS to the trust store. */
  caPath: string;
  /** System roots + our CA — for the variables that REPLACE the trust store. */
  bundlePath: string;
}

export function createCa(dir: string): Ca {
  fs.mkdirSync(dir, { recursive: true });
  const caPath = path.join(dir, 'ca.crt');
  const keyPath = path.join(dir, 'ca.key');
  if (!fs.existsSync(caPath)) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', keyPath, '-out', caPath,
      '-days', '1', '-nodes', '-subj', '/CN=artifact-eval-mitm'], { stdio: 'ignore' });
  }
  const bundlePath = path.join(dir, 'bundle.pem');
  const roots = SYSTEM_ROOTS.find((p) => fs.existsSync(p));
  fs.writeFileSync(bundlePath, (roots ? fs.readFileSync(roots, 'utf8') : '') + fs.readFileSync(caPath, 'utf8'));
  return { dir, caPath, bundlePath };
}

/** A leaf certificate for `host`, signed by our CA. Cached — one openssl call per host per run. */
function certFor(ca: Ca, host: string, cache: Map<string, tls.SecureContext>): tls.SecureContext {
  const hit = cache.get(host);
  if (hit) return hit;
  const key = path.join(ca.dir, `${host}.key`);
  const csr = path.join(ca.dir, `${host}.csr`);
  const crt = path.join(ca.dir, `${host}.crt`);
  const ext = path.join(ca.dir, `${host}.ext`);
  fs.writeFileSync(ext, `subjectAltName=DNS:${host}\nextendedKeyUsage=serverAuth\n`);
  execFileSync('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', csr, '-subj', `/CN=${host}`], { stdio: 'ignore' });
  execFileSync('openssl', ['x509', '-req', '-in', csr, '-CA', ca.caPath, '-CAkey', path.join(ca.dir, 'ca.key'),
    '-CAcreateserial', '-out', crt, '-days', '1', '-extfile', ext], { stdio: 'ignore' });
  const ctx = tls.createSecureContext({ key: fs.readFileSync(key), cert: fs.readFileSync(crt) });
  cache.set(host, ctx);
  return ctx;
}

/**
 * The environment that puts a harness behind this proxy. Every client family is
 * covered because the harnesses are not one runtime: curl (the agents' shell
 * tool), Node (Claude Code, Pi, OpenCode), Rust (Codex) and Python all read
 * different variables.
 */
export function agentProxyEnv(proxyUrl: string, ca: Ca): Record<string, string> {
  return {
    HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl,
    http_proxy: proxyUrl, https_proxy: proxyUrl,
    // Replace-the-store variables get the COMBINED bundle, or real hosts stop verifying.
    CURL_CA_BUNDLE: ca.bundlePath, SSL_CERT_FILE: ca.bundlePath, REQUESTS_CA_BUNDLE: ca.bundlePath,
    // Additive, so it takes our CA alone.
    NODE_EXTRA_CA_CERTS: ca.caPath,
    NODE_USE_ENV_PROXY: '1',
  };
}

export interface RunningMitm { url: string; port: number; ca: Ca; stop(): Promise<void> }

export async function startMitmProxy(opts: {
  port: number;
  /** Only this host is decrypted and recorded; everything else is tunnelled untouched. */
  host: string;
  ledgerPath: string;
  caDir: string;
  /** Where a decrypted request is re-originated. Defaults to the host itself over https. */
  upstream?: string;
}): Promise<RunningMitm> {
  const ca = createCa(opts.caDir);
  const record = createRecorder(opts.ledgerPath);
  const certs = new Map<string, tls.SecureContext>();
  const target = new URL(opts.upstream ?? `https://${opts.host}`);
  const upstreamTransport = transportFor(target.href);

  const decrypted = https.createServer(
    { SNICallback: (name, cb) => cb(null, certFor(ca, name, certs)) },
    (req, res) => forwardExchange(req, res, { target, transport: upstreamTransport, rewriteHost: true, record }),
  );
  decrypted.on('tlsClientError', () => { /* a probe or an aborted handshake; not a request */ });

  // A blind tunnel is a pair of raw sockets owned by NEITHER server, so closing those leaves it
  // open and the process never exits — a run once printed PASS and then sat for an hour. They are
  // tracked here and destroyed on stop.
  const tunnels = new Set<import('node:stream').Duplex>();

  const proxy = http.createServer((req, res) => {
    // A plain-HTTP request through a forward proxy arrives in ABSOLUTE form
    // (`GET http://host/path`). Rewrite `url` in place — an IncomingMessage is a
    // stream, so spreading it into a copy drops every prototype method it needs.
    const absolute = new URL(req.url ?? '/', `http://${req.headers.host}`);
    req.url = absolute.pathname + absolute.search;
    forwardExchange(req, res, { target: new URL(`http://${absolute.host}`), transport: http, rewriteHost: false, record });
  });

  proxy.on('connect', (req, socket, head) => {
    const [host, port = '443'] = (req.url ?? '').split(':');
    socket.on('error', () => socket.destroy());
    if (host === opts.host) {
      // Hand the RAW socket to the TLS server and let IT do the handshake — building a
      // TLSSocket by hand skips SNI and the handshake never completes.
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) socket.unshift(head);
      decrypted.emit('connection', socket);
      return;
    }
    const upstream = net.connect(Number(port), host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    tunnels.add(socket).add(upstream);
    const forget = () => { tunnels.delete(socket); tunnels.delete(upstream); };
    socket.on('close', forget);
    upstream.on('close', forget);
    upstream.on('error', () => socket.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(opts.port, '127.0.0.1', () => resolve());
  });
  const port = (proxy.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    ca,
    // Bounded, because this is where a finished leg actually hung: a blind tunnel to a provider
    // can outlive the agent that opened it, and `close()` waits for it. See `lib/shutdown.ts`.
    stop: () => settleWithin(new Promise<void>((resolve) => {
      for (const s of tunnels) s.destroy();
      tunnels.clear();
      decrypted.closeAllConnections?.();
      proxy.closeAllConnections?.();
      proxy.close(() => resolve());
    }), TEARDOWN_MS).then(() => undefined),
  };
}

export type { LedgerEntry };
