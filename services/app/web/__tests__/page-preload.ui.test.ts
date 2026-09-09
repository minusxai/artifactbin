import { expect, it } from 'vitest';
import { createPageDataStore } from '../page-data-store';

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
