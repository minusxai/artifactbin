import { expect, it, vi } from 'vitest';
import { createPageDataStore } from '../page-data-store';

it('repeated preload of the same navigation is idempotent after completion', async () => {
  const store=createPageDataStore();store.setScope('A');const load=vi.fn(async()=>1);
  await store.preload('page','nav',load);await store.preload('page','nav',load);
  expect(load).toHaveBeenCalledTimes(1);expect(store.adoptPreload('page','nav')).toBe(true);
});

it('last subscriber cancellation revokes pending preload ownership', () => {
  const store=createPageDataStore();store.setScope('A');
  void store.preload('page','nav',()=>new Promise(()=>{}));
  const stop=store.resource('page').subscribe(()=>{});stop();
  expect(store.adoptPreload('page','nav')).toBe(false);
});

it('adopts a completed preload once without disabling later revalidation', async () => {
  const store=createPageDataStore();store.setScope('A');let calls=0;
  const load=async()=>++calls;
  await store.preload('artifact','nav1',load);
  expect(store.adoptPreload('artifact','nav1')).toBe(true);
  expect(store.resource('artifact').snapshot().data).toBe(1);
  expect(store.adoptPreload('artifact','nav1')).toBe(false);
  await store.resource('artifact').load(load);expect(calls).toBe(2);
});

it('never adopts a different navigation or an old-account preload', async () => {
  const store=createPageDataStore();store.setScope('A');
  await store.preload('profile','nav1',async()=> 'private');
  expect(store.adoptPreload('profile','nav2')).toBe(false);
  store.setScope('B');
  expect(store.adoptPreload('profile','nav1')).toBe(false);
  expect(store.resource('profile').snapshot().data).toBeNull();
});

it('adopts pending work and does not need a second loader call', async () => {
  const store=createPageDataStore();store.setScope('A');let done!:(value:string)=>void;
  const p=store.preload('home','nav1',()=>new Promise<string>(resolve=>{done=resolve;}));
  const stop=store.resource('home').subscribe(()=>{});
  expect(store.adoptPreload('home','nav1')).toBe(true);
  done('home');await p;
  expect(store.resource('home').snapshot().data).toBe('home');stop();
});

it('cancel, expiry and forced refresh revoke preload adoption', async () => {
  for (const action of ['cancel', 'expire', 'refresh'] as const) {
    const store=createPageDataStore();store.setScope('A');
    await store.preload('page','nav',async()=>1);
    if(action==='cancel')store.resource('page').cancel();
    if(action==='expire')store.expire();
    if(action==='refresh')await store.resource('page').load(async()=>2,{force:true});
    expect(store.adoptPreload('page','nav')).toBe(false);
  }
});

it('rejected preloads cannot be adopted', async () => {
  const store=createPageDataStore();store.setScope('A');
  await store.preload('page','nav',async()=>{throw new Error('unavailable');});
  expect(store.adoptPreload('page','nav')).toBe(false);
});

it('superseding navigation cancels abandoned preload work', async () => {
  const store=createPageDataStore();store.setScope('A');let oldSignal!:AbortSignal;
  void store.preload('old','nav1',(signal)=>{oldSignal=signal;return new Promise(()=>{});});
  await store.preload('new','nav2',async()=>2);
  expect(oldSignal.aborted).toBe(true);
  expect(store.adoptPreload('old','nav1')).toBe(false);
  expect(store.adoptPreload('new','nav2')).toBe(true);
});

it('preload ownership expires in bounded time', async () => {
  vi.useFakeTimers();
  try {
    const store=createPageDataStore();store.setScope('A');
    await store.preload('page','nav',async()=>1);
    await vi.advanceTimersByTimeAsync(30001);
    expect(store.adoptPreload('page','nav')).toBe(false);
  } finally {vi.useRealTimers();}
});


it('adopts startup work after the first identity resolves, but never after an account switch', async () => {
  const store = createPageDataStore(), loader = vi.fn(async () => 'home');
  const work = store.preload('home', 'initial', loader);
  expect(store.resource('home').snapshot().data).toBeNull();
  expect(store.adoptPreload('home', 'initial')).toBe(false);
  store.setScope('A'); await work;
  expect(store.adoptPreload('home', 'initial')).toBe(true);
  expect(store.resource('home').snapshot().data).toBe('home');
  expect(loader).toHaveBeenCalledOnce();
  store.setScope('B');
  expect(store.resource('home').snapshot().data).toBeNull();
});
