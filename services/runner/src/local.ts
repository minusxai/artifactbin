import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import type { RunStart, RunLookup, RunReceipt, RunnerJson, RunnerLimits, RunnerService, RunEvent, RunSnapshot } from '@artifactbin/contracts';
import { bundleSource } from './compiler';
import { initializeStore, ownedRun, type RunnerDatabase, type RunRow } from './store';
const worker = fileURLToPath(new URL('./runner-worker.mjs', import.meta.url));
const defaults: RunnerLimits = { timeoutMs: 30000, cpuMs: 200, memoryMiB: 64, maxRequests: 100, maxOutputBytes: 1024 * 1024 };
const terminal = (s: string) => !['queued', 'running'].includes(s);
export interface CapabilityContext {
    runId: string;
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
    ceilings?: Partial<RunnerLimits>;
}
interface Active {
    request: RunStart;
    bundle: string;
    admittedAt: string;
    startedAt: string | null;
    limits: RunnerLimits;
    controller: AbortController;
    child?: ChildProcessWithoutNullStreams;
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
}
function json(value: unknown, max: number): string { const s = JSON.stringify(value); if (s === undefined || Buffer.byteLength(s) > max)
    throw Error('size_limit'); return s; }
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
    async function message(id: string, msg: {
        type: string;
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
                if (msg.operation !== 'ai.next' && ++r.requestCount > r.limits.maxRequests)
                    throw Error('request_limit');
                value = await options.capabilities({ runId: id, request: r.request, signal: r.controller.signal, requests: r.requests, usage: r.usage }, msg.operation, msg.args ?? null);
            }
            if (!r.finishing)
                r.child!.stdin.write(json({ type: 'response', id: callId, value }, 2 * 1024 * 1024) + '\n');
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
        const child = options.dockerImage ? spawn('docker', ['run', '--rm', '--name', `afbin-run-${id}`, '--label', 'artifactbin.runner=true', '-i', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '1000:1000', '--memory', `${r.limits.memoryMiB + 128}m`, '--cpus', '1', '--pids-limit', '32', options.dockerImage], { stdio: ['pipe', 'pipe', 'pipe'] }) : spawn(process.execPath, ['--no-node-snapshot', worker], { stdio: ['pipe', 'pipe', 'pipe'], env: {} });
        r.child = child;
        r.timer = setTimeout(() => { void finish(id, 'failed', 'timeout'); }, r.limits.timeoutMs);
        child.stdin.on('error', () => { if (!r.finishing)
            fail(id, Error('worker_stdin_closed')); });
        const decoder = new StringDecoder('utf8');
        let buffered = '';
        let stderrBytes = 0;
        child.stdout.on('data', (b: Buffer) => { buffered += decoder.write(b); if (Buffer.byteLength(buffered) > 2 * 1024 * 1024) {
            fail(id, Error('ipc_limit'));
            return;
        } let end; while ((end = buffered.indexOf('\n')) >= 0) {
            const line = buffered.slice(0, end);
            buffered = buffered.slice(end + 1);
            try {
                void message(id, JSON.parse(line)).catch(e => fail(id, e));
            }
            catch {
                fail(id, Error('invalid_worker_message'));
            }
        } });
        child.stderr.on('data', (b: Buffer) => { stderrBytes += b.length; if (stderrBytes > 65536)
            fail(id, Error('stderr_limit')); });
        child.once('error', () => { void finish(id, 'interrupted', 'worker_start_failed'); });
        child.once('exit', () => { if (!r.finishing)
            void finish(id, 'interrupted', 'worker_exit'); });
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
                const bundle = await bundleSource(request.program.source);
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
        async getRun({ userId, runId }: RunLookup): Promise<RunSnapshot> { const row = await ownedRun(db, userId, runId); return { runId, status: row.status, output: row.output ?? null, receipt: row.receipt }; },
        async events({ userId, runId, afterSequence, limit = 100 }) { await ownedRun(db, userId, runId); if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || !Number.isSafeInteger(limit) || limit < 1)
            throw Error('invalid_cursor'); const take = Math.min(limit, 100); const rows = (await db.query<RunEvent>('SELECT sequence,event FROM runner_events WHERE run_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3', [runId, afterSequence, take + 1])).rows; const events = rows.slice(0, take); return { events, nextSequence: events.at(-1)?.sequence ?? afterSequence, hasMore: rows.length > take }; },
        async cancel({ userId, runId }) { const row = await ownedRun(db, userId, runId); if (!terminal(row.status))
            await finish(runId, 'cancelled'); },
        async close() { closed = true; await admission; await Promise.all([...active.keys()].map(id => finish(id, 'interrupted', 'shutdown'))); }
    };
    return service;
}
