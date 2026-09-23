import {z} from 'zod';
import {browserActor} from '@/lib/auth';
import {sessionActor,actorForArtifacts} from '@/lib/viewer';
import {json,unauthorized,readJson} from '@/lib/http';
import {notificationDelivery} from '@/lib/notification-delivery';
const preferences=z.object({invitations:z.boolean(),comments:z.boolean(),activity:z.boolean()}).strict();
export async function GET(request:Request){
 const actor=actorForArtifacts(await sessionActor(request));if(!actor?.userId)return unauthorized(request);
 const service=notificationDelivery();return json(service?{enabled:true,preferences:await service.preferences(actor.userId)}:{enabled:false});
}
export async function PATCH(request:Request){
 const session=await browserActor(request);if(session instanceof Response)return session;
 const actor=actorForArtifacts(session);if(!actor?.userId)return unauthorized(request);
 const service=notificationDelivery();if(!service)return json({error:'unavailable'},404);
 const parsed=preferences.safeParse(await readJson(request));if(!parsed.success)return json({error:'invalid_preferences'},400);
 return json({enabled:true,preferences:await service.updatePreferences(actor.userId,parsed.data)});
}
