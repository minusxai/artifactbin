/**
 * A CUSTOM SHELL (APP__SHELL_FILE, ../custom-shell): the operator's one HTML file answers every screen, the page and
 * handle screens included, under the policy the app page at that address carries; the API, assets, sign-in screens,
 * every door and file under a page, the installed app and export captures stay the app's; unset, the app answers
 * exactly as before.
 */
import {nativeHtml} from '@/__tests__/native-html-fixture';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {POST as createArtifactRoute} from '@/app/api/artifacts/route';
import {createUser,ensureUsername,mintToken} from '@/lib/accounts';
import {overrideConfig} from '@/lib/platform/config';
import {shellFile} from '@/lib/platform';
import {createAppServer} from '../app';
import {useAppHarness} from '@/__tests__/harness';
useAppHarness();

const INDEX='<html><head></head><body><div id="root"></div></body></html>';
const SHELL='<!doctype html><html><head><title>Front door</title></head><body data-shell><main id="front"></main></body></html>';
const NONCED='<!doctype html><html><head><script nonce="__CSP_NONCE__">window.a=1</script></head><body data-shell><script nonce="__CSP_NONCE__" type="module" src="/af/host.js"></script></body></html>';
const HEADED='<!doctype html><html><head>__HEAD_TAGS__</head><body data-shell></body></html>';
let dir='',plain='',nonced='',headed='';
beforeAll(async()=>{dir=await mkdtemp(join(tmpdir(),'shell-'));[plain,nonced,headed]=['shell','nonced','headed'].map(name=>join(dir,`${name}.html`));
 await writeFile(plain,SHELL);await writeFile(nonced,NONCED);await writeFile(headed,HEADED);});
afterAll(async()=>{await rm(dir,{recursive:true,force:true});});
beforeEach(()=>overrideConfig({},{APP__DEPLOYMENT_MODE:'public'}));
const server=(file:string|null)=>createAppServer({indexHtml:async()=>INDEX,shellFile:file});
const html={headers:{accept:'text/html'}};
const isShell=async(response:Response)=>(await response.clone().text()).includes('data-shell');
const ID='Ab3xK9Lm';

describe('with a custom shell',()=>{
 it('answers / , every app screen, the page and handle screens and every unserved address: 200, uncached, under the app page\'s policy, with the agent pointer',async()=>{
  const app=server(plain),reference=await server(null).request('/login',html);
  for(const path of ['/','/projects/42/settings','/x','/account','/groups','/groups/g_1/settings','/trash','/docs-human','/getting-started','/local/publish',
   `/a/${ID}`,`/a/${ID}/edit`,'/@nobody_here','/@nobody_here/a-doc','/@nobody_here/a-doc/edit']){
   const response=await app.request(path,html);
   expect(response.status,path).toBe(200);
   expect(await response.text(),path).toBe(SHELL);
   expect(response.headers.get('cache-control'),path).toBe('no-store');
   expect(response.headers.get('content-type'),path).toBe('text/html; charset=utf-8');
   expect(response.headers.get('x-content-type-options'),path).toBe('nosniff');
   expect(response.headers.get('link'),path).toBe('<http://localhost/llms.txt>; rel="help"');
   // The app page's own policy, exactly: framed by the app alone, scripts, styles and API calls same-origin.
   expect(response.headers.get('content-security-policy'),path).toBe(reference.headers.get('content-security-policy'));
  }
  for(const directive of ["frame-ancestors 'self'","script-src 'self'","connect-src 'self'","style-src 'self'"])expect(reference.headers.get('content-security-policy')).toContain(directive);
  const head=await app.request('/deep/link',{method:'HEAD'});
  expect(head.status).toBe(200);expect(await head.text()).toBe('');
 });
 it('a document address keeps the framing the app page there allows: its trusted embedders',async()=>{
  overrideConfig({},{APP__DEPLOYMENT_MODE:'public',EMBED__TRUSTED_ORIGINS:'https://portal.example'});
  const app=server(plain);
  expect((await app.request(`/a/${ID}`,html)).headers.get('content-security-policy')).toContain("frame-ancestors 'self' https://portal.example");
  expect((await app.request(`/a/${ID}?embed=1`,html)).headers.get('content-security-policy')).toContain('frame-ancestors https://portal.example');
  expect((await app.request('/account',html)).headers.get('content-security-policy')).toContain("frame-ancestors 'self';");
 });
 it('leaves the sign-in screens, the agent handoff, the API, assets, every door and file under a page, the installed app and export captures to the app',async()=>{
  const app=server(plain);
  for(const path of ['/login','/welcome','/start','/start?agent=1']){
   const response=await app.request(path,html);
   expect(response.status,path).toBe(200);expect(await isShell(response),path).toBe(false);expect(await response.text()).toContain('id="root"');
  }
  for(const path of [`/a/${ID}/raw`,`/a/${ID}/story`,`/a/${ID}/export`,`/a/${ID}/download`,`/a/${ID}/tables`,`/a/${ID}/css`,`/a/${ID}/events`,`/a/${ID}/assets/x.png`,
   `/a/${ID}/app/`,`/a/${ID}/app`,`/a/${ID}/whatever/else`,`/a/${ID}?key=a.b`]){
   const response=await app.request(path,html);
   expect(response.status,path).toBeGreaterThanOrEqual(300);expect(await isShell(response),path).toBe(false);
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
 it('fills __HEAD_TAGS__ with a document\'s own head only where an anonymous reader may read it, and with nothing elsewhere',async()=>{
  const owner=await ensureUsername(await createUser({email:'mxmx_test_shell_owner@example.com'})),t=await mintToken('o',owner.id);
  const create=async(title:string,visibility:string)=>((await (await createArtifactRoute(new Request('http://localhost/api/artifacts',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${t.token}`},
   body:JSON.stringify({title,description:`${title} summary`,html:nativeHtml(`<div><p>${title}</p></div>`),visibility})}))).json()) as {id:string}).id;
  const shared=await create('Quarterly $& Report','unlisted'),secret=await create('Private Plans','private');
  const app=server(headed);
  const headOf=async(path:string)=>/<head>([\s\S]*)<\/head>/.exec(await (await app.request(path,html)).text())![1]!;
  const tags=await headOf(`/a/${shared}`);
  expect(tags).toContain('<title>Quarterly $&amp; Report</title>');
  expect(tags).toContain('<meta property="og:description" content="Quarterly $&amp; Report summary">');
  expect(tags).toMatch(new RegExp(`<meta property="og:image" content="[^"]*/a/${shared}/export\\?mode=card`));
  expect(tags).toContain('<link rel="canonical"');
  expect(await headOf(`/a/${shared}/edit`)).toBe(tags);
  // Never a private document's, even for its owner's own request; never on a screen that names no document.
  for(const path of [`/a/${secret}`,`/a/${ID}`,'/','/account',`/@${owner.username}`])expect(await headOf(path),path).toBe('');
  const owned=await app.request(`/a/${secret}`,{headers:{accept:'text/html',authorization:`Bearer ${t.token}`}});
  expect(await owned.text()).not.toContain('Private Plans');
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
  for(const path of ['/','/account','/deep/link','/login',`/a/${ID}`,`/a/${ID}/edit`,'/@nobody_here','/@nobody_here/a-doc']){
   const [a,b]=await Promise.all([configured.request(path,html),unset.request(path,html)]);
   expect([a.status,a.headers.get('location'),a.headers.get('link')],path).toEqual([b.status,b.headers.get('location'),b.headers.get('link')]);
   expect(await isShell(a),path).toBe(false);
  }
  expect((await unset.request('/',html)).status).toBe(302);
  expect((await unset.request('/deep/link',html)).status).toBe(404);
  expect((await unset.request(`/a/${ID}`,html)).status).toBe(404);
 });
});
