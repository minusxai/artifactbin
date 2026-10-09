/**
 * ADMISSION FOR EDITOR DRAFT COMPILES. A draft compile is whole-document, CPU-bound work, and an
 * editor can ask for one per keystroke; queued without bound, one person typing in a heavy document
 * starves every other request this process answers. The gate keeps that work bounded:
 *
 *   per session  at most ONE compile runs and ONE waits. A newer draft answers the waiting one, and
 *                the running one, `superseded` at once: the running compile finishes (its slot stays
 *                held) and its result is dropped. A draft is placed in its session when its request
 *                ARRIVES (`arrive`, before the route awaits anything): while a compile holds the
 *                thread, requests pile up unread, and when it ends only the newest of them compiles.
 *   globally     at most `concurrency` compiles run at once across sessions. A draft that cannot start
 *                within `waitMs` of becoming eligible is answered `busy`, never queued further.
 *
 * Nothing here knows HTTP; the route maps `superseded` and `busy` to responses.
 */

type GateResult<T> = { ok: true; value: T } | { ok: false; reason: 'superseded' | 'busy' };

/** One draft's place in its session's order of arrival. */
interface DraftTicket { readonly session: string; readonly seq: number; readonly waitMs?: number }

export interface DraftCompileGate {
  /**
   * Place a draft in its session as its request arrives. `seq` is the sender's own order of its drafts;
   * without it, arrival order stands in. A draft with a higher place supersedes the lower ones.
   * `waitMs` overrides the gate's wait for this draft.
   */
  arrive(session: string, seq?: number, waitMs?: number): DraftTicket;
  /** Whether a newer draft of the ticket's session has arrived since: the caller can stop preparing it. */
  superseded(ticket: DraftTicket): boolean;
  /** Run `work` for an arrived draft under the gate; the promise settles as soon as its answer is known. */
  run<T>(ticket: DraftTicket, work: () => Promise<T>): Promise<GateResult<T>>;
}

interface Waiter {
  session: string;
  waitMs: number;
  work: () => Promise<unknown>;
  settle: (result: GateResult<unknown>) => void;
  fail: (error: unknown) => void;
  settled: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

interface Session { running: Waiter | null; pending: Waiter | null; latest: number; touched: number }

/** Sessions idle this long with nothing running or waiting are forgotten. */
const IDLE_MS = 60_000;

interface DraftCompileGateOptions {
  concurrency: number;
  waitMs: number;
  /**
   * How long the thread is left to other requests after a compile that took `ms`, before the next starts.
   * Compiles on the request thread need it (a stream of them would otherwise hold it for good); compiles
   * on worker threads do not.
   */
  restMs?: (ms: number) => number;
}

export function createDraftCompileGate(options: DraftCompileGateOptions): DraftCompileGate {
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const sessions = new Map<string, Session>();
  const queue: Waiter[] = [];
  let active = 0;

  const answer = (waiter: Waiter, result: GateResult<unknown>) => {
    if (waiter.settled) return;
    waiter.settled = true;
    if (waiter.timer) clearTimeout(waiter.timer);
    waiter.timer = null;
    waiter.settle(result);
  };
  const dequeue = (waiter: Waiter) => {
    const i = queue.indexOf(waiter);
    if (i >= 0) queue.splice(i, 1);
  };
  // A session outlives its compiles (its arrival order must survive the gap between them); idle ones are pruned.
  const prune = (now: number) => {
    for (const [key, session] of sessions) if (!session.running && !session.pending && now - session.touched > IDLE_MS) sessions.delete(key);
  };
  // The wait clock runs only while the draft is eligible (its session has nothing running): a draft
  // waiting on its own session's compile is bounded by that compile, and there is only ever one.
  const arm = (waiter: Waiter) => {
    if (waiter.timer || waiter.settled) return;
    waiter.timer = setTimeout(() => {
      dequeue(waiter);
      const session = sessions.get(waiter.session);
      if (session?.pending === waiter) session.pending = null;
      answer(waiter, { ok: false, reason: 'busy' });
    }, waiter.waitMs);
  };

  // Starts are decided one macrotask later: drafts that arrived while a compile held the thread reach the
  // gate in the meantime, so only the newest of them starts (a compile can finish without ever yielding).
  let scheduled = false;
  let restUntil = 0;
  const pump = () => {
    if (scheduled) return;
    scheduled = true;
    const wait = restUntil - Date.now();
    const go = () => { scheduled = false; start(); };
    if (wait > 0) setTimeout(go, wait); else setImmediate(go);
  };
  const start = () => {
    for (const waiter of queue) if (!sessions.get(waiter.session)?.running) arm(waiter);
    while (active < concurrency) {
      const next = queue.find((w) => !sessions.get(w.session)?.running);
      if (!next) return;
      dequeue(next);
      if (next.timer) clearTimeout(next.timer);
      next.timer = null;
      const session = sessions.get(next.session)!;
      session.pending = null;
      session.running = next;
      active++;
      const began = performance.now();
      void next.work().then(
        (value) => answer(next, { ok: true, value }),
        // A failed compile fails its own caller, unless a newer draft already answered it.
        (error: unknown) => { if (!next.settled) { next.settled = true; next.fail(error); } },
      ).finally(() => {
        active--;
        if (options.restMs) restUntil = Math.max(restUntil, Date.now() + options.restMs(performance.now() - began));
        session.running = null;
        session.touched = Date.now();
        pump();
      });
    }
  };

  return {
    arrive(key: string, seq?: number, waitMs?: number): DraftTicket {
      const now = Date.now();
      if (sessions.size > 256) prune(now);
      let session = sessions.get(key);
      if (!session) { session = { running: null, pending: null, latest: 0, touched: now }; sessions.set(key, session); }
      session.touched = now;
      const place = seq ?? session.latest + 1;
      session.latest = Math.max(session.latest, place);
      return { session: key, seq: place, ...(waitMs !== undefined ? { waitMs } : {}) };
    },
    superseded: (ticket) => ticket.seq < (sessions.get(ticket.session)?.latest ?? ticket.seq),
    run<T>(ticket: DraftTicket, work: () => Promise<T>): Promise<GateResult<T>> {
      const key = ticket.session;
      const known = sessions.get(key);
      const session: Session = known ?? { running: null, pending: null, latest: ticket.seq, touched: Date.now() };
      if (!known) sessions.set(key, session);
      // A newer draft of this session has already arrived: this one is never compiled.
      if (ticket.seq < session.latest) return Promise.resolve({ ok: false, reason: 'superseded' });
      return new Promise<GateResult<T>>((resolve, reject) => {
        const waiter: Waiter = {
          session: key, waitMs: ticket.waitMs ?? options.waitMs, work, settled: false, timer: null,
          settle: (result) => resolve(result as GateResult<T>), fail: reject,
        };
        if (session.pending) {
          dequeue(session.pending);
          answer(session.pending, { ok: false, reason: 'superseded' });
        }
        if (session.running) answer(session.running, { ok: false, reason: 'superseded' });
        session.pending = waiter;
        session.touched = Date.now();
        queue.push(waiter);
        pump();
      });
    },
  };
}
