/**
 * A CONNECTION'S SESSIONS: at most CONNECTOR_LIMITS.poolSize database sessions in all, each opened on one database
 * (the key: what followed `default:`) and shared by every viewer (each query names its own viewer inside its own
 * transaction), used by one query at a time and closed after `idleMs` unused. A full pool closes the least recently
 * used idle session to make room; when all are busy a query waits up to `connectTimeoutMs`. A session a query left in an unknown state (a
 * timeout, an abort, a lost socket, a stopped read, a failed statement) is closed, never reused.
 */
import { CONNECTOR_LIMITS } from '@artifactbin/contracts';
import { ConnectorFailure } from './errors';

export interface SessionDriver<S> {
  open(key: string): Promise<S>;
  close(session: S): Promise<void>;
}
interface Entry<S> { key: string; session: Promise<S>; busy: boolean; used: number; timer?: ReturnType<typeof setTimeout> }

export class SessionPool<S> {
  private readonly entries = new Set<Entry<S>>();
  private readonly waiting: (() => void)[] = [];
  private closed = false;
  constructor(private readonly driver: SessionDriver<S>, private readonly bounds = { size: CONNECTOR_LIMITS.poolSize, idleMs: CONNECTOR_LIMITS.idleMs, waitMs: CONNECTOR_LIMITS.connectTimeoutMs }) {}

  /** Sessions open now. */
  count(): number { return this.entries.size; }

  /** Runs `work` on a session of `key`'s; `work` calls `discard()` when the session must not be reused. */
  async use<T>(key: string, work: (session: S, discard: () => void) => Promise<T>): Promise<T> {
    const entry = await this.acquire(key);
    let keep = true;
    try {
      return await work(await entry.session, () => { keep = false; });
    } finally {
      if (keep && !this.closed) this.release(entry);
      else void this.drop(entry);
    }
  }

  private async acquire(key: string): Promise<Entry<S>> {
    const deadline = Date.now() + this.bounds.waitMs;
    for (;;) {
      if (this.closed) throw new ConnectorFailure('unavailable', 'the connection is closed');
      const idle = [...this.entries].find((e) => e.key === key && !e.busy);
      if (idle) { clearTimeout(idle.timer); idle.busy = true; return idle; }
      if (this.entries.size >= this.bounds.size) {
        const evict = [...this.entries].filter((e) => !e.busy).sort((a, b) => a.used - b.used)[0];
        if (evict) await this.drop(evict);
      }
      if (this.entries.size < this.bounds.size) {
        const entry: Entry<S> = { key, busy: true, used: Date.now(), session: this.driver.open(key) };
        this.entries.add(entry);
        entry.session.catch(() => { this.entries.delete(entry); this.wake(); });
        return entry;
      }
      const left = deadline - Date.now();
      if (left <= 0) throw new ConnectorFailure('unavailable', 'every session of this connection is busy; try again');
      await new Promise<void>((resolve) => { const t = setTimeout(resolve, left); this.waiting.push(() => { clearTimeout(t); resolve(); }); });
    }
  }
  private release(entry: Entry<S>) {
    entry.busy = false; entry.used = Date.now();
    entry.timer = setTimeout(() => void this.drop(entry), this.bounds.idleMs);
    entry.timer.unref?.();
    this.wake();
  }
  private async drop(entry: Entry<S>) {
    if (!this.entries.delete(entry)) return;
    clearTimeout(entry.timer);
    this.wake();
    await entry.session.then((s) => this.driver.close(s), () => undefined).catch(() => undefined);
  }
  private wake() { this.waiting.splice(0).forEach((w) => w()); }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.entries].map((e) => this.drop(e)));
    this.wake();
  }
}
