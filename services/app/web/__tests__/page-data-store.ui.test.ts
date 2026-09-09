import { expect, it } from 'vitest';
import { createPageDataStore } from '../page-data-store';

it('retains independent route data and clears existing resource references on account changes', async () => {
  const store = createPageDataStore(); store.setScope('account:A');
  const home = store.resource<string>('/home'); const profile = store.resource<string>('/profile/alice');
  await home.load(async () => 'private home'); await profile.load(async () => 'profile');
  expect(store.resource('/home').snapshot().data).toBe('private home');
  expect(profile.snapshot().data).toBe('profile');
  store.setScope('account:B');
  expect(home.snapshot().data).toBeNull(); expect(profile.snapshot().data).toBeNull();
});

it('does not adopt an old account response after scope changes', async () => {
  const store = createPageDataStore(); store.setScope('account:A');
  const resource = store.resource<string>('artifact:one');
  let resolve!: (value: string) => void;
  const pending = resource.load(() => new Promise<string>(done => { resolve = done; }));
  store.setScope('account:B'); resolve('old secret'); await pending;
  expect(resource.snapshot().data).toBeNull();
});

it('retains data during revalidation and coalesces concurrent loads', async () => {
  const store = createPageDataStore(); store.setScope('account:A');
  const resource = store.resource<string>('folder:one'); resource.seed('cached');
  let resolve!: (value: string) => void; let calls = 0;
  const loader = () => { calls++; return new Promise<string>(done => { resolve = done; }); };
  const a = resource.load(loader); const b = resource.load(loader);
  expect(resource.snapshot().data).toBe('cached'); expect(calls).toBe(1);
  resolve('fresh'); await Promise.all([a,b]); expect(resource.snapshot().data).toBe('fresh');
});
