import { ACTOR_HEADER, type Actor } from '@artifactbin/contracts';
import { signActor } from '@artifactbin/utils';
import { describe, expect, it, vi } from 'vitest';
import { createUser } from '@/lib/users';
import { mintToken } from '@/lib/tokens';
import {POST as createArtifact} from '@/app/api/artifacts/route';
import { useAppHarness, request } from '@/__tests__/harness';

const config = vi.hoisted(() => ({ ssr: false, controls:null as string|null }));
vi.mock('@/lib/config', async original => ({ ...await original<typeof import('@/lib/config')>(), get CONTROLS_ORIGIN(){return config.controls;}, get SSR_ENABLED() { return config.ssr; } }));
import { createAppServer,APP_CSP } from '../app';
import {directPageHtml} from '../direct-page';
useAppHarness();
const secret = 'same-origin-pages-fixture-secret';
const app = createAppServer({ actorSecret: secret, indexHtml: async () => '<!doctype html><html><head><title>artifactbin</title></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>' });
const headers = (actor: Actor) => ({ [ACTOR_HEADER]: signActor(actor, secret), accept: 'text/html' });

describe('same-origin initial app responses with dynamic SSR disabled', () => {
  it('places resolved artifact font preloads in the initial head, once and safely escaped',()=>{
    const template='<html><head></head><body><div id="root"></div></body></html>';
    const data={path:'/a/Ab1234',presentation:'artifact' as const,ssr:false,session:{kind:'none' as const,user:null,mixpanel:{token:null,host:''}},artifact:{surface:{fontPreloads:['/fonts/modernist.woff2','/fonts/modernist.woff2','/fonts/custom.woff2?x="&y=<']}}};
    const {html}=directPageHtml(template,data,'https://example.test',false,200);
    const head=html.split('</head>')[0];
    expect(head).toContain('<link rel="preload" as="font" type="font/woff2" crossorigin="anonymous" href="/fonts/modernist.woff2">');
    expect(head.match(/href="\/fonts\/modernist.woff2"/g)).toHaveLength(1);
    expect(head).toContain('href="/fonts/custom.woff2?x=&quot;&amp;y=&lt;"');
    expect(html.split('</head>')[1]).not.toContain('as="font"');
    expect(directPageHtml(template,data,'https://example.test',false,404).html).not.toContain('as="font"');
  });
  it('does not bypass the proxy verdict when controls origin is retired', async () => {
    const response = await app.request('/account', { headers: { accept: 'text/html' } });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'proxy_required' });
  });

  it('serves useful static logged-out landing HTML, without a framing wait', async () => {
    const response = await app.request('/', { headers: headers({ credential: 'none' }) });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toMatch(/<h1[\s>]/);
    expect(html).not.toContain('Loading artifactbin');
    expect(html).not.toMatch(/<iframe\b/);
    expect(html).toContain('"presentation":"public"');
    expect(html).toContain('"kind":"none"');
  });

  it('chooses the workspace skeleton before first paint for a valid session', async () => {
    const user = await createUser({ email: 'mxmx_test_same_origin_pages@example.com' });
    const response = await app.request('/', { headers: headers({ credential: 'session', userId: user.id, email: user.email }) });
    const html = await response.text();
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(html).toContain('aria-label="Loading workspace"');
    expect(html).not.toMatch(/<iframe\b/);
    expect(html).not.toContain('Loading artifactbin');
    expect(html).toContain('"presentation":"workspace"');
    expect(html).toContain('"kind":"account"');
  });

  it('offers a themed account shell rather than blank or cross-origin frame HTML', async () => {
    const user = await createUser({ email: 'mxmx_test_same_origin_account@example.com' });
    const response = await app.request('/account', { headers: headers({ credential: 'session', userId: user.id, email: user.email }) });
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('aria-label="Loading account"');
    expect(html).not.toMatch(/<iframe\b/);
    expect(html).not.toContain('Loading artifactbin');
  });

  it('keeps logged-out account shell private-cache-safe in either SSR mode', async () => {
    for (const ssr of [false, true]) {
      config.ssr = ssr;
      try {
        const response = await app.request('/account', { headers: headers({ credential: 'none' }) });
        const html = await response.text();
        expect(response.headers.get('cache-control')).toContain('no-store');
        expect(html).not.toMatch(/<iframe\b/);
        expect(html).not.toContain('Loading artifactbin');
        expect(html).toContain('"kind":"none"');
        expect(html).toContain('"presentation":"account"');
      } finally { config.ssr = false; }
    }
  });
  it('requires a verified verdict rather than a forged actor header or a raw cookie',async()=>{
    for(const value of ['forged',signActor({credential:'session',userId:'fake'},'wrong-secret')]){
      expect((await app.request('/account',{headers:{[ACTOR_HEADER]:value,accept:'text/html'}})).status).toBe(403);
    }
    const response=await app.request('/',{headers:{...headers({credential:'none'}),cookie:'better-auth.session_token=looks-valid'}});
    expect(await response.text()).toContain('"presentation":"public"');
  });
  it('preserves validated anonymous draft holders without treating them as logged-out landing visitors',async()=>{
    const token=await mintToken('held');
    const response=await app.request('/',{headers:headers({credential:'agent-cookie',tokenId:token.id,heldTokenIds:[token.id]})});
    const html=await response.text();
    expect(html).toContain('"kind":"anon"');expect(html).toContain('aria-label="Loading workspace"');
    expect(html).not.toContain(token.token);
  });
  it('renders useful workspace data only when SSR is enabled, with safe startup serialization',async()=>{
    const user=await createUser({email:'mxmx_test_server_ssr@example.com'}),token=await mintToken('ssr',user.id);
    const created=await createArtifact(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<Helmet><title>SSR workspace proof</title></Helmet><p>Private content</p>',visibility:'private'}}));
    expect(created.status).toBe(201);
    config.ssr=true;
    try{
      const response=await app.request('/',{headers:headers({credential:'session',userId:user.id,email:user.email})});
      const html=await response.text();
      expect(html.split('<body>')[1]).toContain('SSR workspace proof');expect(html).toContain('"ssr":true');
      expect(html).toContain('aria-label="Dashboard rail"');
      expect(html).not.toContain('aria-label="Loading workspace"');expect(html).not.toContain(token.token);
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(html.indexOf('id="mx-page-data"')).toBeLessThan(html.indexOf('<body>'));
    }finally{config.ssr=false;}
  });
  it('does not select the retired frame architecture when an old deployment still configures controls origin',async()=>{
    config.controls='http://i.localhost:3000';
    try{
      const response=await app.request('/account',{headers:headers({credential:'none'})});
      expect(await response.text()).toContain('"presentation":"account"');
      const legacy=await app.request('/controls/page/account',{headers:headers({credential:'none'})});
      expect([302,404]).toContain(legacy.status);
      expect(await legacy.text()).not.toContain('mx-page-frame-config');
    }finally{config.controls=null;}
  });
  it('shows recognizable powerless app chrome before JavaScript loads',async()=>{
    const html=await (await app.request('/account',{headers:headers({credential:'none'})})).text();
    expect(html).toContain('aria-label="Page bar"');
    expect(html).toContain('/logo-128.png');
    expect(html).toMatch(/<div[^>]*inert=""/);
    expect(html).not.toContain('<form');
  });
  it('keeps artifact social metadata and privacy identical in both SSR modes',async()=>{
    const user=await createUser({email:'mxmx_test_metadata@example.com'}),token=await mintToken('metadata',user.id);
    const made=await createArtifact(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<Helmet><title>Metadata proof</title></Helmet><p>body proof</p>',description:'Description proof',visibility:'public'}}));
    expect(made.status).toBe(201);const {id}=await made.json();
    for(const ssr of [false,true]){config.ssr=ssr;try{
      const response=await app.request('/a/'+id,{headers:headers({credential:'none'})}),html=await response.text();
      expect(response.status).toBe(200);expect(response.headers.get('content-security-policy')).toBe(APP_CSP);
      expect(html).toContain('<meta property="og:title" content="Metadata proof">');
      expect(html).toContain('<meta property="og:description" content="Description proof">');
      expect(html).toContain('/a/'+id+'/export?mode=card');
      expect(html).toContain('"ssr":false');expect(html).toContain('aria-label="Loading artifact"');
      expect(html.indexOf('id="mx-page-data"')).toBeLessThan(html.indexOf('<body>'));
    }finally{config.ssr=false;}}
  });
  it('preloads the admitted artifact payload fonts in the real initial response before mounting',async()=>{
    const token=await mintToken('font-head');
    const made=await createArtifact(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<h1>Font head proof</h1>',theme:'modernist',visibility:'public'}}));
    expect(made.status).toBe(201);const {id}=await made.json();
    const response=await app.request('/a/'+id,{headers:headers({credential:'none'})});
    expect(response.status).toBe(200);const html=await response.text();
    const payload=JSON.parse(html.match(/<script type="application\/json" id="mx-page-data">(.*?)<\/script>/s)![1]);
    const fonts:string[]=payload.artifact.surface.fontPreloads;
    expect(fonts.length).toBeGreaterThan(0);
    const head=html.split('</head>')[0];
    for(const href of fonts)expect(head).toContain(`crossorigin="anonymous" href="${href}"`);
  });
  it('renders the existing folder body only with SSR enabled, while always bootstrapping readable rows',async()=>{
    const token=await mintToken('folder-ssr');
    const response=await createArtifact(request('/api/artifacts',{method:'POST',token:token.token,json:{format:'folder',title:'Folder body proof',visibility:'public'}}));
    expect(response.status).toBe(201);const {id}=await response.json();
    for(const ssr of [false,true]){config.ssr=ssr;try{
      const html=await (await app.request('/a/'+id,{headers:headers({credential:'none'})})).text();
      expect(html).toContain('Folder body proof');
      expect(html.split('<body>')[1].includes('<main')).toBe(ssr);
      expect(html).toContain(`"ssr":${ssr}`);
    }finally{config.ssr=false;}}
  });
});
