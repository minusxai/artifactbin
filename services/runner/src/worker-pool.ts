import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { StringDecoder } from 'node:string_decoder';
import { RESOLVER_LIMITS } from '@artifactbin/contracts';

export interface WorkerMessage { type: string; [key: string]: unknown }
/** What the run that claimed a worker hears from it. `ready` is replayed if it came before the claim. */
interface WorkerHandlers {
    message(msg: WorkerMessage): void;
    /** The worker broke the line protocol or its output limits. */
    fault(reason: string): void;
    /** The process could not be started. */
    startFailed(): void;
    exit(): void;
}
export interface Worker {
    readonly child: ChildProcessWithoutNullStreams;
    readonly ready: boolean;
    readonly dead: boolean;
    /** Hands the worker to exactly one run. A worker is never claimed twice. */
    claim(handlers: WorkerHandlers): void;
}

/** Lifecycle observations for the pool, whoever has claimed the worker. */
interface WorkerHooks {
    /** Unclaimed and dead: killed for a protocol fault, or it exited. */
    idleDeath?(worker: Worker): void;
    /** The process reported `ready`. */
    ready?(worker: Worker): void;
    /** The process is gone (exit or start failure), claimed or not. */
    gone?(worker: Worker): void;
}
/**
 * One worker process and its line protocol. Before a claim the only acceptable message is `ready`;
 * anything else, or exit, kills it and reports `idleDeath` so the pool can replace it.
 */
export function startWorker(spawnChild: () => ChildProcessWithoutNullStreams, hooks: WorkerHooks = {}): Worker {
    const child = spawnChild();
    let handlers: WorkerHandlers | undefined, ready = false, dead = false, claimed = false;
    const idleFault = () => { if (!dead) { dead = true; child.kill('SIGKILL'); hooks.idleDeath?.(worker); } };
    const fault = (reason: string) => handlers ? handlers.fault(reason) : idleFault();
    child.stdin.on('error', () => { if (handlers) handlers.fault('worker_stdin_closed'); });
    const decoder = new StringDecoder('utf8');
    let buffered = '', stderrBytes = 0;
    child.stdout.on('data', (b: Buffer) => {
        buffered += decoder.write(b);
        if (Buffer.byteLength(buffered) > RESOLVER_LIMITS.messageBytes) { fault('ipc_limit'); return; }
        let end;
        while ((end = buffered.indexOf('\n')) >= 0) {
            const line = buffered.slice(0, end);
            buffered = buffered.slice(end + 1);
            let msg: WorkerMessage;
            try { msg = JSON.parse(line); }
            catch { fault('invalid_worker_message'); continue; }
            const first = msg?.type === 'ready' && !ready;
            if (first) { ready = true; hooks.ready?.(worker); }
            if (handlers) handlers.message(msg);
            else if (!first) idleFault();
        }
    });
    child.stderr.on('data', (b: Buffer) => { stderrBytes += b.length; if (stderrBytes > 65536) fault('stderr_limit'); });
    child.once('error', () => { hooks.gone?.(worker); if (handlers) handlers.startFailed(); else idleFault(); });
    child.once('exit', () => { hooks.gone?.(worker); if (handlers) handlers.exit(); else idleFault(); });
    const worker: Worker = {
        child,
        get ready() { return ready; },
        get dead() { return dead; },
        claim(next) {
            if (claimed) throw Error('worker_already_claimed');
            claimed = true;
            handlers = next;
            if (ready) next.message({ type: 'ready' });
        },
    };
    return worker;
}

export interface WorkerPool {
    /** A started-but-unused live worker (ready first, then starting), or a new one. Never one handed out before. */
    take(): Worker;
    readonly spares: readonly Worker[];
    close(): Promise<void>;
}
/** CPUs this process may use: the cgroup v2 quota (`docker --cpus`) when set, else the scheduler's. */
export function cpuBudget(read: (path: string) => string = path => readFileSync(path, 'utf8')): number {
    const cpus = availableParallelism();
    try {
        const [quota, period] = read('/sys/fs/cgroup/cpu.max').trim().split(/\s+/);
        if (quota !== 'max' && Number(quota) > 0 && Number(period) > 0)
            return Math.max(1, Math.min(cpus, Math.floor(Number(quota) / Number(period))));
    }
    catch { /* no cgroup v2 quota visible */ }
    return cpus;
}
/**
 * Whether the process may still serve a run, before its exit event says otherwise: not exited, not killed by us and
 * still present. A dead process that has not been reaped yet still passes `kill(pid, 0)`; the runner moves a run whose
 * worker is lost before it accepts the run (local.ts), so this check only spares that retry.
 */
function alive(child: ChildProcessWithoutNullStreams): boolean {
    if (child.exitCode !== null || child.signalCode !== null || child.killed || child.pid === undefined) return false;
    try { process.kill(child.pid, 0); return true; }
    catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}
/** Consecutive idle deaths before the pool stops pre-starting until the next take: a broken binary is not respawned forever. */
const MAX_IDLE_DEATHS = 3;
/** An idle spare must not keep the controller's event loop alive; a claimed one must, as any running worker does. */
function holdLoop(child: ChildProcessWithoutNullStreams, hold: boolean) {
    for (const handle of [child, child.stdin, child.stdout, child.stderr] as unknown as Array<{ ref?(): void; unref?(): void }>)
        hold ? handle.ref?.() : handle.unref?.();
}
/**
 * Keeps `size` worker processes started ahead of demand so a run does not wait for Node to boot.
 * Each process still serves exactly one run: `take` removes it from the pool for good.
 *
 * Refill starts a background boot only while fewer than `maxBooting` workers (default: the CPUs this
 * process may use) are booting. On one CPU a spare that boots beside a run's still-starting worker
 * halves that worker's speed, so the run would wait longer than with no pool at all. Runs never wait
 * for refill; with no spare, `take` spawns at once.
 */
export function createWorkerPool({ size, spawnChild, maxBooting = cpuBudget() }: { size: number; spawnChild: () => ChildProcessWithoutNullStreams; maxBooting?: number }): WorkerPool {
    if (!Number.isInteger(size) || size < 0) throw Error('invalid_pool_size');
    const spares: Worker[] = [], booting = new Set<Worker>();
    let closed = false, idleDeaths = 0;
    const hooks: WorkerHooks = {
        idleDeath: onIdleDeath,
        ready: worker => { booting.delete(worker); fill(); },
        gone: worker => { if (booting.delete(worker)) fill(); },
    };
    function onIdleDeath(worker: Worker) {
        const i = spares.indexOf(worker);
        if (i < 0) return;
        spares.splice(i, 1);
        idleDeaths++;
        fill();
    }
    function fill() {
        while (!closed && idleDeaths < MAX_IDLE_DEATHS && spares.length < size && booting.size < maxBooting) {
            let worker: Worker;
            try { worker = startWorker(spawnChild, hooks); }
            catch { idleDeaths++; continue; }
            holdLoop(worker.child, false);
            booting.add(worker);
            spares.push(worker);
        }
    }
    fill();
    return {
        get spares() { return spares; },
        take() {
            if (closed) throw Error('runner_closed');
            // A spare can die (OOM killer, crash) before its exit is heard; it is never handed out.
            for (const gone of spares.filter(w => !w.dead && !alive(w.child))) {
                spares.splice(spares.indexOf(gone), 1);
                booting.delete(gone);
            }
            let i = spares.findIndex(w => w.ready && !w.dead);
            if (i < 0) i = spares.findIndex(w => !w.dead);
            const worker = i >= 0 ? spares.splice(i, 1)[0]! : startWorker(spawnChild, hooks);
            if (!worker.ready) booting.add(worker);
            holdLoop(worker.child, true);
            idleDeaths = 0;
            fill();
            return worker;
        },
        async close() {
            closed = true;
            const all = spares.splice(0);
            await Promise.all(all.map(w => new Promise<void>(resolve => {
                if (w.child.exitCode !== null || w.child.signalCode !== null) return resolve();
                w.child.once('close', () => resolve());
                w.child.kill('SIGKILL');
            })));
        },
    };
}
