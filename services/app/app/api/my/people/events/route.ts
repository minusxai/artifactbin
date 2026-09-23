import {sessionActor,actorForArtifacts} from '@/lib/viewer';
import {unauthorized} from '@/lib/http';
import {membershipInbox} from '@/lib/membership-inbox';
import {notificationChannel} from '@/lib/notifications';
import {subscribeChannel} from '@/lib/story/live';
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
   const close=()=>{if(closed)return;closed=true;clearInterval(timer);void stop?.();controller.close();};
   request.signal.addEventListener('abort',close,{once:true});
   try{stop=await subscribeChannel(notificationChannel(actor.userId!),send);if(closed){await stop();return;}send();timer=setInterval(send,15000);}catch{close();}
  },
  cancel(){closed=true;clearInterval(timer);void stop?.();},
 });
 return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no'}});
}
