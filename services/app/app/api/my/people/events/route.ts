import {sessionActor} from '@/lib/accounts';
import {unauthorized} from '@/lib/http';
import {membershipInbox,notificationChannel} from '@/lib/notifications';
import {subscribeChannel} from '@/lib/publish/realtime/live';
import {LIVE_KEEPALIVE_MS,liveKeepaliveFrame} from '@/lib/http';
/** Recipient-scoped wakeups, using the same database transport as artifact live updates. */
export async function GET(request:Request){
 const actor=await sessionActor(request);
 const userId=actor.userId;if(!userId)return unauthorized(request);
 await membershipInbox(actor);
 let stop:(()=>Promise<void>)|undefined;
 let timer:ReturnType<typeof setInterval>|undefined;
 let closed=false;
 const encoder=new TextEncoder();
 const stream=new ReadableStream<Uint8Array>({
  async start(controller){
   const send=()=>{if(!closed)controller.enqueue(encoder.encode('data: {}\n\n'));};
   const beat=()=>{if(!closed)controller.enqueue(encoder.encode(liveKeepaliveFrame()));};
   const close=()=>{if(closed)return;closed=true;clearInterval(timer);void stop?.();controller.close();};
   request.signal.addEventListener('abort',close,{once:true});
   // A lost database listener ends the stream: the client reconnects (lib/live-stream) and re-reads.
   try{stop=await subscribeChannel(notificationChannel(userId),send,close);if(closed){await stop();return;}send();timer=setInterval(beat,LIVE_KEEPALIVE_MS);}catch{close();}
  },
  cancel(){closed=true;clearInterval(timer);void stop?.();},
 });
 return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no'}});
}
