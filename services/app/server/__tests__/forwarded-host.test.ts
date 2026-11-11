/**
 * THE ADDRESSED HOST COMES FROM A TRUSTED HOP OR FROM THE REQUEST (lib/http `trustedForwarded`), through the real
 * app server: with no trusted proxy (HTTP__TRUSTED_PROXY_HOPS=0) a caller's `X-Forwarded-Host` cannot make a
 * request on a document's origin, a publishing host or the app read as addressed to another of them; with one
 * trusted hop the proxy's header is the address, and only the entry that hop wrote.
 * `/llms.txt` tells them apart: the app answers it (its links name the origin it was addressed as); a document's
 * origin and a publishing host refuse it.
 */
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {useAppHarness,testPagesSite} from '@/__tests__/harness';
import {overrideConfig,resetConfigOverrides} from '@/lib/platform/config';
import {pagesOriginFor} from '@/lib/http';
import {createAppServer} from '../app';

useAppHarness();
const APP='https://app.example.test';
const site=testPagesSite('pages.example.test',APP)!;
const app=()=>createAppServer({indexHtml:async()=>'<!doctype html><title>app</title>',pagesSite:site});
const DOC=pagesOriginFor('docAAAA1',site),OTHER=pagesOriginFor('docBBBB2',site),USER='https://alice.u.example.test',INTERNAL='http://internal:3000';
const host=(origin:string)=>new URL(origin).host;
/** Which origin the server treated the request as addressed to: the app's (its guide names it), or not the app. */
async function addressedAs(url:string,headers:Record<string,string>={}):Promise<string>{
 const res=await app().request(url+'/llms.txt',{headers});
 if(res.status!==200)return `not the app (${res.status})`;
 return /(https?:\/\/[^\s/()]+)\/skills\/artifactbin\.zip/.exec(await res.text())?.[1]??'unknown';
}

/** Another document's origin calling this document's door: refused as foreign unless its host is the addressed one. */
async function refusedAsForeign(headers:Record<string,string>):Promise<boolean>{
 const res=await app().request(DOC+'/a/docAAAA1/query',{method:'POST',headers:{origin:OTHER,...headers},body:'{}'});
 return res.status===403&&(await res.text()).includes('forbidden_origin');
}

beforeEach(()=>overrideConfig({publicBaseUrl:APP,userPagesHost:'u.example.test'}));
afterEach(()=>resetConfigOverrides());

describe('with no trusted hop',()=>{
 beforeEach(()=>overrideConfig({trustedProxyHops:0}));
 it('a document origin and a publishing host stay theirs, whatever host the caller forwards',async()=>{
  expect(await addressedAs(DOC)).toBe('not the app (404)');
  expect(await addressedAs(DOC,{'x-forwarded-host':host(APP),'x-forwarded-proto':'https'})).toBe('not the app (404)');
  expect(await addressedAs(USER)).toBe('not the app (404)');
  expect(await addressedAs(USER,{'x-forwarded-host':host(APP),'x-forwarded-proto':'https'})).toBe('not the app (404)');
 });
 it('another document\'s origin cannot forward its own host to pass as this document\'s',async()=>{
  expect(await refusedAsForeign({})).toBe(true);
  expect(await refusedAsForeign({'x-forwarded-host':host(OTHER)})).toBe(true);
 });
 it('the app origin stays the app\'s, and its links name it, whatever host the caller forwards',async()=>{
  for(const forwarded of [host(DOC),host(USER),'spoof.example'])
   expect(await addressedAs(APP,{'x-forwarded-host':forwarded,'x-forwarded-proto':'http'})).toBe(APP);
 });
});

describe('with one trusted hop',()=>{
 beforeEach(()=>overrideConfig({trustedProxyHops:1}));
 it('the proxy\'s forwarded host and proto are the address',async()=>{
  expect(await addressedAs(INTERNAL,{'x-forwarded-host':host(APP),'x-forwarded-proto':'https'})).toBe(APP);
  expect(await addressedAs(INTERNAL,{'x-forwarded-host':host(DOC),'x-forwarded-proto':'https'})).toBe('not the app (404)');
  expect(await addressedAs(INTERNAL,{'x-forwarded-host':host(USER),'x-forwarded-proto':'https'})).toBe('not the app (404)');
  // The proxy names the other document's host: the request is that document's, its own origin, not a foreign call.
  expect(await refusedAsForeign({'x-forwarded-host':host(OTHER)})).toBe(false);
 });
 it('reads only the entry the trusted hop appended, never the caller\'s text to its left',async()=>{
  expect(await addressedAs(INTERNAL,{'x-forwarded-host':`${host(APP)}, ${host(DOC)}`})).toBe('not the app (404)');
  expect(await addressedAs(INTERNAL,{'x-forwarded-host':`${host(DOC)}, ${host(APP)}`,'x-forwarded-proto':'http, https'})).toBe(APP);
 });
});
