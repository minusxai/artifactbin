import { createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { fakeBackend } from '@/test/helpers/artifact-backend';
import { createArtifactVersions } from '../create-versions';
import { renderHook } from '@/solid/__tests__/helpers';

const SUMMARY = { version: 2, title: 'Earlier', description: null, format: 'markup' as const, created_at: new Date().toISOString(), by: 'ana' };

it('lists on setup and refreshes when the live version moves', async () => {
  const versions = vi.fn(async () => [SUMMARY]);
  const backend = fakeBackend({}, { versions });
  const [currentVersion, setCurrentVersion] = createSignal(3);
  const { result: api } = renderHook(() => createArtifactVersions({
    backend, get currentVersion() { return currentVersion(); },
  }));
  await vi.waitFor(() => expect(api.versions()).toEqual([SUMMARY]));
  expect(versions).toHaveBeenCalledTimes(1);

  setCurrentVersion(4);
  await vi.waitFor(() => expect(versions).toHaveBeenCalledTimes(2));
});

it('has nothing to list on a backend without history', async () => {
  const versions = vi.fn(async () => []);
  const backend = fakeBackend({ versions: 'offline' }, { versions });
  const { result: api } = renderHook(() => createArtifactVersions({ backend, currentVersion: 1 }));
  await Promise.resolve();
  expect(versions).not.toHaveBeenCalled();
  expect(api.versions()).toEqual([]);
});

it('tracks busy only while a restore is in flight', async () => {
  let resolveRevert!: (v: { ok: true; body: { version: number } }) => void;
  const revert = vi.fn(() => new Promise((resolve) => { resolveRevert = resolve as never; })) as never;
  const backend = fakeBackend({}, {
    load: vi.fn(async () => ({ version: 1, state: 's', edit_id: 'e1' }) as never),
    version: vi.fn(async () => ({ version: 2, format: 'json' as const }) as never),
    revert,
  });
  const { result: api } = renderHook(() => createArtifactVersions({ backend, currentVersion: 3 }));
  expect(api.busy()).toBe(false);
  const restoring = api.restore(2);
  expect(api.busy()).toBe(true); // set synchronously, before restoreBrowserArtifact's first await
  await vi.waitFor(() => expect(revert).toHaveBeenCalled());
  resolveRevert({ ok: true, body: { version: 5 } });
  expect(await restoring).toBe(5);
  expect(api.busy()).toBe(false);
});
