import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HttpClient} from '../src/http';

test('ordinary writes use one conditional request, and actual 401 refreshes once without a validation GET',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-http-'));const calls:Array<{path:string;method:string;token:string|null}>=[];
 let expired=false;
 const request:typeof fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname;const token=new Headers(init?.headers).get('Authorization');calls.push({path,method:init?.method??'GET',token});
  if(path==='/oauth/token')return Response.json({access_token:'mx_new',refresh_token:'mxr_new',expires_in:1000});
  if(expired&&token==='Bearer mx_old')return Response.json({error:'unauthorized'},{status:401});
  return Response.json({id:'abc123',state:'a'.repeat(64)},{headers:{'X-Artifactbin-Account':'usr_one'}});
 };
 try{
  const client=new HttpClient({connection:{server:'https://example.com',token:'mx_old',refreshToken:'mxr_old',clientId:'afbin_client'},home,fetch:request,account:'usr_one'});
  await client.request('/artifacts/abc123','PUT',{expectedState:'a'.repeat(64)});assert.equal(calls.length,1);
  expired=true;await client.request('/artifacts/abc123','PUT',{expectedState:'a'.repeat(64)});
  assert.deepEqual(calls.map(x=>x.path),['/api/artifacts/abc123','/api/artifacts/abc123','/oauth/token','/api/artifacts/abc123']);
  assert.ok(calls.every(x=>x.method!=='GET'));
 }finally{await rm(home,{recursive:true,force:true});}
});
test('dry-run never refreshes credentials and requests cannot escape the selected origin',async()=>{
 let requests=0;
 const client=new HttpClient({connection:{server:'https://example.com',token:'mx_old',refreshToken:'mxr_old',clientId:'afbin_client'},readOnly:true,fetch:async()=>{requests++;return Response.json({error:'unauthorized'},{status:401});}});
 await assert.rejects(client.request('/artifacts/preflight','POST',{}),/auth_required/);assert.equal(requests,1);
 await assert.rejects(client.request('https://evil.example'),/path/);assert.equal(requests,1);
});
test('binary responses use the same authentication and preserve exact bytes',async()=>{
 const bytes=Buffer.from([0,255,10,128]);let calls=0;
 const client=new HttpClient({connection:{server:'https://example.com',token:'token'},fetch:async(_input,init)=>{
  calls++;assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer token');
  return new Response(bytes,{headers:{'Content-Type':'application/octet-stream','X-Artifactbin-Account':'usr_one'}});
 }});
 const result=await client.content('/artifacts/abc123/content?version=1');assert.deepEqual(result.bytes,bytes);assert.equal(calls,1);assert.equal(client.account,'usr_one');
});
test('interactive reauthentication retries the same request once and dry-run never opens auth',async()=>{
 let approvals=0;const requests:string[]=[];
 const options={connection:{server:'https://example.com',token:'old'},authenticate:async()=>{approvals++;return{server:'https://example.com',token:'new'};},fetch:async(_input:unknown,init?:RequestInit)=>{
  requests.push(String(init?.body));return new Headers(init?.headers).get('Authorization')==='Bearer old'?Response.json({error:'unauthorized'},{status:401}):Response.json({ok:true});
 }};
 await new HttpClient(options).request('/artifacts','POST',{markup:'<p>Keep</p>'},{'Idempotency-Key':'same-request'});
 assert.equal(approvals,1);assert.equal(requests.length,2);assert.equal(requests[0],requests[1]);
 approvals=0;requests.length=0;await assert.rejects(new HttpClient({...options,readOnly:true}).request('/artifacts/preflight','POST',{}),/auth_required/);assert.equal(approvals,0);assert.equal(requests.length,1);
 const failed=new HttpClient({...options,fetch:async()=>Response.json({error:'unauthorized'},{status:401})});await assert.rejects(failed.request('/artifacts'),/auth_required/);assert.equal(approvals,1);
});
