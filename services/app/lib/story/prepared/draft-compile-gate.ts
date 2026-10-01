/**
 * ADMISSION FOR EDITOR DRAFT COMPILES. A draft compile is whole-document, CPU-bound work, and an
 * editor can ask for one per keystroke; queued without bound, one person typing in a heavy document
 * starves every other request this process answers. The gate keeps that work bounded:
 *
 *   per session  at most ONE compile runs and ONE waits. A newer draft answers the waiting one, and
 *                the running one, `superseded` at once: the running compile finishes (its slot stays
 *                held) and its result is dropped.
 *   globally     at most `concurrency` compiles run at once across sessions. A draft that cannot start
 *                within `waitMs` of becoming eligible is answered `busy`, never queued further.
 *
 * Nothing here knows HTTP; the route maps `superseded` and `busy` to responses.
 */

export type GateResult<T> = { ok: true; value: T } | { ok: false; reason: 'superseded' | 'busy' };

export interface DraftCompileGate {
  /** Run `work` for `session` under the gate; the promise settles as soon as its answer is known. */
  run<T>(session: string, work: () => Promise<T>): Promise<GateResult<T>>;
}

interface Waiter {
  session: string;
  work: () => Promise<unknown>;
  settle: (result: GateResult<unknown>) => void;
  fail: (error: unknown) => void;
  settled: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

interface Session { running: Waiter | null; pending: Waiter | null }

export function createDraftCompileGate(options: { concurrency: number; waitMs: number }): DraftCompileGate {
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
  const forget = (key: string) => {
    const session = sessions.get(key);
    if (session && !session.running && !session.pending) sessions.delete(key);
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
      forget(waiter.session);
    }, options.waitMs);
  };

  const pump = () => {
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
      void next.work().then(
        (value) => answer(next, { ok: true, value }),
        // A failed compile fails its own caller, unless a newer draft already answered it.
        (error: unknown) => { if (!next.settled) { next.settled = true; next.fail(error); } },
      ).finally(() => {
        active--;
        session.running = null;
        forget(next.session);
        pump();
      });
    }
  };

  return {
    run<T>(key: string, work: () => Promise<T>): Promise<GateResult<T>> {
      return new Promise<GateResult<T>>((resolve, reject) => {
        const waiter: Waiter = {
          session: key, work, settled: false, timer: null,
          settle: (result) => resolve(result as GateResult<T>), fail: reject,
        };
        let session = sessions.get(key);
        if (!session) { session = { running: null, pending: null }; sessions.set(key, session); }
        if (session.pending) {
          dequeue(session.pending);
          answer(session.pending, { ok: false, reason: 'superseded' });
        }
        if (session.running) answer(session.running, { ok: false, reason: 'superseded' });
        session.pending = waiter;
        queue.push(waiter);
        pump();
      });
    },
  };
}
