/**
 * Live text pings (../live-pings): one follower per page per process, throttled leading and trailing to one tick per
 * interval, woken only by region updates, with one shared head read per tick. Driven with a fake clock and channel.
 */
import { describe, expect, it, vi } from 'vitest';
import { regionsChannel } from '@artifactbin/contracts';
import { LIVE_PING_MS, livePings, type LiveFollower } from '../live-pings';

function harness() {
  let now = 0;
  const timers: { at: number; work: () => void }[] = [];
  const clock = { now: () => now, setTimeout: (work: () => void, ms: number) => { const timer = { at: now + ms, work }; timers.push(timer); return timer; }, clearTimeout: (timer: unknown) => { const at = timers.indexOf(timer as never); if (at >= 0) timers.splice(at, 1); } };
  const advance = (ms: number) => { now += ms; for (const timer of timers.filter((candidate) => candidate.at <= now)) { timers.splice(timers.indexOf(timer), 1); timer.work(); } };
  const channels = new Map<string, { handler: (payload: string) => void; lost: () => void }>();
  const subscribe = vi.fn(async (channel: string, handler: (payload: string) => void, lost: () => void) => { channels.set(channel, { handler, lost }); return async () => { channels.delete(channel); }; });
  const load = vi.fn(async (id: string) => ({ id, read: load.mock.calls.length }));
  const pings = livePings({ subscribe, load, clock, intervalMs: LIVE_PING_MS });
  const notify = (id: string, payload: string) => channels.get(regionsChannel(id))?.handler(payload);
  const follower = () => {
    const heads: unknown[] = [];
    const lost = vi.fn();
    const self: LiveFollower<{ id: string; read: number }> & { heads: unknown[]; lost: typeof lost } = { heads, lost, tick: (head) => { heads.push(head()); } };
    return self;
  };
  return { advance, channels, subscribe, load, pings, notify, follower };
}

describe('live pings', () => {
  it('pings at once, then at most once per interval: a burst ends with one trailing ping', async () => {
    const { advance, notify, pings, follower } = harness();
    const reader = follower();
    await pings.follow('Page1', reader);
    notify('Page1', 'af-1:4');
    expect(reader.heads).toHaveLength(1);
    for (let seq = 5; seq < 12; seq++) { advance(30); notify('Page1', `af-1:${seq}`); }
    expect(reader.heads).toHaveLength(1);
    advance(LIVE_PING_MS);
    expect(reader.heads).toHaveLength(2);
    // Quiet: nothing pending, so the window closes with no further ping.
    advance(LIVE_PING_MS * 3);
    expect(reader.heads).toHaveLength(2);
    notify('Page1', 'af-1:12');
    expect(reader.heads).toHaveLength(3);
  });

  it('is woken by a region update only: a save or a close is a version, announced on the document channel', async () => {
    const { notify, pings, follower } = harness();
    const reader = follower();
    await pings.follow('Page1', reader);
    for (const payload of ['saved', 'saved:4:3', 'closed', '', 'cell:tasks:r_a:b:3']) notify('Page1', payload);
    expect(reader.heads).toHaveLength(0);
    notify('Page1', 'closed:7');
    expect(reader.heads).toHaveLength(1);
  });

  it('shares one subscription and one head read per tick among a page\'s readers, and lets go with the last', async () => {
    const { notify, pings, follower, subscribe, load, channels } = harness();
    const [a, b] = [follower(), follower()];
    const stopA = await pings.follow('Page1', a);
    const stopB = await pings.follow('Page1', b);
    expect(subscribe).toHaveBeenCalledOnce();
    notify('Page1', 'af-1:2');
    expect(await a.heads[0]).toBe(await b.heads[0]);
    expect(load).toHaveBeenCalledOnce();
    stopA();
    expect(channels.size).toBe(1);
    stopB();
    await Promise.resolve();
    expect(channels.size).toBe(0);
    expect(pings.followed()).toBe(0);
  });

  it('throttles each page on its own, and tells every reader when the subscription is lost', async () => {
    const { notify, pings, follower, channels } = harness();
    const [one, two] = [follower(), follower()];
    await pings.follow('Page1', one);
    await pings.follow('Page2', two);
    notify('Page1', 'af-1:2');
    notify('Page2', 'af-9:2');
    expect([one.heads.length, two.heads.length]).toEqual([1, 1]);
    channels.get(regionsChannel('Page1'))!.lost();
    expect(one.lost).toHaveBeenCalledOnce();
    expect(two.lost).not.toHaveBeenCalled();
    expect(pings.followed()).toBe(1);
  });
});
