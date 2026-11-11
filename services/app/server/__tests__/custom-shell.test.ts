/**
 * A CUSTOM SHELL (APP__SHELL_FILE, ../custom-shell): the operator's one HTML file answers the app's screens and every
 * address nothing else serves, under the app page's own policy; the API, assets, sign-in screens and document
 * addresses stay the app's; unset, the app answers exactly as before.
 */
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {overrideConfig} from '@/lib/platform/config';
import {shellFile} from '@/lib/platform';
import {createAppServer} from '../app';
import {useAppHarness} from '@/__tests__/harness';
useAppHarness();

const INDEX='<html><head></head><body><div id="root"></div></body></html>';
const SHELL='<!doctype html><html><head><title>Front door</title></head><body data-shell><main id="front"></main></body></html>';
const NONCED='<!doctype html><html><head><script nonce="__CSP_NONCE__">window.a=1</script></head><body data-shell><script nonce="__CSP_NONCE__" type="module" src="/af/host.js"></script></body></html>';
let dir='',plain='',nonced='';
beforeAll(async()=>{dir=await mkdtemp(join(tmpdir(),'shell-'));plain=join(dir,'shell.html');nonced=join(dir,'nonced.html');await writeFile(plain,SHELL);await writeFile(nonced,NONCED);});
afterAll(async()=>{await rm(dir,{recursive:true,force:true});});
beforeEach(()=>overrideConfig({},{APP__DEPLOYMENT_MODE:'public'}));
const server=(file:string|null)=>createAppServer({indexHtml:async()=>INDEX,shellFile:file});
const html={headers:{accept:'text/html'}};
const isShell=async(response:Response)=>(await response.clone().text()).includes('data-shell');

describe('with a custom shell',()=>{
 it('answers / and every deep address the app has no route for, 200, uncached, under the app page\'s policy',async()=>{
  const app=server(plain),reference=await server(null).request('/login',html);
  for(const path of ['/','/projects/42/settings','/x','/account','/groups','/groups/g_1/settings','/trash','/docs-human','/getting-started','/local/publish','/start?agent=1']){
   const response=await app.request(path,html);
   expect(response.status,path).toBe(200);
   expect(await response.text(),path).toBe(SHELL);
   expect(response.headers.get('cache-control'),path).toBe('no-store');
   expect(response.headers.get('content-type'),path).toBe('text/html; charset=utf-8');
   expect(response.headers.get('x-content-type-options'),path).toBe('nosniff');
   // The app page's own policy, exactly: framed by the app alone, scripts, styles and API calls same-origin.
   expect(response.headers.get('content-security-policy'),path).toBe(reference.headers.get('content-security-policy'));
  }
  for(const directive of ["frame-ancestors 'self'","script-src 'self'","connect-src 'self'","style-src 'self'"])expect(reference.headers.get('content-security-policy')).toContain(directive);
  const head=await app.request('/deep/link',{method:'HEAD'});
  expect(head.status).toBe(200);expect(await head.text()).toBe('');
 });
 it('leaves the sign-in screens, the API, assets and document addresses to the app',async()=>{
  const app=server(plain);
  for(const path of ['/login','/welcome']){
   const response=await app.request(path,html);
   expect(response.status,path).toBe(200);expect(await isShell(response),path).toBe(false);expect(await response.text()).toContain('id="root"');
  }
  for(const path of ['/a/Ab3xK9Lm','/a/Ab3xK9Lm/edit','/a/Ab3xK9Lm/whatever/else','/@nobody_here','/@nobody_here/a-doc']){
   const response=await app.request(path,html);
   expect(response.status,path).toBe(404);expect(await isShell(response),path).toBe(false);
  }
  const api=await app.request('/api/nothing-here',html);
  expect(api.status).toBe(404);expect(await api.json()).toMatchObject({error:'not_found'});
  for(const path of ['/llms.txt','/favicon.ico']){
   const response=await app.request(path);
   expect(response.status,path).toBe(200);expect(await isShell(response),path).toBe(false);
  }
 });
 it('substitutes one fresh script nonce per response for every __CSP_NONCE__, and nothing else',async()=>{
  const app=server(nonced);
  const nonces=new Set<string>();
  for(let i=0;i<2;i++){
   const response=await app.request('/',html),body=await response.text(),csp=response.headers.get('content-security-policy')!;
   const nonce=/script-src 'self' 'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1];
   expect(nonce).toBeTruthy();
   expect(body).toBe(NONCED.replaceAll('__CSP_NONCE__',nonce!));
   // Inline style stays as the app allows it: a nonce in style-src would switch 'unsafe-inline' off.
   expect(csp).toContain("style-src 'self' 'unsafe-inline';");
   nonces.add(nonce!);
  }
  expect(nonces.size).toBe(2);
 });
 it('refuses to boot on a file it cannot read, naming the setting',()=>{
  expect(()=>server(join(dir,'missing.html'))).toThrow(/APP__SHELL_FILE .*missing\.html.*cannot be read/);
 });
 it('is read from APP__SHELL_FILE, and unset by default',()=>{
  overrideConfig({},{APP__SHELL_FILE:undefined});expect(shellFile()).toBeNull();
  overrideConfig({},{APP__SHELL_FILE:` ${plain} `});expect(shellFile()).toBe(plain);
  overrideConfig({},{APP__SHELL_FILE:undefined});
 });
});

describe('without one',()=>{
 it('answers exactly as the app always has',async()=>{
  overrideConfig({},{APP__SHELL_FILE:undefined});
  const configured=createAppServer({indexHtml:async()=>INDEX}),unset=server(null);
  for(const path of ['/','/account','/deep/link','/login','/a/Ab3xK9Lm']){
   const [a,b]=await Promise.all([configured.request(path,html),unset.request(path,html)]);
   expect([a.status,a.headers.get('location')],path).toEqual([b.status,b.headers.get('location')]);
   expect(await isShell(a),path).toBe(false);
  }
  expect((await unset.request('/',html)).status).toBe(302);
  expect((await unset.request('/deep/link',html)).status).toBe(404);
 });
});
