/** Loopback-only browser fixture for the PROPOSED cookie split. Not production auth. */
import {createServer} from 'node:https';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {boundary,singleCookie,safeReturn} from './auth-boundary.mjs';
const scratch=mkdtempSync(join(tmpdir(),'afbin-auth-boundary-'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=127.0.0.1.nip.io','-keyout',join(scratch,'key.pem'),'-out',join(scratch,'cert.pem')],{stdio:'ignore'});
const credential=()=>randomBytes(24).toString('hex');
const full=credential(),read=credential();
const session={id:credential(),user:'fixture-viewer',csrf:credential(),active:true};
const manifest={doc:'doc1',revision:'hash1',target:'ds1',operation:'insert'};
let main,trusted,authorize,approved=null,writes=0;
const observations=[];
const script=body=>`<!doctype html><title>Auth boundary planning fixture</title><pre id="result">Running</pre><script>${body}</script>`;
const server=createServer({key:readFileSync(join(scratch,'key.pem')),cert:readFileSync(join(scratch,'cert.pem'))},async(req,res)=>{
 const origin=`https://${req.headers.host}`,url=new URL(req.url,origin);
 const isTrusted=origin===trusted,isMain=origin===main;
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(!isTrusted&&!isMain){res.writeHead(421);return res.end();}
 const hasFull=singleCookie(req.headers.cookie,'__Host-plan-session')===full;
 const hasRead=singleCookie(req.headers.cookie,'plan-read')===read;
 const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(url.pathname==='/issue'&&isTrusted){
  // Test-only credential issuer: this does NOT validate OTP/OAuth/provider integration.
  session.active=true;approved=null;
  res.setHeader('Set-Cookie',[
   `__Host-plan-session=${full}; Secure; HttpOnly; SameSite=Lax; Path=/`,
   `plan-read=${read}; Secure; HttpOnly; SameSite=Lax; Path=/; Domain=127.0.0.1.nip.io`,
  ]);
  res.setHeader('Content-Security-Policy',"frame-ancestors 'none'");
  res.writeHead(302,{Location:main+'/'});return res.end();
 }
 if(url.pathname==='/private'&&isMain) return reply(hasRead&&session.active?200:404,{private:hasRead&&session.active});
 if(url.pathname==='/report') return reply(200,{writes,observations});
 if(url.pathname==='/write'){
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096){req.destroy();return;}}
  let body;try{body=JSON.parse(raw);}catch{body={};}
  const status=authorize({host:origin,origin:req.headers.origin,method:req.method,contentType:req.headers['content-type'],csrf:req.headers['x-plan-csrf'],session:hasFull?session:null,manifest,approved,acl:true,requestId:body.requestId});
  if(status===200)writes++;
  observations.push({kind:'write',origin:req.headers.origin??null,host:origin,status,hasFull,hasRead});
  return reply(status,{status});
 }
 if(url.pathname==='/logout'&&isTrusted){
  if(!hasFull||req.headers.origin!==trusted||req.headers['x-plan-csrf']!==session.csrf)return reply(403,{});
  session.active=false;return reply(200,{});
 }
 if(url.pathname==='/controls'&&isTrusted){
  res.setHeader('Content-Security-Policy',`frame-ancestors ${main}; default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'`);
  res.setHeader('Content-Type','text/html');
  if(!hasFull||!session.active){res.writeHead(401);return res.end('No session');}
  // Consent is fixture-seeded ONLY here; production must show trusted approval UI.
  approved={...manifest,user:session.user,session:session.id};
  return res.end(script(`(async()=>{
   const send=id=>fetch('/write',{method:'POST',headers:{'Content-Type':'application/json','X-Plan-CSRF':${JSON.stringify(session.csrf)}},body:JSON.stringify({requestId:id})}).then(r=>r.status);
   let dom;try{parent.document.body;dom='ESCAPED'}catch(e){dom=e.name}
   const success=await send(1),replay=await send(1);
   window.logout=()=>fetch('/logout',{method:'POST',headers:{'X-Plan-CSRF':${JSON.stringify(session.csrf)}}});
   document.querySelector('#result').textContent=JSON.stringify({success,replay,dom,cookieVisible:document.cookie.includes('plan-')});
  })()`));
 }
 if(url.pathname==='/tokens'&&isTrusted){res.setHeader('Content-Security-Policy',"frame-ancestors 'none'");res.setHeader('Content-Type','text/html');return res.end('<h1>Trusted token fixture — must not frame</h1>');}
 if(url.pathname==='/'&&isMain){
  observations.push({kind:'main-cookie',hasFull,hasRead});
  res.setHeader('Content-Type','text/html');
  return res.end(script(`(async()=>{
   const privateStatus=await fetch('/private').then(r=>r.status);
   let crossOrigin;try{await fetch(${JSON.stringify(trusted+'/write')},{method:'POST',credentials:'include',headers:{'Content-Type':'text/plain'},body:'{}'});crossOrigin='readable'}catch(e){crossOrigin=e.name}
   const rootStatus=await fetch('/write',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.status);
   document.querySelector('#result').textContent=JSON.stringify({privateStatus,crossOrigin,rootStatus,cookieVisible:document.cookie.includes('plan-')});
  })()`)+`<iframe title="Trusted policy fixture" src="${trusted}/controls"></iframe><iframe title="Forbidden token frame" src="${trusted}/tokens"></iframe>`);
 }
 if(url.pathname==='/return'){const to=safeReturn(url.searchParams.get('to'),main);return reply(to?200:400,{to});}
 reply(404,{});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
main=`https://127.0.0.1.nip.io:${server.address().port}`;trusted=`https://i.127.0.0.1.nip.io:${server.address().port}`;authorize=boundary(trusted);
console.log(JSON.stringify({main,trusted,start:trusted+'/issue'}));
async function stop(){await new Promise(resolve=>server.close(resolve));rmSync(scratch,{recursive:true,force:true});process.exit(0);}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
