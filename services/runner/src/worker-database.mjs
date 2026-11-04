// The worker half of `caps.db`: the connection's driver (postgres.js or mysql2, by its declared kind) over a byte
// tunnel the controller opens (database-tunnel.ts). It runs in the worker process (inside the network-less container
// in production), never in the isolate: the connection's password stays in this process and resolver code gets only
// a handle, rows and redacted errors. TLS runs here, end to end to the database; the controller forwards ciphertext.
import { isIP } from "node:net";
import { Duplex } from "node:stream";
import { describeDatabaseError } from "./database-errors.mjs";

/** RESOLVER_DATABASE_OPERATION in services/contracts (this file runs without the repository's packages). */
export const DATABASE_OPERATION = "artifactbin.pageBackend.db";
/** RESOLVER_DATABASE_LIMITS.windowBytes and .chunkBytes; pinned equal by services/app page-operations tests. */
export const WINDOW_BYTES = 256 * 1024, CHUNK_BYTES = 64 * 1024;
const MAX_SQL_BYTES = 256 * 1024, MAX_CLIENTS = 8;

/**
 * Each driver loads on a run's first connection of its kind, not at worker start: an intentional lazy import
 * (AGENTS.md), since every run's worker boots on the request path and most resolvers never connect (postgres.js is
 * about 12 ms of each boot). The keys are RESOLVER_DATABASE_KINDS in services/contracts, pinned equal by a test.
 */
const drivers = {};
const LOADERS = { postgres: () => import("postgres"), mysql: () => import("mysql2") };
export const DATABASE_KINDS = Object.freeze(Object.keys(LOADERS));
const loadDriver = (kind) => (drivers[kind] ??= LOADERS[kind]().then((module) => module.default));
const tunnelError = (code) => Object.assign(new Error(code), { code, tunnel: true });

/**
 * `send` writes one message to the controller; `call` is the worker's own capability call (the isolate's
 * generic call refuses DATABASE_OPERATION, so a connection's settings never reach resolver code).
 */
export function createDatabaseHost({ send, call }) {
    const tunnels = new Map(), clients = new Map();
    let nextTunnel = 0, nextClient = 0;

    /** A net.Socket stand-in for the drivers (and node:tls under them) whose bytes travel as tunnel messages. */
    class TunnelSocket extends Duplex {
        constructor(id, host, port) {
            super({ allowHalfOpen: false });
            // `_host` is what node:tls checks the certificate against when the driver passes no `servername` (mysql2
            // for an IP host); net.Socket sets it on connect, so this stand-in does too.
            Object.assign(this, { id, host, port, _host: host, opened: false, outstanding: 0, pendingAck: 0, waiting: null, closeSent: false });
            // A refused open fails the driver through `ready` or its own listener; it must never be unhandled.
            this.on("error", () => {});
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
        /**
         * `close` waits a turn: node:tls destroys this socket as it refuses a certificate and emits its own error on
         * the next tick, which must reach mysql2 before this close does (it would read as a lost connection).
         */
        _destroy(error, done) { this.close(); tunnels.delete(this.id); this.wake(); setImmediate(() => done(error)); }
        close() { if (!this.closeSent) { this.closeSent = true; send({ type: "tunnel_close", tunnel: this.id }); } }
        // Controller events.
        opened_() { this.opened = true; this.wake(); }
        data(payload) {
            const bytes = Buffer.from(String(payload), "base64");
            // The server's first byte, before any TLS: postgres.js reads its answer to SSLRequest ('S' or 'N') itself.
            this.firstByte ??= bytes[0];
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

    /**
     * Opens a tunnel to the granted target and returns its socket at once (writes wait until it opens: mysql2's
     * `stream` is synchronous); `socket.ready` resolves once the controller has connected it (postgres.js `socket`).
     */
    function tunnel(grant, host, port) {
        const socket = new TunnelSocket(++nextTunnel, host, port);
        socket.ready = new Promise((resolve, reject) => { socket.settle = { resolve, reject }; });
        socket.ready.catch(() => {});
        tunnels.set(socket.id, socket);
        send({ type: "tunnel_open", tunnel: socket.id, grant });
        return socket;
    }
    function message(msg) {
        const socket = tunnels.get(msg.tunnel);
        if (!socket) return;
        const settle = socket.settle;
        if (msg.type === "tunnel_opened" && settle) { socket.settle = null; socket.opened_(); settle.resolve(socket); }
        else if (msg.type === "tunnel_closed" && settle) {
            const error = tunnelError(typeof msg.error === "string" ? msg.error : "connection_closed");
            socket.settle = null; tunnels.delete(socket.id); socket.closeSent = true; socket.destroy(error); settle.reject(error);
        }
        else if (msg.type === "tunnel_data") socket.data(msg.data);
        else if (msg.type === "tunnel_ack") socket.ack(msg.bytes);
        else if (msg.type === "tunnel_closed") socket.closed(typeof msg.error === "string" ? msg.error : null);
    }

    const plain = (value) => value instanceof Uint8Array ? new Uint8Array(value) : Array.isArray(value) ? value.map(plain) : value;
    const plainRow = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, plain(v)]));
    const tlsOf = (c) => c.tls === "disable" ? null : { rejectUnauthorized: true, minVersion: "TLSv1.2", ...(c.ca ? { ca: c.ca } : {}) };

    /** postgres.js: one connection (max 1), lazily connected by the first query, reconnected after a loss. */
    function postgresClient(postgres, c) {
        const tls = tlsOf(c);
        // The connection's socket: a server without TLS answers SSLRequest 'N', and postgres.js then starts TLS anyway,
        // which the server drops (a reset like any other), so the refusal is known by that byte.
        let current = null;
        const sql = postgres({
            host: c.host, port: c.port, database: c.database, username: c.user, password: c.password,
            ssl: tls ? { ...tls, host: c.host, ...(isIP(c.host) ? {} : { servername: c.host }) } : false,
            socket: () => (current = tunnel(c.grant, c.host, c.port)).ready,
            // One connection per handle, so statements on a handle share a session (and a transaction).
            max: 1, idle_timeout: null, max_lifetime: null, connect_timeout: 10, fetch_types: false,
            // Its notice default prints to stdout, which is the controller link.
            onnotice: () => {}, onparameter: () => {}, debug: false,
            connection: { application_name: "artifactbin-resolver" },
        });
        return {
            async query(text, params) {
                const result = await sql.unsafe(text, params).catch((error) => {
                    if (tls && current?.firstByte === 78 && error && typeof error === "object" && !error.tunnel) error.tlsUnsupported = true;
                    throw error;
                });
                return { rows: Array.from(result, plainRow), columns: (result.columns ?? []).map((c) => c.name), command: result.command ?? null, count: result.count ?? null };
            },
            end: () => sql.end({ timeout: 1 }),
        };
    }

    /**
     * mysql2: one connection, made by the first query and again after a loss (as postgres.js does), over the tunnel
     * (`stream`). Placeholders are `?`: with params a statement is prepared on the server (`execute`, never
     * client-side escaping), without them it runs as text (`query`), so statements that cannot be prepared still run.
     * LOCAL INFILE and multiple statements are refused (client flags off, no infile stream). Types (README):
     * BIGINT and DECIMAL are strings (as postgres.js answers int8 and numeric), DATE/DATETIME/TIMESTAMP Dates in UTC
     * (the session's time_zone is set to UTC), binary values bytes, JSON parsed.
     */
    function mysqlClient(mysql, c) {
        const tls = tlsOf(c);
        const options = {
            host: c.host, port: c.port, database: c.database, user: c.user, password: c.password,
            ssl: tls ? { ...tls, verifyIdentity: true } : undefined,
            stream: () => tunnel(c.grant, c.host, c.port),
            flags: ["-LOCAL_FILES", "-MULTI_STATEMENTS"], multipleStatements: false,
            supportBigNumbers: true, bigNumberStrings: true, timezone: "Z", dateStrings: false, decimalNumbers: false,
            connectTimeout: 10_000, maxPreparedStatements: 64, debug: false, disableEval: true,
            connectAttributes: { program_name: "artifactbin-resolver" },
        };
        let live = null;
        function connect() {
            if (live) return live;
            const attempt = new Promise((resolve, reject) => {
                // A fresh ssl object per connection: mysql2 keys its TLS context and session caches on it.
                const connection = mysql.createConnection({ ...options, ssl: options.ssl && { ...options.ssl } });
                // A fatal error with no statement waiting is emitted here: never unhandled, and the next query reconnects.
                const lost = () => { if (live === attempt) live = null; };
                connection.on("error", lost);
                connection.on("end", lost);
                connection.connect((error) => {
                    if (error) { lost(); connection.destroy(); return reject(error); }
                    connection.query("SET time_zone = '+00:00'", (zoneError) => zoneError ? (lost(), connection.destroy(), reject(zoneError)) : resolve(connection));
                });
            });
            live = attempt;
            return attempt;
        }
        return {
            async query(text, params) {
                const connection = await connect();
                const [result, fields] = await new Promise((resolve, reject) => {
                    const done = (error, result, fields) => error ? reject(error) : resolve([result, fields]);
                    if (params.length) connection.execute(text, params, done); else connection.query(text, done);
                });
                return mysqlAnswer(text, result, fields);
            },
            async end() {
                const pending = live;
                live = null;
                const connection = await pending?.catch(() => null);
                if (!connection) return;
                await new Promise((resolve) => {
                    const timer = setTimeout(() => { connection.destroy(); resolve(); }, 1000);
                    connection.end(() => { clearTimeout(timer); resolve(); });
                });
            },
        };
    }
    /** mysql2 has no command tag: `command` is the statement's first word; a CALL answers its first result set. */
    function mysqlAnswer(text, result, fields) {
        if (Array.isArray(fields) && Array.isArray(fields[0])) { result = result[0]; fields = fields[0]; }
        const command = /^(?:\s+|--[^\n]*(?:\n|$)|#[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|\()*([A-Za-z]+)/.exec(text)?.[1]?.toUpperCase() ?? null;
        if (Array.isArray(result)) return { rows: result.map(plainRow), columns: (fields ?? []).map((f) => f.name), command, count: result.length };
        return { rows: [], columns: [], command, count: typeof result?.affectedRows === "number" ? result.affectedRows : null };
    }
    const CLIENTS = { postgres: postgresClient, mysql: mysqlClient };

    return {
        message,
        async open(name) {
            if (typeof name !== "string" || !name) throw Error("invalid_request: connection name");
            if (clients.size >= MAX_CLIENTS) throw Error("tunnel_limit");
            const c = await call(DATABASE_OPERATION, { name });
            if (!c || !Object.hasOwn(CLIENTS, c.kind)) throw Error("connection_unavailable: " + name);
            const driver = await loadDriver(c.kind);
            const id = ++nextClient;
            clients.set(id, { client: CLIENTS[c.kind](driver, c), secrets: [c.password] });
            return id;
        },
        async query(id, text, params) {
            const client = clients.get(id);
            if (!client) throw Error("connection_closed");
            if (typeof text !== "string" || !text || Buffer.byteLength(text) > MAX_SQL_BYTES) throw Error("invalid_request: sql must be a non-empty string under 256 KiB");
            if (params !== undefined && params !== null && !Array.isArray(params)) throw Error("invalid_request: params must be an array");
            try {
                return await client.client.query(text, params ?? []);
            } catch (error) { throw Error(describeDatabaseError(error, client.secrets)); }
        },
        async end(id) {
            const client = clients.get(id);
            if (!client) return null;
            clients.delete(id);
            await client.client.end().catch(() => {});
            return null;
        },
    };
}
