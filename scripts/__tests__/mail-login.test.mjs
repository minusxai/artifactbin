import {EventEmitter} from 'node:events';
import {expect,it,vi} from 'vitest';
import {JSDOM} from 'jsdom';
import {loginViaEmail,passTheWelcomePage} from '../lib/mail-login.mjs';

it('reports initial navigation/resource/session failures without credential values or an extra wait',async()=>{
 const original=new Error('form timeout');
 const waits=[];
 // Protocol events only: this fixture never invents or renders an Email field.
 const page=new EventEmitter();
 page.goto=async()=>{
  const request={resourceType:()=> 'script',url:()=> 'https://example.test/assets/entry.js?token=never_log_this',failure:()=>({errorText:'net::ERR_FAILED'})};
  page.emit('requestfailed',request);
  page.emit('response',{request:()=>({resourceType:()=> 'fetch'}),url:()=> 'https://example.test/api/page/session',status:()=>200,json:async()=>({kind:'none',user:null,token:'never_log_this'})});
  return{status:()=>200};
 };
 page.url=()=> 'https://example.test/login?callbackUrl=never_log_this';
 page.waitForSelector=async(selector,options)=>{waits.push({selector,...options});throw original;};
 let failure;
 try{await loginViaEmail(page,'https://example.test',{},'mxmx_test_gate@example.com');}catch(error){failure=error;}
 expect(failure?.message).toContain('navigation HTTP 200, path=/login, session=HTTP 200, kind=none, user=false');
 expect(failure?.message).toContain('script /assets/entry.js: net::ERR_FAILED');
 expect(failure?.message).not.toContain('never_log_this');
 expect(failure?.cause).toBe(original);
 expect(waits).toEqual([{selector:'[aria-label="Email"]',timeout:45000}]);
 for(const event of ['requestfailed','pageerror','response'])expect(page.listenerCount(event)).toBe(0);
});

it('retains bounded structural welcome diagnostics without tokens, codes or workspace text',async()=>{
 const dom=new JSDOM('<div id="root"><main aria-label="Loading page">private workspace secret</main></div><script src="/assets/main.js?token=never_log_this"></script>',{url:'https://example.test/'});
 vi.stubGlobal('document',dom.window.document);
 const fetch=vi.fn(async()=>new Response(JSON.stringify({kind:'account',onboarded:false,user:{email:'mxmx_test_gate@example.com'},token:'never_log_this',code:'secret_code'})));
 vi.stubGlobal('fetch',fetch);
 try{
  const page={waitForFunction:async()=>({jsonValue:async()=> 'welcome'}),waitForURL:async()=>{throw Error('navigation missing');},
   url:()=> 'https://example.test/?token=never_log_this',evaluate:async(work,input)=>work(input)};
  let failure;try{await passTheWelcomePage(page,'mxmx_test_gate@example.com');}catch(error){failure=error;}
  expect(failure.message).toContain('"rootChildren":1');
  expect(failure.message).toContain('"scripts":["/assets/main.js"]');
  expect(failure.message).toContain('"expectedAccount":true');
  for(const secret of ['never_log_this','secret_code','private workspace secret'])expect(failure.message).not.toContain(secret);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
 }finally{vi.unstubAllGlobals();dom.window.close();}
});
