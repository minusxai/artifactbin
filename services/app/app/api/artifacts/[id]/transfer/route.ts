import {groupRoute} from '@/lib/group-routes';
import {json,readJson} from '@/lib/http';
import {parseArtifactDestination} from '@/lib/artifacts';
import {transferArtifact} from '@/lib/artifacts';
import {DatasetError} from '@/lib/datasets/errors';
export const POST=groupRoute(async(request,userId,params)=>{
 const body=await readJson(request);if(!body)return json({error:'invalid_body'},400);
 try{
  const destination=parseArtifactDestination(body.destination);
  if(!destination)return json({error:'invalid_destination'},400);
  const row=await transferArtifact({tokenId:'',userId},params.id,destination);
  return row?json({id:row.id,owner:destination,group_id:row.group_id,user_id:row.user_id}):json({error:'not_found'},404);
 }catch(error){if(error instanceof DatasetError)return json({error:error.status===409?'transfer_conflict':'transfer_refused',details:[error.message]},error.status);throw error;}
});
