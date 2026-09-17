import {expect,it,vi} from 'vitest';
import {ACTOR_HEADER,ANONYMOUS,BROWSER_SESSION_HEADER,type Actor} from '@artifactbin/contracts';
import {forwardSessionFetch,sessionSandboxPlan} from '../src/session-process';
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
