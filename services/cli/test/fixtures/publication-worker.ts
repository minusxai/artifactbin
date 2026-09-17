// Isolated process fixture: the test supplies private database/object-store paths.
import {getDb} from '../../../app/lib/db';
import {mintToken} from '../../../app/lib/tokens';
import {POST} from '../../../app/app/api/artifacts/route';
import {DELETE} from '../../../app/app/api/artifacts/[id]/route';
process.on('message',async(message:{action:string;token?:string;key?:string;id?:string})=>{
 try{
  if(message.action==='mint'){const token=await mintToken('restart-fixture');process.send?.({token:token.token});return;}
  const db=await getDb();
  if(message.action==='expire'){await db.query("UPDATE artifact_creation_operations SET response_until=now()-interval '1 second'");process.send?.({expired:true});return;}
  const request=new Request(`http://localhost:3000/api/artifacts${message.id?`/${message.id}`:''}`,{method:message.action==='delete'?'DELETE':'POST',headers:{Authorization:`Bearer ${message.token}`,'Content-Type':'application/json','Idempotency-Key':message.key??''},...(message.action==='delete'?{}:{body:JSON.stringify({markup:'<p>Durable operation</p>'})})});
  const response=message.action==='delete'?await DELETE(request,{params:Promise.resolve({id:message.id!})}):await POST(request);
  process.send?.({status:response.status,body:await response.json()});
 }catch(error){process.send?.({failure:error instanceof Error?error.message:String(error)});}
});
process.send?.({ready:true});
