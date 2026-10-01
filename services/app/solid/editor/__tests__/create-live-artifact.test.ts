import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { fakeBackend } from '@/test/helpers/artifact-backend';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { createLiveArtifact } from '../create-live-artifact';
import { renderHook } from '@/solid/__tests__/helpers';

type Handlers = Parameters<ArtifactBackend['live']>[0];

const frame = (version: number, editId = 'e-remote') => ({ version, edit_id: editId, nodes: [], by: null }) as never;

function liveBackend(liveFrame: ArtifactBackend['liveFrame']) {
  let handlers: Handlers | undefined;
  const unsubscribe = vi.fn();
  const live = vi.fn((h: Handlers) => { handlers = h; return unsubscribe; }) as unknown as ArtifactBackend['live'];
  const backend = fakeBackend({}, { live, liveFrame });
  return {
    backend, unsubscribe,
    ping: (p: { version: number; editId: string; by?: string | null }) => handlers!.onPing({ by: null, ...p }),
    wake: () => handlers!.onWake?.(),
  };
}

afterEach(() => { vi.useRealTimers(); });

it('fetches and surfaces a genuinely newer frame', async () => {
  const { backend, ping } = liveBackend(vi.fn(async () => frame(3)));
  const { result: live } = renderHook(() => createLiveArtifact({ backend, id: 'a1', initialEditId: 'e0', initialVersion: 1 }));
  expect(live()).toBeNull();
  ping({ version: 3, editId: 'e-remote' });
  await vi.waitFor(() => expect(live()?.version).toBe(3));
});

it('drops a ping that echoes the version this page was served with', async () => {
  const liveFrame = vi.fn(async () => frame(1));
  const { backend, ping } = liveBackend(liveFrame);
  const { result: live } = renderHook(() => createLiveArtifact({ backend, id: 'a1', initialEditId: 'e0', initialVersion: 1 }));
  ping({ version: 1, editId: 'e0' });
  await Promise.resolve();
  expect(liveFrame).not.toHaveBeenCalled();
  expect(live()).toBeNull();
});

it('drops a ping the caller identifies as its own accepted write', async () => {
  const liveFrame = vi.fn(async () => frame(4));
  const { backend, ping } = liveBackend(liveFrame);
  const { result: live } = renderHook(() => createLiveArtifact({
    backend, id: 'a1', initialEditId: 'e0', initialVersion: 1, isOwnFrame: (editId) => editId === 'mine',
  }));
  ping({ version: 4, editId: 'mine' });
  await Promise.resolve();
  expect(liveFrame).not.toHaveBeenCalled();
  expect(live()).toBeNull();
});

it('never rewinds the seen-version floor, even for a frame it declined to fetch', async () => {
  const liveFrame = vi.fn(async () => frame(5));
  const { backend, ping } = liveBackend(liveFrame);
  const { result: live } = renderHook(() => createLiveArtifact({
    backend, id: 'a1', initialEditId: 'e0', initialVersion: 1, isOwnFrame: (editId) => editId === 'mine',
  }));
  ping({ version: 5, editId: 'mine' }); // seen advances to 5, but is own-frame: not fetched
  await Promise.resolve();
  ping({ version: 3, editId: 'other' }); // older than the floor: dropped outright
  await Promise.resolve();
  expect(liveFrame).not.toHaveBeenCalled();
  expect(live()).toBeNull();
});

it('never subscribes when disabled', () => {
  const live = vi.fn();
  const backend = fakeBackend({}, { live: live as never });
  renderHook(() => createLiveArtifact({ backend, id: 'a1', initialEditId: 'e0', initialVersion: 1, enabled: false }));
  expect(live).not.toHaveBeenCalled();
});

it('unsubscribes when the connection identity changes', async () => {
  const { backend, unsubscribe } = liveBackend(vi.fn(async () => frame(2)));
  const [id, setId] = createSignal('a1');
  renderHook(() => createLiveArtifact({ backend, get id() { return id(); }, initialEditId: 'e0', initialVersion: 1 }));
  expect(unsubscribe).not.toHaveBeenCalled();
  setId('a2');
  await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalled());
});

it('retries a failed frame fetch with backoff and marks the version seen only once it lands', async () => {
  vi.useFakeTimers();
  let calls = 0;
  const liveFrame = vi.fn(async () => {
    calls++;
    if (calls === 1) throw new TypeError('Failed to fetch'); // offline
    if (calls === 2) return null; // a 502 from the proxy: refused, not a frame
    return frame(3);
  });
  const { backend, ping } = liveBackend(liveFrame);
  const { result: live } = renderHook(() => createLiveArtifact({ backend, id: 'a1', initialEditId: 'e0', initialVersion: 1 }));
  ping({ version: 3, editId: 'e-remote' });
  await vi.advanceTimersByTimeAsync(0);
  expect(liveFrame).toHaveBeenCalledTimes(1);
  expect(live()).toBeNull();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(liveFrame, 'retried after the first backoff step').toHaveBeenCalledTimes(2);
  expect(live()).toBeNull();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(liveFrame).toHaveBeenCalledTimes(3);
  expect(live()?.version).toBe(3);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(liveFrame, 'nothing more once it landed').toHaveBeenCalledTimes(3);
});

it('a reconnect\'s catch-up ping for a version whose fetch failed fetches it again at once', async () => {
  vi.useFakeTimers();
  let fail = true;
  const liveFrame = vi.fn(async () => { if (fail) throw new TypeError('Failed to fetch'); return frame(4); });
  const { backend, ping } = liveBackend(liveFrame);
  const { result: live } = renderHook(() => createLiveArtifact({ backend, id: 'a1', initialEditId: 'e0', initialVersion: 1 }));
  ping({ version: 4, editId: 'e4' });
  await vi.advanceTimersByTimeAsync(0);
  expect(liveFrame).toHaveBeenCalledTimes(1);
  fail = false;
  ping({ version: 4, editId: 'e4' }); // the stream reopened: its first frame is the head
  await vi.advanceTimersByTimeAsync(0);
  expect(liveFrame).toHaveBeenCalledTimes(2);
  expect(live()?.version).toBe(4);
});

it('a head older than the one announced (a lagging read) is retried, not taken as the news', async () => {
  vi.useFakeTimers();
  const liveFrame = vi.fn().mockResolvedValueOnce(frame(2)).mockResolvedValue(frame(3));
  const { backend, ping } = liveBackend(liveFrame);
  const { result: live } = renderHook(() => createLiveArtifact({ backend, id: 'a1', initialEditId: 'e0', initialVersion: 1 }));
  ping({ version: 3, editId: 'e3' });
  await vi.advanceTimersByTimeAsync(0);
  expect(live()).toBeNull();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(live()?.version).toBe(3);
});

it('on wake (visible, online) reads the head once and surfaces only a strictly newer version', async () => {
  const liveFrame = vi.fn(async () => frame(1, 'e0'));
  const { backend, wake } = liveBackend(liveFrame);
  const { result: live } = renderHook(() => createLiveArtifact({ backend, id: 'a1', initialEditId: 'e0', initialVersion: 1 }));
  wake();
  await vi.waitFor(() => expect(liveFrame).toHaveBeenCalledTimes(1));
  expect(live(), 'nothing new: nothing changes').toBeNull();
  liveFrame.mockResolvedValue(frame(6));
  wake();
  await vi.waitFor(() => expect(live()?.version).toBe(6));
});

it('a page coming back online retries a frame fetch that failed while offline at once, not after its backoff', async () => {
  vi.useFakeTimers();
  let offline = true;
  const liveFrame = vi.fn(async () => { if (offline) throw new TypeError('Failed to fetch'); return frame(5); });
  const { backend, ping, wake } = liveBackend(liveFrame);
  const { result: live } = renderHook(() => createLiveArtifact({ backend, id: 'a1', initialEditId: 'e0', initialVersion: 1 }));
  ping({ version: 5, editId: 'e5' }); // the ping got through; the fetch did not
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(30_000); // offline for a while: backoff grows
  const calls = liveFrame.mock.calls.length;
  offline = false;
  wake();
  await vi.advanceTimersByTimeAsync(0);
  expect(liveFrame).toHaveBeenCalledTimes(calls + 1);
  expect(live()?.version).toBe(5);
});
