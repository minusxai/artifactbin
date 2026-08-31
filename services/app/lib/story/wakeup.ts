/**
 * THE WAKEUP TRANSPORT — how "something changed" reaches whoever holds a
 * live stream. An interface with one implementation today (Postgres
 * LISTEN/NOTIFY through the app's own db handle — in-process, which is what a
 * co-hosted proxy+app uses, and the only thing PGLite can do) and room for a
 * second (a proxy holding its own LISTEN connection, M4). Every subscriber
 * gets a blind wakeup: the channel and whatever tiny payload the writer put
 * in the NOTIFY — never content. What to do about it is a catch-up read.
 */
import { getDb } from '@/lib/db';

export type WakeupHandler = (payload: string) => void;

export interface WakeupTransport {
  /** Subscribe to one channel; resolves to the teardown. */
  subscribe(channel: string, handler: WakeupHandler): Promise<() => Promise<void>>;
}

/** The in-process transport: LISTEN on the app's database connection. */
function dbWakeups(): WakeupTransport {
  return {
    async subscribe(channel, handler) {
      const db = await getDb();
      return db.listen(channel, (payload) => handler(payload ?? ''));
    },
  };
}

let current: WakeupTransport | null = null;
/** The transport in use (in-process unless something installs another). */
export function wakeups(): WakeupTransport {
  return current ?? (current = dbWakeups());
}
/** Install another transport (a proxy-held LISTEN, a test double). */
function setWakeupTransport(next: WakeupTransport | null): void {
  current = next;
}
