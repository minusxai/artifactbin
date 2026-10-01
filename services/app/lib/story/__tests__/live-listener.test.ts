/**
 * A LOST POSTGRES LISTENER (lib/db PostgresDb → lib/story/realtime/wakeup → lib/story/realtime/live): when the one
 * connection holding every LISTEN ends or errors, every subscription on it is told, the per-channel
 * registry is emptied, and the next subscriber LISTENs afresh on a new connection. Before, the stale
 * entry stayed: open streams kept their keepalives with no wakeup able to arrive, and a reload while
 * another tab held the document joined the dead entry.
 */
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostgresDb } from '@/lib/platform';
import { liveChannelCount, resetLiveSubscriptions, subscribeChannel } from '../realtime/live';

class FakeClient extends EventEmitter {
  queries: string[] = [];
  released: unknown[] = [];
  async query(sql: string) { this.queries.push(sql); return { rows: [], rowCount: 0 }; }
  release(destroy?: unknown) { this.released.push(destroy); }
  notify(channel: string, payload = '') { this.emit('notification', { channel, payload }); }
}

function fakePool() {
  const clients: FakeClient[] = [];
  let refuse = false;
  const pool = {
    connect: vi.fn(async () => {
      if (refuse) throw new Error('connection refused');
      const client = new FakeClient();
      clients.push(client);
      return client;
    }),
    query: vi.fn(),
    end: vi.fn(),
  };
  return { pool, clients, refuseConnections: (on: boolean) => { refuse = on; } };
}

const pg = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/platform/db', async (original) => ({ ...(await original<typeof import('@/lib/platform/db')>()), getDb: async () => pg.db }));

afterEach(async () => { await resetLiveSubscriptions(); });

describe('PostgresDb listener loss', () => {
  it.each(['end', 'error'] as const)('on %s tells every subscriber, destroys the client and LISTENs afresh next time', async (event) => {
    const { pool, clients } = fakePool();
    const db = new PostgresDb(pool as never);
    const lostA = vi.fn(), lostB = vi.fn(), heard = vi.fn();
    await db.listen('artifact_a', heard, lostA);
    await db.listen('artifact_b', () => {}, lostB);
    clients[0]!.notify('artifact_a', 'x');
    expect(heard).toHaveBeenCalledWith('x');

    clients[0]!.emit(event, new Error('terminating connection due to administrator command'));
    expect(lostA).toHaveBeenCalledTimes(1);
    expect(lostB).toHaveBeenCalledTimes(1);
    expect(clients[0]!.released, 'a broken client is destroyed, never returned to the pool').toEqual([true]);
    clients[0]!.emit('end'); // 'error' then 'end' is one loss
    expect(lostA).toHaveBeenCalledTimes(1);

    const again = vi.fn();
    await db.listen('artifact_a', again);
    expect(clients).toHaveLength(2);
    expect(clients[1]!.queries).toEqual(['LISTEN "artifact_a"']);
    clients[1]!.notify('artifact_a', 'y');
    expect(again).toHaveBeenCalledWith('y');
    expect(heard, 'the dead subscription hears nothing more').toHaveBeenCalledTimes(1);
  });

  it('a failed reconnect is not cached: the next listen tries again', async () => {
    const { pool, clients, refuseConnections } = fakePool();
    const db = new PostgresDb(pool as never);
    refuseConnections(true);
    await expect(db.listen('artifact_a', () => {})).rejects.toThrow('connection refused');
    refuseConnections(false);
    await db.listen('artifact_a', () => {});
    expect(clients).toHaveLength(1);
  });
});

describe('live subscriptions over a lost listener', () => {
  it('ends every stream on the channel, clears the stale entry, and a new subscriber (a reload) gets a live one', async () => {
    const { pool, clients } = fakePool();
    pg.db = new PostgresDb(pool as never);
    const tabA = vi.fn(), tabB = vi.fn(), lostA = vi.fn(), lostB = vi.fn();
    await subscribeChannel('artifact_doc', tabA, lostA);
    const unsubB = await subscribeChannel('artifact_doc', tabB, lostB);
    expect(liveChannelCount()).toBe(1);
    expect(clients[0]!.queries).toEqual(['LISTEN "artifact_doc"']);

    clients[0]!.emit('error', new Error('connection lost'));
    expect(lostA, 'each open stream is ended so its client reconnects and catches up').toHaveBeenCalledTimes(1);
    expect(lostB).toHaveBeenCalledTimes(1);
    expect(liveChannelCount(), 'no stale entry for a reload to join').toBe(0);
    await unsubB(); // the ended stream's teardown is harmless

    const reload = vi.fn();
    await subscribeChannel('artifact_doc', reload);
    expect(clients).toHaveLength(2);
    expect(clients[1]!.queries, 'the reload LISTENs on the fresh connection').toEqual(['LISTEN "artifact_doc"']);
    clients[1]!.notify('artifact_doc', 'e9');
    expect(reload).toHaveBeenCalledWith('e9');
    expect(tabA).not.toHaveBeenCalled();
  });
});
