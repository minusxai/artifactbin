/**
 * THE RESOLVER DATABASE TUNNEL, controller side. A run never gets a socket: its worker sends tunnel messages
 * over the worker link and this module opens the TCP connection, forwarding bytes without reading them.
 * TLS runs from the driver in the worker to the database, so only ciphertext passes here.
 *
 * A run may connect only to a target the host granted it: `grant` takes the host/port the app answered for a
 * named connection and returns an opaque id; `tunnel_open` names that id, never an address. The host name is
 * resolved once, every answer must be a public address (`@artifactbin/utils/public-address`; one private
 * answer refuses the lot) and the socket connects to the exact address judged, so DNS cannot switch it to an
 * internal one between check and connect. `allowLoopback` (controller configuration, never a run) admits
 * loopback targets and plaintext for development and tests.
 *
 * Every limit is in RESOLVER_DATABASE_LIMITS. Each tunnel has a credit window per direction: the controller
 * sends at most `windowBytes` the worker has not acknowledged (and pauses the socket until it does), and a
 * worker that sends past its window loses the tunnel. Buffers stay bounded however slow either reader is.
 * `close()` destroys every socket of the run at once; the controller calls it before a run's receipt persists.
 *
 * State is per run, keyed by the run's own tunnel ids, so a later warm worker can hold tunnels across calls.
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import { RESOLVER_DATABASE_LIMITS, type RunnerJson } from '@artifactbin/contracts';
import { hostNameSyntax, isAllowedAddress, parseIPv4, parseIPv6 } from '@artifactbin/utils/public-address';

type DatabaseTunnelLimits = { -readonly [K in keyof typeof RESOLVER_DATABASE_LIMITS]: number };
interface LookupAddress { address: string; family: number }
export interface DatabaseTunnelOptions {
  /** Development and tests only: admit loopback targets and plaintext (`tls: 'disable'`). Off by default. */
  allowLoopback?: boolean;
  limits?: Partial<DatabaseTunnelLimits>;
  /** Every address a name resolves to (default: one `dns.lookup` with `all`). */
  lookup?: (host: string) => Promise<LookupAddress[]>;
  /** Opens one TCP connection to an address already judged (default `net.connect`). */
  connect?: (target: { host: string; port: number; family: number }) => net.Socket;
}
/** Who a run's tunnels count against. */
export interface TunnelScope { owner: string; page: string }
type TunnelSend = (message: { type: string; [key: string]: RunnerJson }) => void;
export interface RunTunnels {
  /** Registers a target for this run and returns the value the worker gets, with `grant` added. Throws a refusal code. */
  grant(value: RunnerJson): RunnerJson;
  /** One `tunnel_*` message from the worker. Synchronous, so data stays in order. */
  message(message: { type: string; [key: string]: unknown }): void;
  /** Destroys every tunnel of the run now. Idempotent. */
  close(): void;
}
export interface DatabaseTunnels {
  forRun(scope: TunnelScope, send: TunnelSend): RunTunnels;
  /** Tunnels open (or connecting) now: in total, for an owner, for a page. */
  openCount(scope?: Partial<TunnelScope>): number;
}

interface Target { host: string; port: number }
interface Tunnel {
  id: number;
  target: Target;
  state: 'connecting' | 'open' | 'closed';
  socket?: net.Socket;
  connectTimer?: ReturnType<typeof setTimeout>;
  idleTimer?: ReturnType<typeof setTimeout>;
  /** Bytes sent to the worker it has not acknowledged. */
  unackedIn: number;
  /** Bytes the worker sent that the socket has not flushed. */
  inflightOut: number;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const isIp = (host: string) => !!parseIPv4(host) || !!parseIPv6(host);
/** Read through a call: the state changes across the awaits in `start`, which narrowing cannot see. */
const isClosed = (t: Tunnel) => t.state === 'closed';

export function createDatabaseTunnels(options: DatabaseTunnelOptions = {}): DatabaseTunnels {
  const limits: DatabaseTunnelLimits = { ...RESOLVER_DATABASE_LIMITS, ...options.limits };
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value < 1) throw Error('invalid_tunnel_limits');
  const policy = { allowLoopback: !!options.allowLoopback };
  const lookup = options.lookup ?? (async (host: string) => dns.lookup(host, { all: true, verbatim: true }));
  const connect = options.connect ?? ((target) => net.connect({ host: target.host, port: target.port, family: target.family }));
  const owners = new Map<string, number>(), pages = new Map<string, number>();
  let total = 0;
  const bump = (map: Map<string, number>, key: string, by: number) => { const n = (map.get(key) ?? 0) + by; if (n > 0) map.set(key, n); else map.delete(key); };

  /** The app's answer for a named connection, re-checked here: the address rules are this module's to enforce. */
  function vet(value: RunnerJson): Target {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid_connection');
    const host = typeof value.host === 'string' ? hostNameSyntax(value.host) : null;
    const port = value.port;
    if (!host || typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) throw Error('invalid_connection');
    if (port < limits.minPort) throw Error(`port_forbidden: below ${limits.minPort}`);
    if (value.tls !== 'verify-full' && value.tls !== 'disable') throw Error('invalid_connection');
    if (value.tls === 'disable' && !policy.allowLoopback) throw Error('tls_required');
    if (isIp(host) && !isAllowedAddress(host, policy)) throw Error('forbidden_address');
    return { host, port };
  }

  function forRun(scope: TunnelScope, send: TunnelSend): RunTunnels {
    const grants = new Map<string, Target>();
    const tunnels = new Map<number, Tunnel>();
    const used = new Set<number>();
    let opened = 0, bytesIn = 0, bytesOut = 0, messages = 0, closed = false;

    const touch = (t: Tunnel) => {
      clearTimeout(t.idleTimer);
      t.idleTimer = setTimeout(() => finish(t, 'tunnel_idle_timeout'), limits.idleTimeoutMs);
    };
    /** Ends a tunnel once: destroys its socket, releases its counts and (unless the run is closing) tells the worker. */
    function finish(t: Tunnel, error: string | null, notify = true) {
      if (t.state === 'closed') return;
      t.state = 'closed';
      clearTimeout(t.connectTimer); clearTimeout(t.idleTimer);
      t.socket?.destroy();
      tunnels.delete(t.id);
      total--; bump(owners, scope.owner, -1); bump(pages, scope.page, -1);
      if (notify && !closed) send({ type: 'tunnel_closed', tunnel: t.id, ...(error ? { error } : {}) });
    }
    const refuse = (id: number, error: string) => { if (!closed) send({ type: 'tunnel_closed', tunnel: id, error }); };

    async function start(t: Tunnel) {
      t.connectTimer = setTimeout(() => finish(t, 'connect_timeout'), limits.connectTimeoutMs);
      let addresses: LookupAddress[];
      if (isIp(t.target.host)) addresses = [{ address: t.target.host, family: parseIPv4(t.target.host) ? 4 : 6 }];
      else {
        try { addresses = await lookup(t.target.host); }
        catch { return finish(t, 'dns_failed'); }
      }
      if (isClosed(t)) return;
      if (!Array.isArray(addresses) || !addresses.length) return finish(t, 'dns_failed');
      // One address outside public space refuses them all: a name never gets to pick an internal one later.
      if (!addresses.every(a => a && typeof a.address === 'string' && isAllowedAddress(a.address, policy))) return finish(t, 'forbidden_address');
      for (const { address, family } of addresses) {
        if (isClosed(t)) return;
        const socket = connect({ host: address, port: t.target.port, family: family === 6 ? 6 : 4 });
        t.socket = socket;
        const ok = await new Promise<boolean>(resolve => {
          socket.once('connect', () => resolve(true));
          socket.once('error', () => resolve(false));
          socket.once('close', () => resolve(false));
        });
        if (isClosed(t)) { socket.destroy(); return; }
        if (ok) return opened_(t, socket);
        socket.destroy();
      }
      finish(t, 'connect_failed');
    }
    function opened_(t: Tunnel, socket: net.Socket) {
      clearTimeout(t.connectTimer);
      t.state = 'open';
      socket.setNoDelay(true);
      socket.on('data', (chunk: Buffer) => {
        if (t.state !== 'open') return;
        bytesIn += chunk.length;
        if (bytesIn > limits.bytesInPerRun) return finish(t, 'tunnel_byte_limit');
        touch(t);
        for (let at = 0; at < chunk.length; at += limits.chunkBytes)
          send({ type: 'tunnel_data', tunnel: t.id, data: chunk.subarray(at, at + limits.chunkBytes).toString('base64') });
        t.unackedIn += chunk.length;
        // Backpressure: the database waits (TCP) until the worker has consumed what it was sent.
        if (t.unackedIn >= limits.windowBytes) socket.pause();
      });
      socket.on('error', () => finish(t, 'connection_lost'));
      socket.on('close', () => finish(t, null));
      touch(t);
      send({ type: 'tunnel_opened', tunnel: t.id });
    }

    function open(id: number, grant: unknown) {
      if (used.has(id)) return refuse(id, 'tunnel_protocol');
      used.add(id);
      const target = typeof grant === 'string' ? grants.get(grant) : undefined;
      if (!target) return refuse(id, 'unknown_connection');
      if (opened >= limits.connectionsPerRun) return refuse(id, 'tunnel_limit');
      if ((owners.get(scope.owner) ?? 0) >= limits.connectionsPerOwner || (pages.get(scope.page) ?? 0) >= limits.connectionsPerPage) return refuse(id, 'tunnel_busy');
      if (bytesIn >= limits.bytesInPerRun || bytesOut >= limits.bytesOutPerRun) return refuse(id, 'tunnel_byte_limit');
      opened++; total++; bump(owners, scope.owner, 1); bump(pages, scope.page, 1);
      const t: Tunnel = { id, target, state: 'connecting', unackedIn: 0, inflightOut: 0 };
      tunnels.set(id, t);
      void start(t).catch(() => finish(t, 'connect_failed'));
    }
    function data(t: Tunnel, payload: unknown) {
      if (t.state !== 'open') return finish(t, 'tunnel_protocol');
      if (typeof payload !== 'string' || !payload || payload.length > Math.ceil(limits.chunkBytes / 3) * 4 || payload.length % 4 || !BASE64.test(payload)) return finish(t, 'tunnel_protocol');
      const bytes = Buffer.from(payload, 'base64');
      if (bytes.length > limits.chunkBytes) return finish(t, 'tunnel_protocol');
      if (t.inflightOut + bytes.length > limits.windowBytes) return finish(t, 'tunnel_window_exceeded');
      bytesOut += bytes.length;
      if (bytesOut > limits.bytesOutPerRun) return finish(t, 'tunnel_byte_limit');
      t.inflightOut += bytes.length;
      touch(t);
      t.socket!.write(bytes, error => {
        if (error || t.state !== 'open') return;
        t.inflightOut -= bytes.length;
        send({ type: 'tunnel_ack', tunnel: t.id, bytes: bytes.length });
      });
    }
    function ack(t: Tunnel, bytes: unknown) {
      if (t.state !== 'open' || typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > t.unackedIn) return finish(t, 'tunnel_protocol');
      t.unackedIn -= bytes;
      if (t.unackedIn < limits.windowBytes && t.socket!.isPaused()) t.socket!.resume();
    }
    /** The worker is done with a tunnel: flush what it wrote, then close. */
    function end(t: Tunnel) {
      if (t.state !== 'open') return finish(t, null, false);
      const socket = t.socket!;
      socket.end(() => finish(t, null, false));
    }

    return {
      grant(value) {
        if (closed) throw Error('run_revoked');
        const target = vet(value);
        const id = `g${grants.size + 1}`;
        grants.set(id, target);
        return { ...(value as Record<string, RunnerJson>), host: target.host, port: target.port, grant: id };
      },
      message(msg) {
        if (closed) return;
        if (++messages > limits.messagesPerRun) {
          for (const t of [...tunnels.values()]) finish(t, 'tunnel_message_limit');
          return;
        }
        const id = msg.tunnel;
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) return;
        if (msg.type === 'tunnel_open') return open(id, msg.grant);
        const t = tunnels.get(id);
        if (!t) return; // already closed: a message that crossed the close in flight
        if (msg.type === 'tunnel_data') return data(t, msg.data);
        if (msg.type === 'tunnel_ack') return ack(t, msg.bytes);
        if (msg.type === 'tunnel_close') return end(t);
        finish(t, 'tunnel_protocol');
      },
      close() {
        if (closed) return;
        closed = true;
        for (const t of [...tunnels.values()]) finish(t, null, false);
      },
    };
  }

  return {
    forRun,
    openCount(scope = {}) {
      if (scope.owner !== undefined) return owners.get(scope.owner) ?? 0;
      if (scope.page !== undefined) return pages.get(scope.page) ?? 0;
      return total;
    },
  };
}
