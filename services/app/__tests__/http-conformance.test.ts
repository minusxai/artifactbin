import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createTeamApplication} from '../server/team-application';
import {AUTH_SECRET} from '@/lib/platform';
import {useAppHarness} from './harness';
import {drainPreparedPageWarmups} from '@/lib/story/prepared/prepared-page.server';
import {drainSnapshotRevalidations} from '@/lib/compiled-page/snapshots.server';
import {expect,it} from 'vitest';
import {checkDirectHttp,checkGuestHttpIssuance} from '../../../scripts/gates/lib/http-conformance.mjs';
useAppHarness();
const base='https://example.test';
const json=(body:unknown,status=200,headers:Record<string,string>={})=>Response.json(body,{status,headers});
const npmNotice=(helperBase:string)=>({message:'afbin now installs through npm. Run once: npx --yes @afbin/cli@latest setup — then use afbin as before.',hint:`Windows PowerShell: npx.cmd --yes @afbin/cli@latest setup. If Node.js 22+ is missing, run ${helperBase}/chat/install-node.sh (macOS/Linux) or ${helperBase}/chat/install-node.ps1 (Windows) first. Your files, account and skills stay.`});
const legacyNotice=(helperBase:string)=>({message:'afbin now runs through npm',hint:`Node/npm setup: ${helperBase}/chat/install-node.sh (macOS/Linux), ${helperBase}/chat/install-node.ps1 (Windows). npx --yes @afbin/cli@latest <command>; npx.cmd`});
function host({cache='no-store',mutates=false,filename='Report.jsx.html',helperBase=base,legacyCopy=false}={}){
 let rows=[{region:'EU',amount:2}],version=1;
 const calls:Array<{path:string;init:RequestInit}>=[];
 const fetch=async(input:string,init:RequestInit={})=>{
  const path=new URL(input).pathname;calls.push({path,init});
  if(path==='/api/authentication/token')return json({id:'tok_test',access_token:'mx_test_http',token_type:'Bearer',expires_in:3600,scope:'artifacts'},201,{'Cache-Control':cache});
  if(path==='/api/my/tokens/tok_test')return new Response(null,{status:204});
  if(path==='/a/doc123/download')return new Response('<!doctype html><script id="afbin-file">{}</script>',{headers:{'Content-Type':'text/html','Content-Disposition':`attachment; filename="${filename}"`}});
  expect(new Headers(init.headers).get('authorization')).toBe('Bearer mx_test_http');
  if(path==='/api/artifacts')return json({id:'csv123'},201);
  if(path.endsWith('/content'))return json(rows);
  if(init.method==='PUT'){
   if(new Headers(init.headers).get('user-agent')==='afbin/0.3.21'){
    if(mutates)rows=[{region:'EU',amount:999}];
    return json({error:'cli_npm_required',...(legacyCopy?legacyNotice:npmNotice)(helperBase)},426);
   }
   const body=JSON.parse(String(init.body));expect(body.expectedVersion).toBe(version);expect(body.expectedState).toBe('head'+version);
   rows=[{region:'EU',amount:20}];version++;return json({id:'csv123',version,state:'head'+version});
  }
  return json({id:'csv123',version,state:'head'+version,format:'dataset'});
 };
 return{fetch,calls};
}
it('direct acceptance exercises email bearer CSV read/write, filename, no-op native refusal, and revocation',async()=>{
 const fake=host();const ids:string[]=[];
 await checkDirectHttp({base,fetch:fake.fetch,accountCookie:'email=session',artifactId:'doc123',stamp:'unit',onArtifact:(id:string)=>ids.push(id)});
 expect(ids).toEqual(['csv123']);expect(fake.calls.at(-1)?.path).toBe('/api/my/tokens/tok_test');
});
it('guest issuance acceptance refuses a minted credential and requires no-store on refusal',async()=>{
 await checkGuestHttpIssuance({base,guestCookie:'guest=session',fetch:async()=>json({error:'email_auth_required'},401,{'Cache-Control':'no-store'})});
 await expect(checkGuestHttpIssuance({base,guestCookie:'guest=session',fetch:async()=>json({access_token:'mx_test_guest'},201)})).rejects.toThrow();
});
it.each([{cache:'public'},{mutates:true},{filename:'Report.html'},{helperBase:'http://artifactbin-app:3000'},{helperBase:'https://wrong-public.example'},{legacyCopy:true}])('acceptance catches a broken release contract %j',async options=>{
 const fake=host(options);
 await expect(checkDirectHttp({base,fetch:fake.fetch,accountCookie:'email=session',artifactId:'doc123',stamp:'unit',onArtifact:()=>{}})).rejects.toThrow();
});

it('acceptance runs against real composed email, artifact and download handlers',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'http-conformance-')),origin='http://localhost:3000';
 const application=await createTeamApplication({APP__PUBLIC_BASE_URL:origin,AUTH__SECRET:AUTH_SECRET,EMAIL__DEV_OUTBOX_PATH:join(directory,'outbox.jsonl')},process.cwd());
 const fetch=(input:string,init:RequestInit={})=>application.fetch(new Request(input,init));
 const post=(path:string,body:unknown,headers:Record<string,string>={})=>fetch(origin+path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)});
 try{
  const pairing=await(await post('/oauth/device',{})).json();
  const approved=await fetch(origin+'/oauth/device/approve',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({user_code:pairing.user_code,decision:'anonymous'})});
  expect(approved.status).toBe(401);
  const guestCookie=approved.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  await checkGuestHttpIssuance({base:origin,fetch,guestCookie});
  const email='mxmx_test_http_conformance@example.test';
  expect((await post('/api/auth/email-otp/send-verification-otp',{email,type:'sign-in'})).status).toBe(200);
  const mail=(await readFile(join(directory,'outbox.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const login=await post('/api/auth/sign-in/email-otp',{email,otp:mail.find(message=>message.to===email).otp});expect(login.status).toBe(200);
  const accountCookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const issued=await post('/api/authentication/token',{}, {cookie:accountCookie});expect(issued.status).toBe(201);
  const token=await issued.json();
  const created=await post('/api/artifacts',{markup:'<h1>Release acceptance</h1>',title:'Release acceptance',visibility:'private'},{authorization:'Bearer '+token.access_token});expect(created.status).toBe(201);
  const ids:string[]=[];
  await checkDirectHttp({base:origin,fetch,accountCookie,artifactId:(await created.json()).id,stamp:'real',onArtifact:(id:string)=>ids.push(id)});
  expect(ids).toHaveLength(1);
  const retired=await fetch(origin+'/api/artifacts',{headers:{authorization:'Bearer '+token.access_token,'user-agent':'afbin/0.3.21'}});
  expect(retired.status).toBe(426);
  const notice=await retired.json();
  expect(notice.error).toBe('cli_npm_required');
  expect(notice.message.startsWith('afbin now installs through npm. Run once: npx --yes @afbin/cli@latest setup')).toBe(true);
  expect(notice.hint).toContain(`${origin}/chat/install-node.sh`);
  expect((await fetch(origin+'/api/my/tokens/'+token.id,{method:'DELETE',headers:{cookie:accountCookie,origin}})).status).toBe(204);
 }finally{await drainPreparedPageWarmups();await drainSnapshotRevalidations();await application.close();await rm(directory,{recursive:true,force:true});}
});
