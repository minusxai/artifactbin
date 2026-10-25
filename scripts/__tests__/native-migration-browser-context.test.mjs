import {describe,it,expect} from 'vitest';
import {nativeMigrationBrowserContext} from '../lib/native-migration-browser-context.mjs';
describe('native migration local browser context',()=>{
 it('enables production secure-context APIs on only the exact app and actual reader origins',()=>{
  const value=nativeMigrationBrowserContext('http://app.lvh.me:3030',['sample','mapped','sample']);
  expect(value.origins).toEqual(['http://app.lvh.me:3030','http://6d6170706564.lvh.me:3030','http://73616d706c65.lvh.me:3030']);
  expect(value.args).toEqual(['--unsafely-treat-insecure-origin-as-secure='+value.origins.join(',')]);
  expect(value.channel).toBe('chromium');
  expect(value.policy).toBe('exact-local-trustworthy-origins-v1');
 });
 it('rejects remote, wildcard, credentialed and non-origin configuration',()=>{
  for(const base of ['https://example.com','http://*.lvh.me:3030','http://user@app.lvh.me:3030','http://app.lvh.me:3030/path','http://app.lvh.me:3030/?q=1','file:///tmp/page'])expect(()=>nativeMigrationBrowserContext(base,['sample'])).toThrow('native_browser_local_origin');
  for(const id of ['*','x.y','x/y','',null])expect(()=>nativeMigrationBrowserContext('http://app.lvh.me:3030',[id])).toThrow('native_browser_reader_id');
 });
 it('does not need a trust override for an existing HTTPS local runner',()=>{
  expect(nativeMigrationBrowserContext('https://app.lvh.me:3030',['sample']).args).toEqual([]);
 });
});
