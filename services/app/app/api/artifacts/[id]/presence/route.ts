import {baseUrl} from '@/lib/http';
import {getArtifactAccessById,canReadArtifact} from '@/lib/artifacts';
import {sessionActor,authorHandle} from '@/lib/accounts';
import {getDb} from '@/lib/platform/db';
import {publishPresence} from '@/lib/html-presence/publish.server';
import {presenceChannel} from '@/lib/html-presence/channel.server';
/** The access columns only: a heartbeat never ships the document. */
async function access(request:Request,id:string){const [row,actor]=await Promise.all([getArtifactAccessById(id),sessionActor(request)]);return row?.format==='html'&&await canReadArtifact(row,actor)?{row,actor}:null;}
/** Account authority stays on the platform (lib/html-presence/publish.server). */
export async function POST(request:Request,ctx:{params:Promise<{id:string}>}){
 const origin=request.headers.get('origin');
 if(origin){
  try{if(origin!==new URL(baseUrl(request)).origin)return new Response('forbidden',{status:403});}
  catch{return new Response('forbidden',{status:403});}
 }
 const {id}=await ctx.params;const allowed=await access(request,id);if(!allowed)return new Response('not found',{status:404});
 const text=await request.text();if(text.length>6000)return new Response('too large',{status:413});
 let input:unknown;try{input=JSON.parse(text);}catch{return new Response('invalid json',{status:400});}
 const published=await publishPresence(allowed.actor,allowed.row,input,{label:userId=>authorHandle({actor_user_id:userId}),now:Date.now,
  notify:async message=>{const db=await getDb();await db.query('SELECT pg_notify($1,$2)',[presenceChannel(id),message]);}});
 return published?Response.json(published):new Response('invalid presence',{status:400});
}
