import {createHash} from 'node:crypto';
import {getArtifactById,canReadArtifact} from '@/lib/artifacts';
import {sessionActor,authorHandle} from '@/lib/accounts';
import {getDb} from '@/lib/platform/db';
import {subscribeChannel} from '@/lib/publish/realtime/live';
import {presenceGeometry,presenceRoster} from '@/lib/html-presence/model';
import type {PresenceViewer} from '@/lib/html-presence/contract';
const channel=(id:string)=>`af_presence_${id}`;
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
 const revision=String(allowed.row.version),entries=new Map<string,PresenceViewer>(),encoder=new TextEncoder();
 let closed=false,drop:(()=>Promise<void>)|undefined,timer:ReturnType<typeof setInterval>|undefined;
 let controller:ReadableStreamDefaultController<Uint8Array>;
 const close=()=>{if(closed)return;closed=true;if(timer)clearInterval(timer);void drop?.();try{controller.close();}catch{}};
 const send=async()=>{if(closed)return;const current=await access(request,id);if(closed)return;if(!current||String(current.row.version)!==revision)return close();const roster=presenceRoster([...entries.values()],revision,Date.now());entries.clear();for(const entry of roster)entries.set(entry.id,entry);controller.enqueue(encoder.encode(`data: ${JSON.stringify(roster)}\n\n`));};
 const stream=new ReadableStream<Uint8Array>({start(c){controller=c;},cancel:close});
 try{drop=await subscribeChannel(channel(id),payload=>{try{const entry=JSON.parse(payload) as PresenceViewer&{gone?:boolean};if(!/^[a-f0-9]{64}$/.test(entry.id))return;if(entry.gone)entries.delete(entry.id);else if(entry.revision===revision&&typeof entry.label==='string'&&entry.label.length<=100&&Number.isFinite(entry.seen)){entries.set(entry.id,{id:entry.id,label:entry.label,revision,seen:entry.seen,...presenceGeometry(entry)});if(entries.size>100)entries.delete(entries.keys().next().value!);}void send().catch(close);}catch{}},close);}catch{close();return new Response('unavailable',{status:503});}
 if(closed||request.signal.aborted){await drop?.();close();return new Response(null,{status:204});}
 timer=setInterval(()=>void send().catch(close),3000);request.signal.addEventListener('abort',close,{once:true});void send().catch(close);
 return new Response(stream,{headers:{'content-type':'text/event-stream','cache-control':'no-store','x-accel-buffering':'no'}});
}
