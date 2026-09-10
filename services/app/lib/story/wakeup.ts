/** App-owned LISTEN/NOTIFY subscriptions. A notification carries a channel and
 * a small payload; subscribers fetch current state rather than treating it as content.
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
/** The shared transport over the app database. */
export function wakeups(): WakeupTransport {
  return current ?? (current = dbWakeups());
}
