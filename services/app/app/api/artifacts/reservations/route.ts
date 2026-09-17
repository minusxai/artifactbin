/** Authenticated, account-owned, idempotent batches of 100. */
import {withTokenAuth} from '@/lib/auth';
import {json} from '@/lib/http';
import {reserveIds} from '@/lib/artifact-identities';
import {CreationReplay} from '@/lib/creation-ledger';
export const POST=withTokenAuth(async(request,actor)=>{
 if(!actor.userId)return json({error:'account_required'},403);
 try{return json({ids:await reserveIds(actor,request.headers.get('Idempotency-Key')??'')});}
 catch(error){if(error instanceof CreationReplay)return json(error.reply.body,error.reply.status);throw error;}
});
