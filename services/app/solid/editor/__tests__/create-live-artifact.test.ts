import { createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
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
  return { backend, unsubscribe, ping: (p: { version: number; editId: string; by?: string | null }) => handlers!.onPing({ by: null, ...p }) };
}

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
