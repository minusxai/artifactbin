import {EventEmitter} from 'node:events';
import {expect,it} from 'vitest';
import {loginViaEmail} from '../lib/mail-login.mjs';

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
