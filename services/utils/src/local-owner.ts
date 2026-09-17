import {createHmac,randomBytes} from 'node:crypto';
import {ANONYMOUS,type Actor,type Upstream} from '@artifactbin/contracts';
import {signActor,verifyActor} from './actor-sign';

/** Loopback-only identity. The app continues to own token validity and artifact permissions. */
export interface LocalOwnerOptions {
 origin:string;
 instanceId:string;
 ownerId:string;
 cookieSecret:string;
 upstream:Upstream;
 resolveBearer:(token:string)=>Promise<Actor|null>;
 now?:()=>number;
}
export interface LocalOwner {
 fetch:(request:Request)=>Promise<Response>;
}
/** A single managed owner; never install this adapter on an externally reachable listener. */
export function localOwner(options:LocalOwnerOptions):LocalOwner {
 const origin=new URL(options.origin);
 if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||origin.origin!==options.origin)throw new Error('Local owner requires an HTTP loopback origin.');
 if(!/^[A-Za-z0-9_-]+$/.test(options.instanceId)||options.cookieSecret.length<32)throw new Error('Invalid local owner identity.');
 const now=options.now??Date.now;
 const cookieName=`afbin_self_${options.instanceId}`;
 // Reuse the shared signed actor implementation with a domain-separated, instance/origin-bound key.
 const key=createHmac('sha256',options.cookieSecret).update(JSON.stringify(['self-browser',options.instanceId,options.origin])).digest('hex');
 const owner:Actor={credential:'session',userId:options.ownerId};
 const tickets=new Map<string,{destination:string;expires:number}>();
 const json=(status:number,value:unknown)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
 async function bearer(request:Request):Promise<Actor|null>{
  const offered=request.headers.get('authorization');
  if(!offered?.startsWith('Bearer '))return null;
  const actor=await options.resolveBearer(offered.slice(7));
  if(actor?.credential!=='bearer'||actor.userId!==options.ownerId)return null;
  // An optional local display email is never a verified identity or an administrator claim.
  return {credential:'bearer',userId:options.ownerId,...(actor.tokenId?{tokenId:actor.tokenId}:{})};
 }
 return {fetch:async request=>{
  const url=new URL(request.url);
  if(url.origin!==options.origin)return json(421,{error:'wrong_self_origin'});
  const actor=await bearer(request);
  if(url.pathname==='/_afbin/browser-ticket'){
   if(request.method!=='POST')return json(405,{error:'method_not_allowed'});
   if(!actor)return json(401,{error:'auth_required'});
   let destination:unknown;
   try{destination=JSON.parse(await smallBody(request)).destination;}catch{return json(400,{error:'invalid_destination'});}
   if(typeof destination!=='string'||!destination.startsWith('/')||destination.startsWith('//')||/[\\#\r\n]/.test(destination)||new URL(destination,options.origin).origin!==options.origin)return json(400,{error:'invalid_destination'});
   for(const [id,ticket] of tickets)if(ticket.expires<=now())tickets.delete(id);
   if(tickets.size>=128)return json(429,{error:'too_many_tickets'});
   const ticket=randomBytes(32).toString('base64url');tickets.set(ticket,{destination,expires:now()+60000});
   return json(200,{ticket,expiresIn:60});
  }
  if(url.pathname==='/_afbin/browser-ticket/status'){
   if(request.method!=='POST')return json(405,{error:'method_not_allowed'});
   if(!actor)return json(401,{error:'auth_required'});
   let ticket:unknown;try{ticket=JSON.parse(await smallBody(request)).ticket;}catch{return json(400,{error:'invalid_ticket'});}
   const issued=typeof ticket==='string'?tickets.get(ticket):undefined;
   return json(200,{pending:!!issued&&issued.expires>now()});
  }
  if(url.pathname==='/_afbin/browser-login'){
   if(request.method!=='POST'||url.search)return json(405,{error:'method_not_allowed'});
   const from=request.headers.get('origin');
   if(from&&from!=='null'&&from!==options.origin)return json(403,{error:'invalid_origin'});
   let ticket:string;
   try{ticket=new URLSearchParams(await smallBody(request)).get('ticket')??'';}catch{return json(400,{error:'invalid_ticket'});}
   const issued=tickets.get(ticket);tickets.delete(ticket);
   if(!issued||issued.expires<=now())return json(401,{error:'expired_ticket'});
   return new Response(null,{status:303,headers:{location:issued.destination,'cache-control':'no-store',
    'set-cookie':`${cookieName}=${signActor(owner,key,{now:now(),ttlSeconds:86400})}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`}});
  }
  // Explicit invalid bearer credentials never borrow a browser's authority.
  if(request.headers.has('authorization'))return options.upstream(request,actor??ANONYMOUS);
  const cookie=(request.headers.get('cookie')??'').split(';').map(part=>part.trim()).find(part=>part.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  const session=verifyActor(cookie,key,{now:now()});
  return options.upstream(request,session?.credential==='session'&&session.userId===options.ownerId?owner:ANONYMOUS);
 }};
}

/** Bootstrap requests contain only a destination or a ticket, never an unbounded upload. */
async function smallBody(request:Request):Promise<string>{
 const reader=request.body?.getReader();if(!reader)return '';
 const chunks:Uint8Array[]=[];let length=0;
 try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>4096)throw new Error('Request too large');chunks.push(part.value);}}
 finally{await reader.cancel();reader.releaseLock();}
 return Buffer.concat(chunks).toString('utf8');
}
