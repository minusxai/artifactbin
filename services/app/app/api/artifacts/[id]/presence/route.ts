import {createHash} from 'node:crypto';
import {baseUrl} from '@/lib/http';
import {getArtifactById,canReadArtifact} from '@/lib/artifacts';
import {sessionActor,authorHandle} from '@/lib/accounts';
import {getDb} from '@/lib/platform/db';
import {presenceGeometry} from '@/lib/html-presence/model';
import {presenceChannel} from '@/lib/html-presence/channel.server';
import type {PresenceViewer} from '@/lib/html-presence/contract';
async function access(request:Request,id:string){const row=await getArtifactById(id);const actor=await sessionActor(request);return row?.format==='html'&&await canReadArtifact(row,actor)?{row,actor}:null;}
/** Account authority stays on the platform. A per-tab random secret becomes a public, non-reversible roster ID. */
export async function POST(request:Request,ctx:{params:Promise<{id:string}>}){
 const origin=request.headers.get('origin');
 if(origin){
  try{if(origin!==new URL(baseUrl(request)).origin)return new Response('forbidden',{status:403});}
  catch{return new Response('forbidden',{status:403});}
 }
 const {id}=await ctx.params;const allowed=await access(request,id);if(!allowed)return new Response('not found',{status:404});
 const text=await request.text();if(text.length>6000)return new Response('too large',{status:413});
 let input:Record<string,unknown>;try{input=JSON.parse(text);}catch{return new Response('invalid json',{status:400});}
 if(!input||typeof input.session!=='string'||!/^[a-f0-9-]{36}$/.test(input.session)||input.revision!==String(allowed.row.version))return new Response('invalid presence',{status:400});
 const key=createHash('sha256').update(`${allowed.actor.userId??allowed.actor.tokenId??'guest'}:${input.session}`).digest('hex');
 const entry:PresenceViewer={id:key,label:await authorHandle({actor_user_id:allowed.actor.userId})??'Guest',revision:String(allowed.row.version),seen:Date.now(),...presenceGeometry(input)};
 const db=await getDb();await db.query('SELECT pg_notify($1,$2)',[presenceChannel(id),JSON.stringify(input.visible===false?{id:key,gone:true}:entry)]);
 return Response.json({id:key});
}
