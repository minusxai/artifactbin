import {createHash} from 'node:crypto';
import {getArtifactById,canReadArtifact} from '@/lib/artifacts';
import {sessionActor,authorHandle} from '@/lib/accounts';
import {getDb} from '@/lib/platform/db';
import {subscribeToArtifact,subscribeChannel} from '@/lib/publish/realtime/live';
import {presenceGeometry} from '@/lib/html-presence/model';
import {createPresenceRoom} from '@/lib/html-presence/room';
import type {PresenceViewer} from '@/lib/html-presence/contract';
// Hash the case-sensitive ID: lower-case SQL-safe channels without merging distinct page rooms.
const channel=(id:string)=>`af_presence_${createHash('sha256').update(id).digest('hex').slice(0,40)}`;
async function access(request:Request,id:string){const row=await getArtifactById(id);const actor=await sessionActor(request);return row?.format==='html'&&await canReadArtifact(row,actor)?{row,actor}:null;}
/** Account authority stays on the platform. A per-tab random secret becomes a public, non-reversible roster ID. */
export async function POST(request:Request,ctx:{params:Promise<{id:string}>}){
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return new Response('forbidden',{status:403});
 const {id}=await ctx.params;const allowed=await access(request,id);if(!allowed)return new Response('not found',{status:404});
 const text=await request.text();if(text.length>6000)return new Response('too large',{status:413});
 let input:Record<string,unknown>;try{input=JSON.parse(text);}catch{return new Response('invalid json',{status:400});}
 if(!input||typeof input.session!=='string'||!/^[a-f0-9-]{36}$/.test(input.session)||input.revision!==String(allowed.row.version))return new Response('invalid presence',{status:400});
 const key=createHash('sha256').update(`${allowed.actor.userId??allowed.actor.tokenId??'guest'}:${input.session}`).digest('hex');
 const entry:PresenceViewer={id:key,label:await authorHandle({actor_user_id:allowed.actor.userId})??'Guest',revision:String(allowed.row.version),seen:Date.now(),...presenceGeometry(input)};
 const db=await getDb();await db.query('SELECT pg_notify($1,$2)',[channel(id),JSON.stringify(input.visible===false?{id:key,gone:true}:entry)]);
 return Response.json({id:key});
}
/** Same ACL and existing Postgres LISTEN/NOTIFY as document live updates; no durable presence table. */
export async function GET(request:Request,ctx:{params:Promise<{id:string}>}){
 const {id}=await ctx.params;const allowed=await access(request,id);if(!allowed)return new Response('not found',{status:404});
 const revision=String(allowed.row.version),encoder=new TextEncoder();
 let room:Awaited<ReturnType<typeof createPresenceRoom>>|undefined,closed=false;
 let controller:ReadableStreamDefaultController<Uint8Array>;
 const close=()=>{if(closed)return;closed=true;room?.dispose();try{controller.close();}catch{}};
 const stream=new ReadableStream<Uint8Array>({start(c){controller=c;},cancel:close});
 try{room=await createPresenceRoom({revision,
  authorize:async()=>{const current=await access(request,id);return !!current&&String(current.row.version)===revision;},
  subscribe:(receive,lost)=>subscribeChannel(channel(id),receive,lost),
  subscribeAcl:(changed,lost)=>subscribeToArtifact(id,changed,lost),
  send:viewers=>{if(!closed&&controller.desiredSize!==null&&controller.desiredSize>0)controller.enqueue(encoder.encode(`data: ${JSON.stringify(viewers)}\n\n`));},
  close,clock:{now:Date.now,setTimeout:(work,ms)=>setTimeout(work,ms),clearTimeout:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>),setInterval:(work,ms)=>setInterval(work,ms),clearInterval:timer=>clearInterval(timer as ReturnType<typeof setInterval>)}
 });}catch{close();return new Response('unavailable',{status:503});}
 if(closed||request.signal.aborted){room.dispose();close();return new Response(null,{status:204});}
 request.signal.addEventListener('abort',close,{once:true});
 return new Response(stream,{headers:{'content-type':'text/event-stream','cache-control':'no-store','x-accel-buffering':'no'}});
}
