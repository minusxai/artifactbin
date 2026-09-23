import {z} from 'zod';
import {browserActor} from '@/lib/auth';
import {actorForArtifacts,sessionActor} from '@/lib/viewer';
import {json,readJson,unauthorized} from '@/lib/http';
import {membershipInbox,updateMembershipInbox} from '@/lib/membership-inbox';
import {MembershipError} from '@/lib/membership';
const schema=z.object({autoAccept:z.boolean().optional(),read:z.string().max(512).optional(),block:z.string().max(128).optional(),unblock:z.string().max(128).optional()}).strict();
export async function GET(request:Request){const actor=actorForArtifacts(await sessionActor(request));if(!actor)return unauthorized(request);try{return json(await membershipInbox(actor));}catch(e){if(e instanceof MembershipError)return json({error:e.message},e.status);throw e;}}
export async function PATCH(request:Request){const session=await browserActor(request);if(session instanceof Response)return session;const actor=actorForArtifacts(session);if(!actor)return unauthorized(request);const input=schema.safeParse(await readJson(request));if(!input.success)return json({error:'invalid_preferences'},400);try{return json(await updateMembershipInbox(actor,input.data));}catch(e){if(e instanceof MembershipError)return json({error:e.message},e.status);throw e;}}
