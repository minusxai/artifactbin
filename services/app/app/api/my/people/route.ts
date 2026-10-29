import {z} from 'zod';
import {browserActor,sessionActor} from '@/lib/accounts';
import {json,readJson,unauthorized} from '@/lib/http';
import { MembershipError } from '@/lib/artifacts';
import { membershipInbox, updateMembershipInbox } from '@/lib/notifications';
const schema=z.object({autoAccept:z.boolean().optional(),read:z.string().max(512).optional(),readAll:z.boolean().optional(),revision:z.number().int().min(1).optional(),block:z.string().max(128).optional(),unblock:z.string().max(128).optional()}).strict();
export async function GET(request:Request){const actor=await sessionActor(request);if(!actor.userId&&!actor.tokenId)return unauthorized(request);try{return json(await membershipInbox(actor,Math.max(0,Math.min(100000,Number(new URL(request.url).searchParams.get('offset'))||0))));}catch(e){if(e instanceof MembershipError)return json({error:e.message},e.status);throw e;}}
export async function PATCH(request:Request){const actor=await browserActor(request);if(actor instanceof Response)return actor;const input=schema.safeParse(await readJson(request));if(!input.success)return json({error:'invalid_preferences'},400);try{return json(await updateMembershipInbox(actor,input.data));}catch(e){if(e instanceof MembershipError)return json({error:e.message},e.status);throw e;}}
