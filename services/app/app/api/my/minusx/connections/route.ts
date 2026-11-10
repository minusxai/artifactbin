import { requestOrSessionActor, refusesCrossSite } from '@/lib/authentication';
import {json,unauthorized} from '@/lib/http';
import {minusxConnectionsFor,MinusxBindingError} from '@/lib/minusx';
type Connection={id:string;name:string;protocol:string};
/**
 * GET ?group_id=… — the MinusX connections the signed-in account could pin a page's governed (`'minusx'`) connection
 * to under that ONE group, for the Resolvers panel: asked of MinusX with a delegation minted for this account under
 * exactly that group (lib/minusx `minusxConnectionsFor`; a direct member only). Refusals are the binding's own codes,
 * with the secrets route's statuses: `not_group_member` and `binding_forbidden` 403, `minusx_not_configured` 400,
 * `minusx_unavailable` 503. Ids, names and protocols only.
 */
export async function GET(request:Request){
 const actor=await requestOrSessionActor(request);if(refusesCrossSite(request,actor))return json({error:'forbidden'},403);
 if(!actor.userId)return actor.tokenId?json({error:'account_required'},403):unauthorized(request);
 const group=new URL(request.url).searchParams.get('group_id');
 if(!group)return json({error:'invalid_request'},400);
 const noStore={'Cache-Control':'no-store'};
 try{
  const connections=await minusxConnectionsFor(actor.userId,group);
  return json({connections:connections.map(({id,name,protocol}):Connection=>({id,name:typeof name==='string'?name:id,protocol}))},200,noStore);
 }catch(error){
  if(!(error instanceof MinusxBindingError))throw error;
  return json({error:error.code},error.code==='minusx_unavailable'?503:error.code==='minusx_not_configured'?400:403,noStore);
 }
}
