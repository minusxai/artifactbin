import { expect, it } from 'vitest';
import { createPageDataStore } from '../page-data-store';

it('a forced refresh cannot be overwritten by an older completion', async () => {
  const store = createPageDataStore();
  store.setScope('account:A');
  const resource = store.resource<string>('/profile/alice');
  let older!: (value: string) => void;
  const first = resource.load(() => new Promise<string>(resolve => { older = resolve; }));
  await resource.load(async () => 'newer', { force: true });
  older('older');
  await first;
  expect(resource.snapshot().data).toBe('newer');
});

it('clearing retained data also prevents pending work from restoring it', async () => {
  const store = createPageDataStore();
  store.setScope('account:A');
  const resource = store.resource<string>('/account');
  resource.seed('private');
  let resolve!: (value: string) => void;
  const pending = resource.load(() => new Promise<string>(done => { resolve = done; }));
  store.clear();
  expect(resource.snapshot().data).toBeNull();
  resolve('late private');
  await pending;
  expect(resource.snapshot().data).toBeNull();
  expect(store.resource<string>('/account').snapshot().data).toBeNull();
});

it('transient failure retains the last data and a subsequent load can recover', async () => {
  const store = createPageDataStore();
  store.setScope('account:A');
  const resource = store.resource<string>('/assets');
  resource.seed('previous');
  await resource.load(async () => { throw new Error('offline'); });
  expect(resource.snapshot().data).toBe('previous');
  expect(resource.snapshot().pending).toBe(false);
  expect(resource.snapshot().error).toBeInstanceOf(Error);
  await resource.load(async () => 'fresh');
  expect(resource.snapshot()).toMatchObject({ data: 'fresh', pending: false, error: null });
});
