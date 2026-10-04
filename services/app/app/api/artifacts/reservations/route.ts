/** Authenticated, actor-owned, idempotent batches of 100; guests retain their token identity. */
import {withTokenAuth} from '@/lib/accounts';
import {json} from '@/lib/http';
import {reserveIds} from '@/lib/artifacts';
import {CreationReplay} from '@/lib/artifacts';
export const POST=withTokenAuth(async(request,actor)=>{
 try{return json({ids:await reserveIds(actor,request.headers.get('Idempotency-Key')??'',request.headers.get('X-Artifactbin-Account'))});}
 catch(error){if(error instanceof CreationReplay)return json(error.reply.body,error.reply.status);throw error;}
});
