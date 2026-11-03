// The worker half of `caps.postgres`: postgres.js over a byte tunnel the controller opens (database-tunnel.ts).
// It runs in the worker process (inside the network-less container in production), never in the isolate: the
// connection's password stays in this process and resolver code gets only a handle, rows and redacted errors.
// TLS runs here, end to end to the database; the controller forwards ciphertext.
import { isIP } from "node:net";
import { Duplex } from "node:stream";

/** RESOLVER_DATABASE_OPERATION in services/contracts (this file runs without the repository's packages). */
export const DATABASE_OPERATION = "artifactbin.pageBackend.postgres";
/** RESOLVER_DATABASE_LIMITS.windowBytes and .chunkBytes; pinned equal by services/app page-operations tests. */
export const WINDOW_BYTES = 256 * 1024, CHUNK_BYTES = 64 * 1024;
const MAX_SQL_BYTES = 256 * 1024, MAX_CLIENTS = 8;

/**
 * The driver loads on a run's first connection, not at worker start: an intentional lazy import (AGENTS.md), since
 * every run's worker boots on the request path and most resolvers never connect (about 12 ms of each boot).
 */
let driver;
const loadDriver = () => (driver ??= import("postgres").then((module) => module.default));
const tunnelError = (code) => Object.assign(new Error(code), { code, tunnel: true });

/**
 * `send` writes one message to the controller; `call` is the worker's own capability call (the isolate's
 * generic call refuses DATABASE_OPERATION, so a connection's settings never reach resolver code).
 */
export function createDatabaseHost({ send, call }) {
    const tunnels = new Map(), clients = new Map();
    let nextTunnel = 0, nextClient = 0;

    /** A net.Socket stand-in for postgres.js (and node:tls under it) whose bytes travel as tunnel messages. */
    class TunnelSocket extends Duplex {
        constructor(id, host, port) {
            super({ allowHalfOpen: false });
            Object.assign(this, { id, host, port, opened: false, outstanding: 0, pendingAck: 0, waiting: null, closeSent: false });
        }
        get readyState() { return this.destroyed ? "closed" : this.opened ? "open" : "opening"; }
        setKeepAlive() { return this; }
        setNoDelay() { return this; }
        ref() { return this; }
        unref() { return this; }
        /** The reader wants more: acknowledge what it consumed, so the controller may send again. */
        _read() { this.flushAck(); }
        flushAck() { if (this.pendingAck && !this.destroyed) { send({ type: "tunnel_ack", tunnel: this.id, bytes: this.pendingAck }); this.pendingAck = 0; } }
        _write(chunk, _encoding, done) { this.pump(chunk, 0, done); }
        /** Sends while the window allows; otherwise waits for an acknowledgement (backpressure to the driver). */
        pump(chunk, at, done) {
            while (at < chunk.length) {
                if (this.destroyed) return done(tunnelError("connection_closed"));
                const piece = chunk.subarray(at, at + CHUNK_BYTES);
                if (!this.opened || this.outstanding + piece.length > WINDOW_BYTES) { this.waiting = () => this.pump(chunk, at, done); return; }
                this.outstanding += piece.length;
                at += piece.length;
                send({ type: "tunnel_data", tunnel: this.id, data: piece.toString("base64") });
            }
            done();
        }
        wake() { const next = this.waiting; this.waiting = null; next?.(); }
        _final(done) { this.close(); done(); }
        _destroy(error, done) { this.close(); tunnels.delete(this.id); this.wake(); done(error); }
        close() { if (!this.closeSent) { this.closeSent = true; send({ type: "tunnel_close", tunnel: this.id }); } }
        // Controller events.
        opened_() { this.opened = true; this.wake(); }
        data(payload) {
            const bytes = Buffer.from(String(payload), "base64");
            this.pendingAck += bytes.length;
            if (this.push(bytes)) this.flushAck();
        }
        ack(bytes) { this.outstanding = Math.max(0, this.outstanding - Number(bytes)); this.wake(); }
        closed(error) {
            this.closeSent = true;
            tunnels.delete(this.id);
            if (error) this.destroy(tunnelError(error));
            else { this.push(null); this.end(); }
        }
    }

    /** Opens a tunnel to the granted target; resolves once the controller has connected it. */
    function tunnel(grant, host, port) {
        const socket = new TunnelSocket(++nextTunnel, host, port);
        return new Promise((resolve, reject) => {
            socket.settle = { resolve, reject };
            tunnels.set(socket.id, socket);
            send({ type: "tunnel_open", tunnel: socket.id, grant });
        });
    }
    function message(msg) {
        const socket = tunnels.get(msg.tunnel);
        if (!socket) return;
        const settle = socket.settle;
        if (msg.type === "tunnel_opened" && settle) { socket.settle = null; socket.opened_(); settle.resolve(socket); }
        else if (msg.type === "tunnel_closed" && settle) { socket.settle = null; tunnels.delete(socket.id); socket.closeSent = true; socket.destroy(); settle.reject(tunnelError(typeof msg.error === "string" ? msg.error : "connection_closed")); }
        else if (msg.type === "tunnel_data") socket.data(msg.data);
        else if (msg.type === "tunnel_ack") socket.ack(msg.bytes);
        else if (msg.type === "tunnel_closed") socket.closed(typeof msg.error === "string" ? msg.error : null);
    }

    /** One line, bounded, the password removed; a tunnel refusal is its bare code, a server error `database_error: SQLSTATE message`. */
    function describe(error, secrets) {
        let text;
        if (error?.tunnel) text = String(error.code);
        else if (error?.name === "PostgresError") text = `database_error: ${error.code ?? ""} ${error.message}`;
        else text = `database_error: ${error?.code && typeof error.code === "string" ? error.code : String(error?.message ?? "failed")}`;
        for (const secret of secrets) if (secret) text = text.split(secret).join("[redacted]");
        return text.split(/\r?\n/, 1)[0].slice(0, 300);
    }
    const plain = (value) => value instanceof Uint8Array ? new Uint8Array(value) : Array.isArray(value) ? value.map(plain) : value;

    return {
        message,
        async open(name) {
            if (typeof name !== "string" || !name) throw Error("invalid_request: connection name");
            if (clients.size >= MAX_CLIENTS) throw Error("tunnel_limit");
            const [postgres, c] = await Promise.all([loadDriver(), call(DATABASE_OPERATION, { name })]);
            const secrets = [c.password];
            const ssl = c.tls === "disable" ? false : { rejectUnauthorized: true, host: c.host, minVersion: "TLSv1.2", ...(isIP(c.host) ? {} : { servername: c.host }), ...(c.ca ? { ca: c.ca } : {}) };
            const sql = postgres({
                host: c.host, port: c.port, database: c.database, username: c.user, password: c.password, ssl,
                socket: () => tunnel(c.grant, c.host, c.port),
                // One connection per handle, so statements on a handle share a session (and a transaction).
                max: 1, idle_timeout: null, max_lifetime: null, connect_timeout: 10, fetch_types: false,
                // Its notice default prints to stdout, which is the controller link.
                onnotice: () => {}, onparameter: () => {}, debug: false,
                connection: { application_name: "artifactbin-resolver" },
            });
            const id = ++nextClient;
            clients.set(id, { sql, secrets });
            return id;
        },
        async query(id, text, params) {
            const client = clients.get(id);
            if (!client) throw Error("connection_closed");
            if (typeof text !== "string" || !text || Buffer.byteLength(text) > MAX_SQL_BYTES) throw Error("invalid_request: sql must be a non-empty string under 256 KiB");
            if (params !== undefined && params !== null && !Array.isArray(params)) throw Error("invalid_request: params must be an array");
            try {
                const result = await client.sql.unsafe(text, params ?? []);
                return { rows: Array.from(result, (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, plain(v)]))), columns: (result.columns ?? []).map((c) => c.name), command: result.command ?? null, count: result.count ?? null };
            } catch (error) { throw Error(describe(error, client.secrets)); }
        },
        async end(id) {
            const client = clients.get(id);
            if (!client) return null;
            clients.delete(id);
            await client.sql.end({ timeout: 1 }).catch(() => {});
            return null;
        },
    };
}
