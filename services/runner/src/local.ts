import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RESOLVER_DATABASE_CHECK_OPERATION, RESOLVER_DATABASE_OPERATION, RESOLVER_LIMITS, type RunStart, type RunWait, type RunReceipt, type RunnerJson, type RunnerLimits, type RunnerService, type RunEvent, type RunSnapshot, type ResolverFetchReceipt } from '@artifactbin/contracts';
import { bundleSource } from './compiler';
import { initializeStore, ownedRun, type RunnerDatabase, type RunRow } from './store';
import { createWorkerPool, startWorker, type Worker, type WorkerMessage } from './worker-pool';
import { createDatabaseTunnels, type DatabaseTunnelOptions, type RunTunnels } from './database-tunnel';
const worker = fileURLToPath(new URL('./runner-worker.mjs', import.meta.url));
const defaults: RunnerLimits = { timeoutMs: 30000, cpuMs: 200, memoryMiB: 64, maxRequests: 100, maxOutputBytes: RESOLVER_LIMITS.outputBytes };
const terminal = (s: string) => !['queued', 'running'].includes(s);
export interface CapabilityContext {
    runId: string;
    callId?: number;
    request: RunStart;
    signal: AbortSignal;
    requests: RunReceipt['requests'];
    usage: RunReceipt['usage'];
    observation?: RunReceipt['requests'][number];
}
export interface RunnerOptions {
    db: RunnerDatabase;
    capabilities: (context: CapabilityContext, operation: string, args: RunnerJson) => Promise<RunnerJson>;
    dockerImage?: string;
    maxConcurrent?: number;
    maxQueued?: number;
    /**
     * Worker processes kept started ahead of demand (default 2, at most `maxConcurrent`). Each still
     * runs exactly one program and is then killed. Ignored with `dockerImage`.
     */
    prestartedWorkers?: number;
    ceilings?: Partial<RunnerLimits>;
    /** `caps.db` tunnels (database-tunnel.ts). `allowLoopback` is controller configuration for development only. */
    database?: DatabaseTunnelOptions;
}
interface Active {
    request: RunStart;
    bundle: string;
    admittedAt: string;
    startedAt: string | null;
    limits: RunnerLimits;
    controller: AbortController;
    child?: ChildProcessWithoutNullStreams;
    /** The worker sent `started`: resolver code may have run, so the run never moves to another worker. */
    accepted?: boolean;
    /** The run already moved once, off a pooled worker lost before it accepted the run. */
    moved?: boolean;
    containerCreation?: Promise<void>;
    timer?: ReturnType<typeof setTimeout>;
    finishing?: Promise<void>;
    resolve: () => void;
    done: Promise<void>;
    sequence: number;
    eventBytes: number;
    rpcCount: number;
    requestCount: number;
    inflight: Set<number>;
    tail: Promise<unknown>;
    requests: RunReceipt['requests'];
    usage: RunReceipt['usage'];
    /** Database tunnels this run opened, created with its first granted connection. */
    tunnels?: RunTunnels;
}
function json(value: unknown, max: number): string { const s = JSON.stringify(value); if (s === undefined || Buffer.byteLength(s) > max)
    throw Error('size_limit'); return s; }
/** The app's fetch observation belongs in the receipt, not in what resolver code receives. */
function takeFetchReceipt(value: RunnerJson, durationMs: number, requests: RunReceipt['requests']): RunnerJson {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !value.receipt || typeof value.receipt !== 'object' || Array.isArray(value.receipt))
        return value;
    const { receipt, ...rest } = value;
    const r = receipt as Record<string, RunnerJson>;
    const fetch: ResolverFetchReceipt = { method: String(r.method), host: String(r.host), path: String(r.path), bytesIn: Number(r.bytesIn), bytesOut: Number(r.bytesOut), secrets: Array.isArray(r.secrets) ? r.secrets.map(String) : [] };
    requests.push({ service: 'fetch', operation: 'artifactbin.pageBackend.fetch', durationMs, status: typeof rest.status === 'number' ? rest.status : null, requestId: null, fetch });
    return rest;
}
function canonical(v: unknown): string { if (Array.isArray(v))
    return '[' + v.map(canonical).join(',') + ']'; if (v && typeof v === 'object')
    return '{' + Object.entries(v).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}'; return JSON.stringify(v); }
/** A single durable controller; isolate processes are never reused between runs. */
export async function createRunner(options: RunnerOptions): Promise<RunnerService & {
    close(): Promise<void>;
}> {
    const { db } = options;
    await initializeStore(db);
    const active = new Map<string, Active>();
    const databases = createDatabaseTunnels(options.database);
    /** The run's tunnels: counted against its owner and its page (the admitted principal's tenant). */
    function tunnelsOf(id: string, r: Active): RunTunnels {
        if (!r.tunnels) {
            const input = r.request.input, principal = input && typeof input === 'object' && !Array.isArray(input) ? input.principal : null;
            const page = principal && typeof principal === 'object' && !Array.isArray(principal) && typeof principal.tenant === 'string' ? principal.tenant : r.request.artifactId ?? id;
            r.tunnels = databases.forRun({ owner: r.request.userId, page }, msg => { if (!r.finishing && r.child) r.child.stdin.write(JSON.stringify(msg) + '\n'); });
        }
        return r.tunnels;
    }
    let closed = false;
    let admission = Promise.resolve();
    let pumping = false;
    const ceilings = { ...defaults, ...options.ceilings };
    for (const value of Object.values(ceilings))
        if (!Number.isSafeInteger(value) || value < 1)
            throw Error('invalid_ceilings');
    if (ceilings.memoryMiB < 8)
        throw Error('invalid_ceilings');
    const maxConcurrent = options.maxConcurrent ?? 4, maxQueued = options.maxQueued ?? 100;
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || !Number.isInteger(maxQueued) || maxQueued < 1)
        throw Error('invalid_capacity');
    const prestarted = options.prestartedWorkers ?? 2;
    if (!Number.isInteger(prestarted) || prestarted < 0)
        throw Error('invalid_capacity');
    async function persist(id: string, row: Pick<RunRow, 'admitted_at' | 'started_at'>, status: RunReceipt['status'], reason: string | null, output: RunnerJson, requests: RunReceipt['requests'] = [], usage: RunReceipt['usage'] = [], cpuMs: number | null = null) {
        const finishedAt = new Date().toISOString();
        const receipt: RunReceipt = { runId: id, status, reason, admittedAt: row.admitted_at, startedAt: row.started_at, finishedAt, durationMs: Date.parse(finishedAt) - Date.parse(row.admitted_at), cpuMs, peakMemoryBytes: null, requests, usage, estimatedDollars: null, pricingVersion: null };
        await db.query('UPDATE runner_runs SET status=$2,receipt=$3,output=$4 WHERE id=$1', [id, status, JSON.stringify(receipt), JSON.stringify(output)]);
    }
    // Recovery never replays side effects. A deployment must give each controller its own DB.
    for (const row of (await db.query<RunRow>("SELECT * FROM runner_runs WHERE status IN ('queued','running')")).rows) {
        if (options.dockerImage)
            await removeContainer(row.id);
        await persist(row.id, row, 'interrupted', 'host_restart', null);
    }
    const pool = options.dockerImage ? undefined : createWorkerPool({ size: Math.min(prestarted, maxConcurrent), spawnChild: () => spawn(process.execPath, ['--no-node-snapshot', worker], { stdio: ['pipe', 'pipe', 'pipe'], env: {} }) });
    async function removeContainer(id: string) { await new Promise<void>((resolve, reject) => { const p = spawn('docker', ['rm', '-f', `afbin-run-${id}`], { stdio: 'ignore' }); p.once('error', reject); p.once('close', () => resolve()); }); }
    async function finish(id: string, status: RunReceipt['status'], reason: string | null = null, output: RunnerJson = null, cpuMs: number | null = null): Promise<void> {
        const run = active.get(id);
        if (!run)
            return;
        if (run.finishing)
            return run.finishing;
        run.finishing = (async () => {
            clearTimeout(run.timer);
            run.controller.abort();
            // Every database socket closes with the run, before its worker is reaped or its receipt saved.
            run.tunnels?.close();
            // A Docker daemon may still be creating the named container after its CLI is killed.
            // Fence creation before reaping; a terminal receipt must never precede cleanup.
            if (run.containerCreation) {
                await run.containerCreation.catch(() => {});
                await removeContainer(id);
            }
            if (run.child) {
                const child = run.child;
                const exited = new Promise<void>(resolve => { if (child.exitCode !== null || child.signalCode !== null)
                    resolve();
                else
                    child.once('close', () => resolve()); });
                child.kill('SIGKILL');
                if (options.dockerImage)
                    await removeContainer(id);
                await exited;
            }
            try {
                await run.tail;
            }
            catch {
                status = 'failed';
                reason = 'event_persistence_failed';
                output = null;
            }
            await persist(id, { admitted_at: run.admittedAt, started_at: run.startedAt }, status, reason, output, run.requests, run.usage, cpuMs);
            active.delete(id);
            run.resolve();
            void pump();
        })();
        return run.finishing;
    }
    const fail = (id: string, e: unknown) => { void finish(id, 'failed', e instanceof Error ? e.message : 'run_failed').catch(() => { closed = true; }); };
    async function message(id: string, msg: WorkerMessage & {
        id?: number;
        operation?: string;
        args?: RunnerJson;
        result?: RunnerJson;
        error?: string;
        cpuMs?: number;
    }) {
        const r = active.get(id);
        if (!r || r.finishing)
            return;
        // Tunnel bytes are handled synchronously, in arrival order, before anything here awaits.
        if (typeof msg.type === 'string' && msg.type.startsWith('tunnel_')) {
            tunnelsOf(id, r).message(msg);
            return;
        }
        if (msg.type === 'started') {
            r.accepted = true;
            return;
        }
        if (msg.type === 'ready') {
            r.child!.stdin.write(JSON.stringify({ type: 'run', bundle: r.bundle, input: r.request.input, env: r.request.env ?? {}, memoryMiB: r.limits.memoryMiB, cpuMs: r.limits.cpuMs }) + '\n');
            return;
        }
        if (msg.type === 'error') {
            await finish(id, 'failed', String(msg.error).slice(0, 2000));
            return;
        }
        if (msg.type === 'result') {
            if (r.inflight.size) {
                await finish(id, 'failed', 'dangling_capabilities');
                return;
            }
            const output = msg.result ?? null;
            if (Buffer.byteLength(JSON.stringify(output)) > r.limits.maxOutputBytes) {
                await finish(id, 'failed', 'output_limit');
                return;
            }
            await finish(id, 'completed', null, output, Number.isFinite(msg.cpuMs) ? msg.cpuMs! : null);
            return;
        }
        if (msg.type !== 'call' || !Number.isSafeInteger(msg.id) || typeof msg.operation !== 'string')
            throw Error('invalid_worker_message');
        const callId = msg.id!;
        if (r.inflight.has(callId) || ++r.rpcCount > 10000)
            throw Error('rpc_limit');
        r.inflight.add(callId);
        try {
            let value: RunnerJson;
            if (msg.operation === 'emit') {
                const event = msg.args ?? null;
                r.eventBytes += Buffer.byteLength(json(event, 256 * 1024));
                if (r.sequence >= 1000 || r.eventBytes > 4 * 1024 * 1024)
                    throw Error('event_limit');
                const sequence = ++r.sequence;
                const pending = r.tail.then(() => db.query('INSERT INTO runner_events VALUES($1,$2,$3)', [id, sequence, JSON.stringify(event)]));
                r.tail = pending;
                await pending;
                value = { sequence };
            }
            else {
                // The worker's per-query check is not resolver work (resolver code cannot send it: runner-worker.mjs).
                if (msg.operation !== RESOLVER_DATABASE_CHECK_OPERATION && ++r.requestCount > r.limits.maxRequests)
                    throw Error('request_limit');
                const started = Date.now();
                value = await options.capabilities({ runId: id, callId, request: r.request, signal: r.controller.signal, requests: r.requests, usage: r.usage }, msg.operation, msg.args ?? null);
                if (msg.operation === 'artifactbin.pageBackend.fetch')
                    value = takeFetchReceipt(value, Date.now() - started, r.requests);
                // A named connection's target becomes a grant only this run's tunnels can name.
                if (msg.operation === RESOLVER_DATABASE_OPERATION)
                    value = tunnelsOf(id, r).grant(value);
            }
            if (!r.finishing)
                r.child!.stdin.write(json({ type: 'response', id: callId, value }, RESOLVER_LIMITS.messageBytes) + '\n');
        }
        catch (e) {
            if (!r.finishing)
                r.child!.stdin.write(JSON.stringify({ type: 'response', id: callId, error: e instanceof Error ? e.message : 'capability_failed' }) + '\n');
        }
        finally {
            r.inflight.delete(callId);
        }
    }
    async function launch(id: string, r: Active) {
        r.startedAt = new Date().toISOString();
        await db.query("UPDATE runner_runs SET status='running',started_at=$2 WHERE id=$1 AND status='queued'", [id, r.startedAt]);
        if (r.finishing)
            return;
        r.timer = setTimeout(() => { void finish(id, 'failed', 'timeout'); }, r.limits.timeoutMs);
        if (options.dockerImage) {
            // Create and start are distinct lifecycle operations: cancellation can await creation
            // without launching author code, then remove the exact named resource.
            r.containerCreation = new Promise<void>((resolve, reject) => {
                const creation = spawn('docker', ['create', '--rm', '--name', `afbin-run-${id}`, '--label', 'artifactbin.runner=true', '-i', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '1000:1000', '--memory', `${r.limits.memoryMiB + 128}m`, '--cpus', '1', '--pids-limit', '32', options.dockerImage!], { stdio: ['ignore', 'ignore', 'pipe'] });
                let error = '';
                creation.stderr.on('data', (bytes: Buffer) => { error = (error + bytes.toString()).slice(0, 2000); });
                creation.once('error', reject);
                creation.once('close', code => code === 0 ? resolve() : reject(Error(error || 'container_creation_failed')));
            });
            await r.containerCreation;
            if (r.finishing) return;
        }
        hand(id, r, options.dockerImage ? startWorker(() => spawn('docker', ['start', '-a', '-i', `afbin-run-${id}`], { stdio: ['pipe', 'pipe', 'pipe'] })) : pool!.take());
    }
    /**
     * Gives the run to a worker. A pooled worker lost before it accepted the run (it died as a spare, unheard, or at
     * hand-off) ran no resolver code, so the run moves once to a fresh one; lost after `started`, it ends `worker_exit`.
     */
    function hand(id: string, r: Active, worker: Worker) {
        const child = r.child = worker.child;
        r.accepted = false;
        const current = () => r.child === child && !r.finishing;
        const movable = () => !!pool && !r.accepted && !r.moved;
        // `close` follows `exit` once stdout is drained, so a `started` the worker wrote before dying has been heard.
        const lost = () => child.once('close', () => {
            if (!current()) return;
            if (!movable()) return void finish(id, 'interrupted', 'worker_exit');
            r.moved = true;
            try { hand(id, r, pool!.take()); }
            catch (e) { fail(id, e); }
        });
        worker.claim({
            message: msg => { if (r.child === child) void message(id, msg).catch(e => fail(id, e)); },
            fault: reason => {
                if (!current()) return;
                // The `run` write met a dead process: its exit decides whether the run moves.
                if (reason === 'worker_stdin_closed' && movable()) child.kill('SIGKILL');
                else fail(id, Error(reason));
            },
            startFailed: () => { if (current()) void finish(id, 'interrupted', 'worker_start_failed'); },
            exit: () => { if (!current()) return; if (movable()) lost(); else void finish(id, 'interrupted', 'worker_exit'); },
        });
    }
    async function pump() { if (pumping || closed)
        return; pumping = true; try {
        for (const [id, r] of active) {
            if ([...active.values()].filter(a => a.startedAt).length >= maxConcurrent)
                break;
            if (!r.startedAt && !r.finishing)
                await launch(id, r).catch(e => fail(id, e));
        }
    }
    finally {
        pumping = false;
    } }
    const service: RunnerService & {
        close(): Promise<void>;
    } = {
        async start(input) {
            if (closed)
                throw Error('runner_closed');
            if (!input || typeof input.userId !== 'string' || !input.userId || input.userId.length > 256 || typeof input.requestId !== 'string' || !input.requestId || input.requestId.length > 256 || !['typescript', 'javascript'].includes(input.program?.language) || typeof input.program.source !== 'string')
                throw Error('invalid_start');
            if(input.pageBackendOperation !== undefined && input.pageBackendOperation !== 'query' && input.pageBackendOperation !== 'mutation')throw Error('invalid_backend_operation');
            if(input.document && (typeof input.document.source !== 'string' || typeof input.document.editId !== 'string' || !input.artifactId || !input.artifactVersion))throw Error('invalid_document');
            if(!Object.hasOwn(input,'input'))throw Error('invalid_start');
            json(input, 512 * 1024);
            const request = JSON.parse(JSON.stringify(input)) as RunStart;
            const fingerprint = createHash('sha256').update(canonical(request)).digest('hex');
            const existing = (await db.query<RunRow>('SELECT * FROM runner_runs WHERE owner=$1 AND request_key=$2', [request.userId, request.requestId])).rows[0];
            if (existing) {
                if (existing.fingerprint !== fingerprint)
                    throw Error('start_conflict');
                return { runId: existing.id };
            }
            const limits = { ...ceilings };
            for (const k of Object.keys(ceilings) as Array<keyof RunnerLimits>) {
                const v = request.limits?.[k];
                if (v !== undefined) {
                    if (!Number.isSafeInteger(v) || v < 1)
                        throw Error('invalid_limits');
                    limits[k] = Math.min(v, ceilings[k]);
                }
            }
            limits.memoryMiB = Math.max(8, limits.memoryMiB);
            // Outside the admission lock: bundling is pure and cached, so concurrent admissions do not queue behind it.
            // It also precedes the queue_full check; sources are app-signed, pinned backends, so the extra builds are bounded.
            const bundle = await bundleSource(request.program.source);
            let release!: () => void;
            const prior = admission;
            admission = new Promise<void>(r => release = r);
            await prior;
            try {
                if (closed)
                    throw Error('runner_closed');
                // Concurrent retries may have passed the optimistic lookup together.
                const admitted = (await db.query<RunRow>('SELECT * FROM runner_runs WHERE owner=$1 AND request_key=$2', [request.userId, request.requestId])).rows[0];
                if (admitted) {
                    if (admitted.fingerprint !== fingerprint) throw Error('start_conflict');
                    return {runId: admitted.id};
                }
                if (active.size >= maxQueued)
                    throw Error('queue_full');
                const id = randomUUID(), admittedAt = new Date().toISOString();
                const inserted = await db.query('INSERT INTO runner_runs(id,owner,request_key,fingerprint,status,request,admitted_at) VALUES($1,$2,$3,$4,\'queued\',$5,$6) ON CONFLICT(owner,request_key) DO NOTHING RETURNING id', [id, request.userId, request.requestId, fingerprint, JSON.stringify(request), admittedAt]);
                if (!inserted.rows.length) {
                    const old = (await db.query<RunRow>('SELECT * FROM runner_runs WHERE owner=$1 AND request_key=$2', [request.userId, request.requestId])).rows[0]!;
                    if (old.fingerprint !== fingerprint)
                        throw Error('start_conflict');
                    return { runId: old.id };
                }
                let resolve!: () => void;
                const done = new Promise<void>(r => resolve = r);
                active.set(id, { request, bundle, limits, admittedAt, startedAt: null, controller: new AbortController(), resolve, done, sequence: 0, eventBytes: 0, rpcCount: 0, requestCount: 0, inflight: new Set(), tail: Promise.resolve(), requests: [], usage: [] });
                void pump();
                return { runId: id };
            }
            finally {
                release();
            }
        },
        async getRun({ userId, runId, waitMs }: RunWait): Promise<RunSnapshot> {
            if (waitMs !== undefined && (!Number.isSafeInteger(waitMs) || waitMs < 0))
                throw Error('invalid_wait');
            // Ownership first: a wait never reveals that someone else's run exists.
            let row = await ownedRun(db, userId, runId);
            if (waitMs && !terminal(row.status)) {
                const run = active.get(runId);
                if (run) {
                    let timer: ReturnType<typeof setTimeout> | undefined;
                    await Promise.race([run.done, new Promise<void>(resolve => { timer = setTimeout(resolve, Math.min(waitMs, RESOLVER_LIMITS.runWaitMs)); })]);
                    clearTimeout(timer);
                }
                // `done` resolves after the terminal receipt persists; a run that finished between the reads is terminal now.
                row = await ownedRun(db, userId, runId);
            }
            return { runId, status: row.status, output: row.output ?? null, receipt: row.receipt };
        },
        async events({ userId, runId, afterSequence, limit = 100 }) { await ownedRun(db, userId, runId); if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || !Number.isSafeInteger(limit) || limit < 1)
            throw Error('invalid_cursor'); const take = Math.min(limit, 100); const rows = (await db.query<RunEvent>('SELECT sequence,event FROM runner_events WHERE run_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3', [runId, afterSequence, take + 1])).rows; const events = rows.slice(0, take); return { events, nextSequence: events.at(-1)?.sequence ?? afterSequence, hasMore: rows.length > take }; },
        async cancel({ userId, runId }) { const row = await ownedRun(db, userId, runId); if (!terminal(row.status))
            await finish(runId, 'cancelled'); },
        async close() { closed = true; await admission; await Promise.all([pool?.close(), ...[...active.keys()].map(id => finish(id, 'interrupted', 'shutdown'))]); }
    };
    return service;
}
