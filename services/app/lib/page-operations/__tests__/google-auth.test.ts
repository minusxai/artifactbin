/*
 * api 2 `caps.fetch(url, {auth:{type:'google', secret, scopes}})` against a REAL local fake of Google's token
 * endpoint and a fake Google API (no live Google calls). The fetcher runs under the development policy with the
 * token URL and the Google host allowlist injected; `*.localhost` answers loopback through the app's own lookup.
 */
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {generateKeyPairSync,verify} from 'node:crypto';
import {withHttpServer,type RunningServer} from '@artifactbin/test-support/net';
import {useLoopbackLookup} from '@artifactbin/utils/node/loopback-lookup';
import type {RunnerJson} from '@artifactbin/contracts';
import {createResolverFetch} from '../public-fetch';

const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const pem=privateKey.export({type:'pkcs8',format:'pem'}).toString();
const serviceAccount=(extra:Record<string,string>={})=>JSON.stringify({type:'service_account',project_id:'demo',private_key_id:'kid-1',private_key:pem,client_email:'reader@demo.iam.gserviceaccount.com',client_id:'1',auth_uri:'https://accounts.google.com/o/oauth2/auth',token_uri:'https://attacker.example/token',auth_provider_x509_cert_url:'https://www.googleapis.com/oauth2/v1/certs',client_x509_cert_url:'https://www.googleapis.com/robot/v1/metadata/x509/reader%40demo.iam.gserviceaccount.com',universe_domain:'googleapis.com',...extra});
const KEY=serviceAccount();
const SCOPE='https://www.googleapis.com/auth/spreadsheets.readonly';
const T0=1_800_000_000_000;

interface Seen {host:string;path:string;method:string;authorization?:string;body:string}
const seen:Seen[]=[];
let tokenMode:'ok'|'fail'|'short'='ok';let issued=0;let now=T0;
let server:RunningServer;let tokenUrl='';let sheets='';let other='';
const b64json=(part:string)=>JSON.parse(Buffer.from(part,'base64url').toString());
beforeAll(async()=>{
 useLoopbackLookup();
 server=await withHttpServer((req,res)=>{
  const chunks:Buffer[]=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
   const url=new URL(req.url??'/','http://x');const body=Buffer.concat(chunks).toString();
   const host=String(req.headers.host).split(':')[0]!;
   seen.push({host,path:url.pathname,method:req.method!,body,...(req.headers.authorization?{authorization:req.headers.authorization}:{})});
   if(host==='oauth.localhost'&&url.pathname==='/token'){
    const form=new URLSearchParams(body);
    if(tokenMode==='fail'){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:'invalid_grant',echo:form.get('assertion')}));return;}
    issued++;
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({access_token:`ya29.token-${issued}`,expires_in:tokenMode==='short'?30:3600,token_type:'Bearer'}));return;
   }
   if(url.pathname==='/hop'){res.writeHead(302,{location:'/v4/values'});res.end();return;}
   res.writeHead(200,{'content-type':'application/json','x-echo':String(req.headers.authorization??'')});
   res.end(JSON.stringify({authorization:req.headers.authorization??null,values:[['Name'],['Acme']]}));
  });
 });
 tokenUrl=`http://oauth.localhost:${server.port}/token`;sheets=`http://sheets.localhost:${server.port}`;other=`http://other.localhost:${server.port}`;
});
afterAll(()=>server.close());
beforeEach(()=>{seen.length=0;tokenMode='ok';now=T0;});

const make=()=>createResolverFetch({policy:{allowPrivate:true,allowHttp:true},google:{tokenUrl,hosts:host=>host==='sheets.localhost',now:()=>now}});
type Secrets=Parameters<ReturnType<typeof make>>[1];
const secrets=(over:Partial<Secrets>={},value:string|(()=>string)=KEY):Secrets=>({owner:'owner1',resolver:'backend1',hosts:{GOOGLE_SA:'sheets.localhost',ELSEWHERE:'other.localhost',PLAIN:'sheets.localhost'},read:vi.fn(async(name:string)=>{if(name==='GOOGLE_SA'||name==='ELSEWHERE')return typeof value==='function'?value():value;throw Error('backend_secret_unavailable');}),...over});
const auth=(scopes:unknown=[SCOPE],secret='GOOGLE_SA')=>({type:'google',secret,scopes});
const get=(fetcher:ReturnType<typeof make>,s:Secrets,a:unknown=auth(),path='/v4/values')=>fetcher({url:`${sheets}${path}`,auth:a} as RunnerJson,s);
const code=(p:Promise<unknown>)=>p.then(()=>'resolved',(e:Error&{code?:string})=>e.code??e.message);
const exchanges=()=>seen.filter(r=>r.host==='oauth.localhost');
const bearers=()=>seen.filter(r=>r.host!=='oauth.localhost').map(r=>r.authorization);
const lastAssertion=()=>new URLSearchParams(exchanges().at(-1)!.body).get('assertion')!;
/** Every key, token and JWT form that must never reach resolver code. */
const secretsIn=(value:unknown)=>{
 const text=JSON.stringify(value);const tokens=[...Array(issued+1).keys()].slice(1).map(n=>`ya29.token-${n}`);
 const pemBody=pem.split('\n').filter(l=>l&&!l.startsWith('-----')).join('');
 return [...tokens,KEY,JSON.stringify(KEY).slice(1,-1),pemBody.slice(0,64),...exchanges().map(r=>new URLSearchParams(r.body).get('assertion')!.split('.')[2]!)].filter(f=>text.includes(f));
};

describe('caps.fetch google service-account auth',()=>{
 it('signs an RS256 JWT for the fixed token endpoint and sends the bearer to the bound Google host only',async()=>{
  const fetcher=make();const s=secrets();
  const got=await get(fetcher,s);
  expect(exchanges()).toHaveLength(1);
  const exchange=exchanges()[0]!;
  // The token_uri inside the key (attacker.example) is ignored: only the fixed endpoint is ever asked.
  expect(new Set(seen.map(r=>r.host))).toEqual(new Set(['oauth.localhost','sheets.localhost']));
  expect(exchange).toMatchObject({method:'POST',path:'/token'});expect(exchange.authorization).toBeUndefined();
  const form=new URLSearchParams(exchange.body);
  expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [header,claims,signature]=form.get('assertion')!.split('.') as [string,string,string];
  expect(b64json(header)).toEqual({alg:'RS256',typ:'JWT',kid:'kid-1'});
  expect(b64json(claims)).toEqual({iss:'reader@demo.iam.gserviceaccount.com',scope:SCOPE,aud:tokenUrl,iat:T0/1000,exp:T0/1000+3600});
  expect(verify('sha256',Buffer.from(`${header}.${claims}`),publicKey,Buffer.from(signature,'base64url'))).toBe(true);
  expect(bearers()).toEqual([`Bearer ya29.token-${issued}`]);
  expect(got).toMatchObject({status:200,headers:{'x-echo':'Bearer [redacted]'}});
  expect(JSON.parse(got.body)).toEqual({authorization:'Bearer [redacted]',values:[['Name'],['Acme']]});
  expect(got.receipt).toMatchObject({method:'GET',host:'sheets.localhost',path:'/v4/values',secrets:['GOOGLE_SA']});
  expect(secretsIn(got)).toEqual([]);
 });
 it('caches the token per owner, resolver, secret, key and scope set until shortly before expiry',async()=>{
  const fetcher=make();
  await get(fetcher,secrets());await get(fetcher,secrets());
  await Promise.all([get(fetcher,secrets({resolver:'backend9'})),get(fetcher,secrets({resolver:'backend9'}))]);
  expect(exchanges()).toHaveLength(2);
  const [first,,third]=bearers();expect(bearers()[1]).toBe(first);expect(third).not.toBe(first);
  // Scope sets are normalised (order, duplicates), and a different set is a different token.
  await get(fetcher,secrets(),auth([SCOPE,SCOPE]));expect(exchanges()).toHaveLength(2);
  await get(fetcher,secrets(),auth(['https://www.googleapis.com/auth/drive.readonly',SCOPE]));
  await get(fetcher,secrets(),auth([SCOPE,'https://www.googleapis.com/auth/drive.readonly']));
  expect(exchanges()).toHaveLength(3);expect(b64json(lastAssertion().split('.')[1]!).scope).toBe(`https://www.googleapis.com/auth/drive.readonly ${SCOPE}`);
  // Never shared across owners, even for the same resolver, secret name, key and scopes.
  await get(fetcher,secrets({owner:'owner2'}));expect(exchanges()).toHaveLength(4);
  expect(bearers().at(-1)).not.toBe(first);
  // A rotated key never reuses a token minted from the old one.
  await get(fetcher,secrets({},serviceAccount({private_key_id:'kid-2'})));expect(exchanges()).toHaveLength(5);
  // Expiry: reused just inside the refresh margin, re-minted once inside it.
  now=T0+3600_000-61_000;await get(fetcher,secrets());expect(exchanges()).toHaveLength(5);expect(bearers().at(-1)).toBe(first);
  now=T0+3600_000-59_000;await get(fetcher,secrets());expect(exchanges()).toHaveLength(6);expect(bearers().at(-1)).not.toBe(first);
  expect(b64json(lastAssertion().split('.')[1]!)).toMatchObject({iat:Math.floor(now/1000),exp:Math.floor(now/1000)+3600});
 });
 it('does not cache a token whose lifetime is inside the margin, a failed exchange, or a deleted secret',async()=>{
  const fetcher=make();
  tokenMode='short';await get(fetcher,secrets());await get(fetcher,secrets());expect(exchanges()).toHaveLength(2);
  tokenMode='fail';
  const failed=await get(fetcher,secrets({resolver:'b2'})).catch((e:Error&{code?:string})=>e);
  expect((failed as {code:string}).code).toBe('auth_failed');
  expect(secretsIn({message:(failed as Error).message,stack:(failed as Error).stack})).toEqual([]);
  tokenMode='ok';await get(fetcher,secrets({resolver:'b2'}));expect(exchanges()).toHaveLength(4);
  const removed=secrets({resolver:'b2',read:vi.fn(async()=>{throw Error('backend_secret_unavailable');})});
  expect(await code(get(fetcher,removed))).toBe('secret_unavailable');expect(exchanges()).toHaveLength(4);
 });
 it('refuses undeclared secrets, hosts outside the binding or the Google allowlist and malformed auth before reading or connecting',async()=>{
  const fetcher=make();const s=secrets();
  expect(await code(get(fetcher,s,auth([SCOPE],'NOPE')))).toBe('unknown_secret');
  expect(await code(fetcher({url:`${other}/v4/values`,auth:auth()} as RunnerJson,s))).toBe('secret_host_forbidden');
  expect(await code(fetcher({url:`${other}/v4/values`,auth:auth([SCOPE],'ELSEWHERE')} as RunnerJson,s))).toBe('secret_host_forbidden');
  expect(await code(fetcher({url:`${sheets}/v4/values`,headers:{Authorization:'Bearer mine'},auth:auth()} as RunnerJson,s))).toBe('invalid_request');
  for(const bad of [null,'google',{type:'aws',secret:'GOOGLE_SA',scopes:[SCOPE]},{type:'google',secret:'GOOGLE_SA'},auth([]),auth([1]),auth(['a b']),auth(['']),auth([SCOPE],'lower'),{...auth(),extra:1},auth(Array.from({length:33},(_,i)=>`${SCOPE}${i}`))])
   expect(await code(get(fetcher,s,bad)),JSON.stringify(bad)).toBe('invalid_request');
  expect(seen).toEqual([]);expect(s.read).not.toHaveBeenCalled();
  // Production default: only *.googleapis.com receives a Google bearer, whatever the binding says.
  const strictHosts=createResolverFetch({policy:{allowPrivate:true,allowHttp:true},google:{tokenUrl}});
  expect(await code(get(strictHosts,s))).toBe('secret_host_forbidden');
  expect(seen).toEqual([]);expect(s.read).not.toHaveBeenCalled();
 });
 it('refuses a value that is not a service-account key, and never follows a redirect with a bearer',async()=>{
  const fetcher=make();
  for(const value of ['not json',JSON.stringify({client_email:'x@y'}),serviceAccount({private_key:'-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n'})])
   expect(await code(get(fetcher,secrets({},value))),value.slice(0,20)).toBe('auth_key_invalid');
  expect(seen).toEqual([]);
  const hop=await get(fetcher,secrets(),auth(),'/hop');
  expect(hop).toMatchObject({status:302,headers:{location:'/v4/values'}});expect(bearers()).toEqual([`Bearer ya29.token-${issued}`]);
 });
 it('a realistic service-account key fits the 4 KiB secret value cap',()=>{
  expect(Buffer.byteLength(KEY)).toBeLessThanOrEqual(4096);
 });
});
