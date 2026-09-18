import {expect,it,vi} from 'vitest';
import {ACTOR_HEADER,ANONYMOUS,BROWSER_SESSION_HEADER,type Actor} from '@artifactbin/contracts';
import {createEnv} from '@artifactbin/utils';
import {createSessionProcess,forwardSessionFetch,sessionPlainPlan,sessionSandboxPlan} from '../src/session-process';
import {sessionProcessPaths,sessionSandboxChoice} from '../src/session-config';
import {createBrowserSessions} from '../src/sessions';
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
