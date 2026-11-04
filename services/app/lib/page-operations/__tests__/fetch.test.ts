import {it,expect,vi} from 'vitest';

/*
 * `caps.fetch` against a REAL local server. The strict export refuses loopback by design, so the wire
 * tests use an instance under the development policy (private and http admitted, link-local never), and
 * `*.localhost` answers loopback through the app's own lookup. The production export is asserted separately.
 */
import {afterAll,beforeAll,describe} from 'vitest';
import {withHttpServer,type RunningServer} from '@artifactbin/test-support/net';
import {useLoopbackLookup} from '@artifactbin/utils/node/loopback-lookup';
import {RESOLVER_LIMITS,type RunnerJson} from '@artifactbin/contracts';
import {createResolverFetch,fetchResolverResource,secretHostAllows} from '../public-fetch';
const KEY='s3cr3t/+&value';
const forms=[KEY,encodeURIComponent(KEY),Buffer.from(KEY).toString('base64'),Buffer.from(KEY).toString('base64url')];
const hosts={KEY:'api.localhost',ELSEWHERE:'other.example.com'};
let server:RunningServer;let base='';let other='';
const seen:{method:string;url:string;headers:Record<string,string|string[]|undefined>;body:string}[]=[];
beforeAll(async()=>{
 useLoopbackLookup();
 server=await withHttpServer((req,res)=>{
  const chunks:Buffer[]=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
   const url=new URL(req.url??'/','http://x');const body=Buffer.concat(chunks).toString();
   seen.push({method:req.method!,url:req.url!,headers:req.headers,body});
   const echo=JSON.stringify({method:req.method,url:req.url,authorization:req.headers.authorization??null,body});
   switch(url.pathname){
    case '/echo':res.writeHead(200,{'content-type':'application/json','x-echo':String(req.headers.authorization??''),'set-cookie':'session=1'});res.end(req.method==='HEAD'?undefined:echo);return;
    case '/encoded':res.writeHead(200,{'content-type':'text/plain'});res.end(forms.join(' | '));return;
    case '/missing':res.writeHead(404,{'content-type':'text/plain'});res.end('no such deal');return;
    case '/hop':res.writeHead(302,{location:'/echo?hopped=1'});res.end();return;
    case '/loop':res.writeHead(302,{location:'/loop'});res.end();return;
    case '/metadata':res.writeHead(302,{location:'http://169.254.169.254/latest'});res.end();return;
    case '/fits':res.writeHead(200);res.end('x'.repeat(RESOLVER_LIMITS.fetchResponseBytes));return;
    case '/big':res.writeHead(200);res.end('x'.repeat(RESOLVER_LIMITS.fetchResponseBytes+1));return;
    case '/hang':return;
    default:res.writeHead(500);res.end();
   }
  });
 });
 base=`http://api.localhost:${server.port}`;other=`http://other.localhost:${server.port}`;
});
afterAll(()=>server.close());
const lax=createResolverFetch({policy:{allowPrivate:true,allowHttp:true}});
const secrets=(read=vi.fn(async(name:string)=>{if(name==='KEY')return KEY;throw Error('backend_secret_unavailable');}))=>({owner:'owner1',resolver:'backend1',hosts,read});
const code=(p:Promise<unknown>)=>p.then(()=>'resolved',(e:Error&{code?:string})=>e.code??e.message);
const leaks=(value:unknown)=>forms.filter(form=>JSON.stringify(value).includes(form)||JSON.stringify(value).includes(JSON.stringify(form).slice(1,-1)));
describe('caps.fetch',()=>{
 it('sends method, headers and body, and fills declared placeholders on the bound host only',async()=>{
  seen.length=0;
  const got=await lax({url:`${base}/echo?key={{KEY}}`,method:'POST',headers:{Authorization:'Bearer {{KEY}}','content-type':'application/json'},body:'{"token":"{{KEY}}","template":"{{lower}}"}'},secrets());
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({method:'POST',url:`/echo?key=${encodeURIComponent(KEY)}`,body:`{"token":"${KEY}","template":"{{lower}}"}`});
  expect(seen[0]!.headers).toMatchObject({authorization:`Bearer ${KEY}`,'content-type':'application/json','accept-encoding':'identity'});
  expect(got.status).toBe(200);expect(leaks(got)).toEqual([]);
  expect(got.body).toContain('[redacted]');expect(got.headers['x-echo']).toBe('Bearer [redacted]');expect(got.url).not.toContain(encodeURIComponent(KEY));
  expect(got.headers['set-cookie']).toBeUndefined();expect(got.headers['content-type']).toBe('application/json');
  expect(got.receipt).toEqual({method:'POST',host:'api.localhost',path:'/echo',bytesIn:Buffer.byteLength(JSON.stringify({method:'POST',url:seen[0]!.url,authorization:`Bearer ${KEY}`,body:seen[0]!.body})),bytesOut:Buffer.byteLength(seen[0]!.body),secrets:['KEY']});
 });
 it('refuses undeclared names and hosts outside a secret binding before connecting or reading a value',async()=>{
  seen.length=0;const s=secrets();
  expect(await code(lax({url:`${base}/echo`,headers:{authorization:'{{NOPE}}'}},s))).toBe('unknown_secret');
  expect(await code(lax({url:`${other}/echo?k={{KEY}}`},s))).toBe('secret_host_forbidden');
  expect(await code(lax({url:`${base}/echo`,method:'POST',body:'{{ELSEWHERE}}'},s))).toBe('secret_host_forbidden');
  expect(await code(lax({url:`http://{{KEY}}.localhost:${server.port}/echo`},s))).toBe('secret_host_forbidden');
  expect(await code(lax({url:`http://u:{{KEY}}@api.localhost:${server.port}/echo`},s))).toBe('secret_host_forbidden');
  // A database connection is never a fetch secret, even to a host literally named "postgres".
  expect(await code(lax({url:`${base}/echo`,headers:{authorization:'{{WAREHOUSE}}'}},{...s,hosts:{...hosts,WAREHOUSE:'postgres'}}))).toBe('secret_host_forbidden');
  expect(await code(lax({url:`http://postgres/echo?p={{WAREHOUSE}}`},{...s,hosts:{...hosts,WAREHOUSE:'postgres'}}))).toBe('secret_host_forbidden');
  // Every database kind, MySQL too.
  expect(await code(lax({url:`${base}/echo`,headers:{authorization:'{{SHOP}}'}},{...s,hosts:{...hosts,SHOP:'mysql'}}))).toBe('secret_host_forbidden');
  expect(await code(lax({url:`http://mysql/echo?p={{SHOP}}`},{...s,hosts:{...hosts,SHOP:'mysql'}}))).toBe('secret_host_forbidden');
  expect(seen).toEqual([]);expect(s.read).not.toHaveBeenCalled();
  expect(await code(lax({url:`${base}/echo`,headers:{authorization:'{{ELSEWHERE}}'}},{...s,hosts:{...hosts,ELSEWHERE:'api.localhost'}}))).toBe('secret_unavailable');
  expect(seen).toEqual([]);
 });
 it('matches exact hosts and any subdomain under one leading wildcard, never the apex',()=>{
  expect(secretHostAllows('api.example.com','api.example.com')).toBe(true);
  expect(secretHostAllows('api.example.com','x.api.example.com')).toBe(false);
  expect(secretHostAllows('*.snowflakecomputing.com','ab123.us-east-2.aws.snowflakecomputing.com')).toBe(true);
  expect(secretHostAllows('*.snowflakecomputing.com','snowflakecomputing.com')).toBe(false);
  expect(secretHostAllows('*.snowflakecomputing.com','evilsnowflakecomputing.com')).toBe(false);
  expect(secretHostAllows('api.example.com','api.example.com.')).toBe(false);
 });
 it('returns every status with its body, and HEAD with none',async()=>{
  expect(await lax({url:`${base}/missing`},secrets())).toMatchObject({status:404,body:'no such deal'});
  expect(await lax({url:`${base}/echo`,method:'HEAD'},secrets())).toMatchObject({status:200,body:''});
 });
 it('follows at most three redirects, only for GET or HEAD without secrets, guarding every hop',async()=>{
  expect(await lax({url:`${base}/hop`},secrets())).toMatchObject({status:200,url:`${base}/echo?hopped=1`});
  const kept=await lax({url:`${base}/hop?k={{KEY}}`},secrets());expect(kept).toMatchObject({status:302,headers:{location:'/echo?hopped=1'}});
  expect(await lax({url:`${base}/hop`,method:'POST',body:'x'},secrets())).toMatchObject({status:302});
  expect(await code(lax({url:`${base}/loop`},secrets()))).toBe('too_many_redirects');
  expect(await code(lax({url:`${base}/metadata`},secrets()))).toBe('forbidden_address');
 });
 it('redacts the value, its URL-encoded and base64 forms from the body, headers and URL',async()=>{
  const got=await lax({url:`${base}/encoded?k={{KEY}}`},secrets());
  expect(got.body).toBe('[redacted] | [redacted] | [redacted] | [redacted]');expect(leaks(got)).toEqual([]);
  expect(got.receipt).toMatchObject({path:'/encoded',secrets:['KEY']});expect(JSON.stringify(got.receipt)).not.toContain('k=');
 });
 it('validates the request: methods, forbidden headers, body cap, unknown options and malformed google auth',async()=>{
  seen.length=0;const s=secrets();
  for(const name of ['host','Cookie','content-length','transfer-encoding','connection','proxy-authorization','te','upgrade'])expect(await code(lax({url:`${base}/echo`,headers:{[name]:'x'}},s)),name).toBe('invalid_request');
  expect(await code(lax({url:`${base}/echo`,method:'CONNECT'},s))).toBe('invalid_request');
  expect(await code(lax({url:`${base}/echo`,body:'x'},s))).toBe('invalid_request');
  expect(await code(lax({url:`${base}/echo`,method:'POST',body:'x'.repeat(RESOLVER_LIMITS.fetchRequestBodyBytes+1)},s))).toBe('request_limit');
  expect(await code(lax({url:`${base}/echo`,cache:'no-store'} as unknown as RunnerJson,s))).toBe('invalid_request');
  // Plan PR 4 replaced the blanket `auth_unavailable` refusal; google-auth.test.ts covers the helper itself.
  expect(await code(lax({url:`${base}/echo`,auth:{type:'google',secret:'KEY',scopes:[]}},s))).toBe('invalid_request');
  expect(seen).toEqual([]);
  await lax({url:`${base}/echo`,method:'POST',body:'x'.repeat(RESOLVER_LIMITS.fetchRequestBodyBytes)},s);expect(seen).toHaveLength(1);
 });
 it('caps the response at 2 MiB and the whole fetch at its deadline',async()=>{
  expect((await lax({url:`${base}/fits`},secrets())).body).toHaveLength(RESOLVER_LIMITS.fetchResponseBytes);
  expect(await code(lax({url:`${base}/big`},secrets()))).toBe('response_limit');
  const quick=createResolverFetch({policy:{allowPrivate:true,allowHttp:true},timeoutMs:300});
  expect(await code(quick({url:`${base}/hang`},secrets()))).toBe('timeout');
 });
 it('never puts a filled value into an error',async()=>{
  const closed=`http://api.localhost:1/echo?k={{KEY}}`;
  const error=await lax({url:closed},secrets()).catch((e:Error)=>e);
  expect(error).toBeInstanceOf(Error);expect(leaks({message:(error as Error).message,stack:(error as Error).stack})).toEqual([]);
 });
 it('production policy: https on 443 to public addresses only',async()=>{
  seen.length=0;
  for(const url of [`${base}/echo`,'https://api.localhost/echo','https://127.0.0.1/','https://169.254.169.254/latest','https://[::1]/','https://10.0.0.1/','https://u:p@example.com/','https://example.com:8443/'])expect(await code(fetchResolverResource({url},secrets())),url).toMatch(/^(forbidden_scheme|forbidden_address|invalid_url)$/);
  expect(seen).toEqual([]);
 });
});
