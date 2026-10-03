import {expect,it,vi} from 'vitest';
import {ACTOR_HEADER,ANONYMOUS,BROWSER_SESSION_HEADER,type Actor} from '@artifactbin/contracts';
import {createEnv} from '@artifactbin/utils';
import {createSessionProcess,forwardSessionFetch,sessionPlainPlan,sessionSandboxPlan} from '../src/session-process';
import {sessionCapacity,sessionEnvNamesRead,sessionProcessPaths,sessionSandboxChoice} from '../src/session-config';
import {createBrowserSessions} from '../src/sessions';
import {createPagesCookieJar,sessionBrowserArgs,sessionOrigins} from '../src/session-origins';
import {FORWARDED_HOST} from '@artifactbin/contracts';
it('launches SEA through its trusted selector with only the executable and browser tree mounted',()=>{
 const plan=sessionSandboxPlan('/tmp/private-session','/cache/chromium/chrome-linux64','/home/operator/bin/afbin',['--internal-browser-worker']);
 expect(plan.args).toContain('--unshare-all');expect(plan.args).toContain('--die-with-parent');expect(plan.args).toContain('--new-session');
 expect(plan.args.slice(-2)).toEqual(['/worker-executable','--internal-browser-worker']);
 expect(plan.args).toEqual(expect.arrayContaining(['--ro-bind','/home/operator/bin/afbin','/worker-executable']));
 expect(plan.args).not.toContain('/home/operator/bin');
 expect(plan.args).toEqual(expect.arrayContaining(['/cache/chromium/chrome-linux64','/browsers']));
 expect(plan.env).toEqual({HOME:'/home/session',TMPDIR:'/tmp',PATH:'/usr/bin:/bin',PLAYWRIGHT_BROWSERS_PATH:'/browsers',NODE_OPTIONS:'--max-old-space-size=128'});
});
it('retains the existing ordinary Node worker command by default',()=>{
 const plan=sessionSandboxPlan('/tmp/private-session','/cache/ms-playwright','/usr/bin/node');
 expect(plan.args.slice(-3)).toEqual(['/worker-executable','--max-old-space-size=128','/runtime/worker.mjs']);
});

const forwarding=()=>{
 const seen:{request:Request;actor:Actor}[]=[];
 return {seen,baseURL:'http://app',async request(request:Request,actor:Actor){seen.push({request,actor});return new Response('page',{headers:{'content-type':'text/html','set-cookie':'a=b'}});}};
};

it('forwards a scripted fetch as the session actor and drops the credentials a script supplies',async()=>{
 const options=forwarding();
 const supplied={cookie:'mx_session=secret',authorization:'Bearer secret',[ACTOR_HEADER]:'forged',accept:'text/html','if-none-match':'"etag"'};
 const out=await forwardSessionFetch({type:'fetch',id:'1',url:'http://app/a/abc123',method:'GET',headers:supplied},{credential:'bearer',userId:'usr_owner'},options);
 expect(out.status).toBe(200);
 expect(Buffer.from(out.body,'base64').toString()).toBe('page');
 // The response never carries a cookie back into the scripted browser.
 expect(Object.keys(out.headers)).not.toContain('set-cookie');
 expect(options.seen).toHaveLength(1);
 const headers=options.seen[0]!.request.headers;
 expect(options.seen[0]!.actor).toEqual({credential:'bearer',userId:'usr_owner'});
 expect(headers.get(BROWSER_SESSION_HEADER)).toBe('1');
 expect(headers.get('accept')).toBe('text/html');
 expect(headers.get('if-none-match')).toBe('"etag"');
 for(const name of ['cookie','authorization',ACTOR_HEADER])expect(headers.get(name),name).toBeNull();
});

it('refuses a scripted fetch outside the session origin',async()=>{
 const options=forwarding();
 await expect(forwardSessionFetch({type:'fetch',id:'1',url:'https://elsewhere.test/a/abc123',method:'GET',headers:{}},ANONYMOUS,options)).rejects.toThrow(/origin/i);
 expect(options.seen).toHaveLength(0);
});

it('carries the anonymous actor from a guest session into the forwarded page request',async()=>{
 const options=forwarding();
 // The sandboxed worker is the only part left out: its fetch messages arrive exactly like this one.
 const sessions=createBrowserSessions(async actor=>({
  async run(){await forwardSessionFetch({type:'fetch',id:'1',url:'http://app/a/abc123',method:'GET',headers:{cookie:'mx_session=secret'}},actor,options);return {result:'ok',pages:[],attachments:[]};},
  async close(){},
 }));
 const owner={credential:'bearer' as const,tokenId:'tok_owner',userId:'usr_owner'};
 try{
  await sessions.request({actor:owner,op:'script',session_id:'guest',execution_id:'e1',create:true,code:'return 1',viewer:'guest'});
  await sessions.request({actor:owner,op:'script',session_id:'self',execution_id:'e1',create:true,code:'return 1'});
  await vi.waitFor(()=>expect(options.seen).toHaveLength(2));
  expect(options.seen[0]!.actor).toEqual(ANONYMOUS);
  expect(options.seen[0]!.request.headers.get('cookie')).toBeNull();
  expect(options.seen[1]!.actor).toMatchObject({userId:'usr_owner'});
 }finally{await sessions.close();}
});

/**
 * BROWSER__SANDBOX=none — live sessions on a development host that is not Linux.
 * The Linux plan above is unchanged and stays the default; this is the one escape
 * hatch, it is refused in production and for any other value, and it keeps the same
 * worker, the same stdio protocol and the same private HOME — only bubblewrap and the
 * cgroup are gone, and the browsers come from the host's real Playwright directory.
 */
it('runs the same worker as a plain child, with the sandbox mounts replaced by real paths',()=>{
 const plan=sessionPlainPlan('/tmp/private-session','/usr/bin/node',{browsers:'/Users/dev/Library/Caches/ms-playwright',path:'/usr/bin:/bin',tmp:'/var/tmp'});
 expect(plan.command).toBe('/usr/bin/node');
 expect(plan.args).toEqual(['--max-old-space-size=128','/tmp/private-session/worker.mjs']);
 // Same keys as the sandbox plan; no /runtime, /browsers or /home/session mount point survives.
 expect(Object.keys(plan.env).sort()).toEqual(Object.keys(sessionSandboxPlan('/r','/b','/e').env).sort());
 expect(plan.env).toEqual({HOME:'/tmp/private-session/home',TMPDIR:'/var/tmp',PATH:'/usr/bin:/bin',PLAYWRIGHT_BROWSERS_PATH:'/Users/dev/Library/Caches/ms-playwright',NODE_OPTIONS:'--max-old-space-size=128'});
 expect(JSON.stringify(plan)).not.toMatch(/\/runtime|\/browsers"|home\/session/);
 // A SEA composition keeps its own worker selector, exactly as the sandbox plan does.
 expect(sessionPlainPlan('/tmp/s','/home/operator/bin/afbin',{workerArgs:['--internal-browser-worker']}).args).toEqual(['--internal-browser-worker']);
});

it('reads the switch at the browser service env boundary and refuses it in production',()=>{
 expect(sessionSandboxChoice({})).toEqual({mode:'bubblewrap'});
 expect(sessionSandboxChoice({BROWSER__SANDBOX:'none',NODE_ENV:'development'})).toEqual({mode:'none'});
 expect(sessionSandboxChoice({BROWSER__SANDBOX:'none'})).toEqual({mode:'none'});
 const production=sessionSandboxChoice({BROWSER__SANDBOX:'none',NODE_ENV:'production'});
 expect(production.mode).toBe('bubblewrap');
 expect(production.refusal).toMatch(/BROWSER__SANDBOX/);
 expect(production.refusal).toMatch(/production/);
 const wrong=sessionSandboxChoice({BROWSER__SANDBOX:'bwrap',NODE_ENV:'development'});
 expect(wrong.mode).toBe('bubblewrap');
 expect(wrong.refusal).toMatch(/BROWSER__SANDBOX/);
 // The setting travels with the other session paths, so one composition reads it once.
 expect(sessionProcessPaths({BROWSER__SANDBOX:'none',BROWSER__SESSION_CGROUP_ROOT:'/sys/fs/cgroup/x'})).toMatchObject({cgroupRoot:'/sys/fs/cgroup/x',sandbox:{mode:'none'}});
 // It is one of OUR names, and the boundary is the only reader: a composition that asks
 // sessionProcessPaths for its session settings never leaves it in the env audit's unknown list.
 const audit=createEnv({BROWSER__SANDBOX:'none'});
 audit.env('BROWSER','SANDBOX');
 expect(audit.unknownNames()).toEqual([]);
});

it('spawns without bubblewrap when the sandbox is off, and refuses a production switch before spawning',async()=>{
 // No worker is started here: the refusal happens before any process or cgroup exists.
 await expect(createSessionProcess({credential:'bearer',userId:'usr_owner'},{
  baseURL:'http://app',request:async()=>new Response('page'),
  sandbox:sessionSandboxChoice({BROWSER__SANDBOX:'none',NODE_ENV:'production'}),
 })).rejects.toThrow(/BROWSER__SANDBOX/);
 await expect(createSessionProcess({credential:'bearer',userId:'usr_owner'},{
  baseURL:'http://app',request:async()=>new Response('page'),
  sandbox:sessionSandboxChoice({BROWSER__SANDBOX:'nope'}),
 })).rejects.toThrow(/BROWSER__SANDBOX/);
});

it('reads session capacity at the same env boundary, defaulting to two and refusing anything but a whole number',()=>{
 expect(sessionCapacity({})).toEqual({sessions:2,sessionsPerActor:2});
 expect(sessionCapacity({BROWSER__SESSION_MAX:'',BROWSER__SESSION_MAX_PER_ACTOR:''})).toEqual({sessions:2,sessionsPerActor:2});
 expect(sessionCapacity({BROWSER__SESSION_MAX:'8',BROWSER__SESSION_MAX_PER_ACTOR:'3'})).toEqual({sessions:8,sessionsPerActor:3});
 for(const value of ['0','-1','1.5','abc',' 3','3 ','1e2'])for(const name of ['BROWSER__SESSION_MAX','BROWSER__SESSION_MAX_PER_ACTOR'])
  expect(()=>sessionCapacity({[name]:value}),`${name}=${value}`).toThrow(name);
 // It travels with the other session settings, so every composition that spreads them enforces it.
 expect(sessionProcessPaths({BROWSER__SESSION_MAX:'5'})).toMatchObject({capacity:{sessions:5,sessionsPerActor:2}});
 // And the boot audit hears that this boundary read both names.
 expect([...sessionEnvNamesRead()]).toEqual(expect.arrayContaining(['BROWSER__SESSION_MAX','BROWSER__SESSION_MAX_PER_ACTOR']));
});

/**
 * EVERY DOCUMENT ON ITS OWN ORIGIN: the app page frames `<hex id>.<pages host>` through the apex's ticket
 * exchange, so a session admits exactly those origins beside the app's own, and the pages cookie the
 * exchange sets stays on this side of the worker.
 */
it('admits the app origin, the pages apex and document origins under the pages host, and nothing else',()=>{
 const origins=sessionOrigins('http://app.lvh.me:7001','lvh.me');
 for(const url of ['http://app.lvh.me:7001/a/x','http://lvh.me:7001/pages-session','http://646f6331.lvh.me:7001/'])expect(origins.allows(new URL(url)),url).toBe(true);
 for(const url of ['http://646f6331.lvh.me:7002/','https://646f6331.lvh.me:7001/','http://a.b.lvh.me:7001/','http://notahexlabel.lvh.me:7001/','http://646f6331.lvh.me.evil.test:7001/','http://u:p@646f6331.lvh.me:7001/','http://elsewhere.test/'])
  expect(origins.allows(new URL(url)),url).toBe(false);
 // The app's own origin is not the pages site even when it sits under the pages host.
 expect(origins.pages(new URL('http://app.lvh.me:7001/'))).toBe(false);
 // Without a pages host a session is the app's origin alone, as before.
 expect(sessionOrigins('http://app.lvh.me:7001').allows(new URL('http://646f6331.lvh.me:7001/'))).toBe(false);
});

it('maps a development pages host to loopback for the session browser and leaves a real one alone',()=>{
 expect(sessionBrowserArgs('lvh.me')).toEqual(['--host-resolver-rules=MAP *.lvh.me 127.0.0.1, MAP lvh.me 127.0.0.1']);
 expect(sessionBrowserArgs('pages.localhost')).toHaveLength(1);
 expect(sessionBrowserArgs('pages.example.com')).toEqual([]);
 expect(sessionBrowserArgs(undefined)).toEqual([]);
 expect(sessionProcessPaths({APP__PAGES_HOST:'LVH.me'})).toMatchObject({pagesHost:'lvh.me'});
 expect(sessionProcessPaths({})).not.toHaveProperty('pagesHost');
 expect(()=>sessionProcessPaths({APP__PAGES_HOST:'https://lvh.me'})).toThrow(/APP__PAGES_HOST/);
 expect([...sessionEnvNamesRead()]).toContain('APP__PAGES_HOST');
});

it('forwards a document request with the addressed host and the pages cookie the parent holds, never handing it back',async()=>{
 const seen:Request[]=[];
 const pagesHost='lvh.me';
 const jar=createPagesCookieJar(sessionOrigins('http://app.lvh.me:7001',pagesHost),pagesHost);
 const options={baseURL:'http://app.lvh.me:7001',pagesHost,jar,async request(request:Request){
  seen.push(request);
  const url=new URL(request.url);
  if(url.pathname==='/pages-session')return new Response(null,{status:302,headers:[['location','http://646f6331.lvh.me:7001/'],['set-cookie','afbin_pages=c0ffee; Domain=.lvh.me; Path=/; HttpOnly'],['set-cookie','other=x; Path=/']]});
  return new Response('doc',{headers:{'content-type':'text/html'}});
 }};
 const actor={credential:'bearer' as const,tokenId:'tok_owner',userId:'usr_owner'};
 const exchanged=await forwardSessionFetch({type:'fetch',id:'1',url:'http://lvh.me:7001/pages-session?ticket=t',method:'GET',headers:{}},actor,options);
 expect(exchanged.status).toBe(302);
 expect(exchanged.headers.location).toBe('http://646f6331.lvh.me:7001/');
 expect(Object.keys(exchanged.headers)).not.toContain('set-cookie');
 // A script-supplied cookie is dropped; the parent's own pages cookie is what the document request carries.
 await forwardSessionFetch({type:'fetch',id:'2',url:'http://646f6331.lvh.me:7001/',method:'GET',headers:{cookie:'afbin_pages=forged'}},actor,options);
 await forwardSessionFetch({type:'fetch',id:'3',url:'http://app.lvh.me:7001/a/doc1',method:'GET',headers:{}},actor,options);
 expect(seen.map(request=>request.headers.get(FORWARDED_HOST))).toEqual(['lvh.me:7001','646f6331.lvh.me:7001','app.lvh.me:7001']);
 expect(seen.map(request=>request.headers.get('cookie'))).toEqual([null,'afbin_pages=c0ffee',null]);
});

it('expires and clears what the pages site set, and keeps nothing set for another domain',()=>{
 let now=1_000_000;
 const origins=sessionOrigins('http://app.lvh.me:7001','lvh.me');
 const jar=createPagesCookieJar(origins,'lvh.me',()=>now);
 const site=new URL('http://lvh.me:7001/pages-session');
 const set=(...lines:string[])=>jar.store(site,new Response(null,{headers:lines.map(line=>['set-cookie',line] as [string,string])}));
 set('afbin_pages=a; Domain=lvh.me; Max-Age=60','host-only=x','wide=y; Domain=example.com');
 expect(jar.headerFor(new URL('http://646f6331.lvh.me:7001/'))).toBe('afbin_pages=a');
 now+=61_000;
 expect(jar.headerFor(new URL('http://646f6331.lvh.me:7001/'))).toBeNull();
 set('afbin_pages=b; Domain=.lvh.me');
 set('afbin_pages=; Domain=.lvh.me; Max-Age=0');
 expect(jar.headerFor(new URL('http://646f6331.lvh.me:7001/'))).toBeNull();
 // An app-origin answer is never the jar's.
 jar.store(new URL('http://app.lvh.me:7001/a/x'),new Response(null,{headers:{'set-cookie':'afbin_pages=c; Domain=.lvh.me'}}));
 expect(jar.headerFor(new URL('http://lvh.me:7001/'))).toBeNull();
});
