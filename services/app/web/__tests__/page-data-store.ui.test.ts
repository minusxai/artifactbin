import { expect, it } from 'vitest';
import { createPageDataStore } from '../page-data-store';

it('old subscription cleanup never deletes the replacement account resource', () => {
  const store = createPageDataStore(); store.setScope('A'); const old = store.resource<string>('x');
  const stop = old.subscribe(() => {}); store.expire(); store.clear();
  const replacement = store.resource<string>('x'); replacement.seed('new'); stop();
  expect(store.resource('x')).toBe(replacement); expect(replacement.snapshot().data).toBe('new');
});

it('evicts unused entries but keeps an active resource consistent', async () => {
  const store = createPageDataStore({ maxEntries: 1, maxBytes: 30 }); store.setScope('A');
  const active = store.resource<string>('active'); const stop = active.subscribe(() => {});
  active.seed('visible'); store.resource<string>('other').seed('x'.repeat(40));
  expect(store.resource('active')).toBe(active); expect(active.snapshot().data).toBe('visible');
  stop(); store.resource<string>('third').seed('new');
  expect(store.resource('active').snapshot().data).toBeNull();
});

it('purges permission failures but retains transient failures and can retry', async () => {
  const store = createPageDataStore(); store.setScope('A'); const r = store.resource<string>('a'); r.seed('old');
  await r.load(async () => { throw new Error('offline'); });
  // The failure is reported and settled, and the retained data stays visible behind it.
  expect(r.snapshot()).toMatchObject({ data: 'old', pending: false }); expect(r.snapshot().error).toBeInstanceOf(Error);
  await r.load(async () => { throw Object.assign(new Error('forbidden'), { status: 403 }); }); expect(r.snapshot().data).toBeNull();
  await r.load(async () => 'new'); expect(r.snapshot()).toMatchObject({ data: 'new', pending: false, error: null });
});

it('clearing retained data also prevents pending work from restoring it', async () => {
  const store = createPageDataStore(); store.setScope('account:A');
  const resource = store.resource<string>('/account'); resource.seed('private');
  let resolve!: (value: string) => void;
  const pending = resource.load(() => new Promise<string>(done => { resolve = done; }));
  store.clear(); expect(resource.snapshot().data).toBeNull();
  resolve('late private'); await pending;
  expect(resource.snapshot().data).toBeNull();
  expect(store.resource<string>('/account').snapshot().data).toBeNull();
});

it('a forced refresh supersedes an older completion and clear revokes held references', async () => {
  const store = createPageDataStore(); store.setScope('A'); const r = store.resource<string>('a');
  let done!: (x: string) => void;
  const old = r.load(() => new Promise<string>((resolve) => { done = resolve; }));
  await r.load(async () => 'new', { force: true }); done('old'); await old;
  expect(r.snapshot().data).toBe('new'); store.clear(); expect(r.snapshot().data).toBeNull();
  await r.load(async () => 'cannot resurrect old handle'); expect(store.resource('a').snapshot().data).toBeNull();
});

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
