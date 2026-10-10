import {sessionActor,actorForArtifacts} from '@/lib/accounts';
import {unauthorized} from '@/lib/http';
import { membershipInbox } from '@/lib/document-data';
import {notificationChannel} from '@/lib/notifications';
import {subscribeChannel} from '@/lib/publish/realtime/live';
import {LIVE_KEEPALIVE_EVENT,LIVE_KEEPALIVE_MS} from '@/lib/http';
/** Recipient-scoped wakeups, using the same database transport as artifact live updates. */
export async function GET(request:Request){
 const actor=actorForArtifacts(await sessionActor(request));
 if(!actor?.userId)return unauthorized(request);
 await membershipInbox(actor);
 let stop:(()=>Promise<void>)|undefined;
 let timer:ReturnType<typeof setInterval>|undefined;
 let closed=false;
 const encoder=new TextEncoder();
 const stream=new ReadableStream<Uint8Array>({
  async start(controller){
   const send=()=>{if(!closed)controller.enqueue(encoder.encode('data: {}\n\n'));};
   const beat=()=>{if(!closed)controller.enqueue(encoder.encode(`event: ${LIVE_KEEPALIVE_EVENT}\ndata: {}\n\n`));};
   const close=()=>{if(closed)return;closed=true;clearInterval(timer);void stop?.();controller.close();};
   request.signal.addEventListener('abort',close,{once:true});
   // A lost database listener ends the stream: the client reconnects (lib/live-stream) and re-reads.
   try{stop=await subscribeChannel(notificationChannel(actor.userId!),send,close);if(closed){await stop();return;}send();timer=setInterval(beat,LIVE_KEEPALIVE_MS);}catch{close();}
  },
  cancel(){closed=true;clearInterval(timer);void stop?.();},
 });
 return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no'}});
}
