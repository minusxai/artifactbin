/** Exercise the advanced CLI surface through real bearer HTTP handlers. */
import {request} from './harness';
import {observedRequest} from './conditional-request';
import {GET as list,POST as create} from '@/app/api/artifacts/route';
import {GET as get,PUT as update,DELETE as remove} from '@/app/api/artifacts/[id]/route';
import {POST as edit} from '@/app/api/artifacts/[id]/edits/route';
import {POST as fork} from '@/app/api/artifacts/[id]/fork/route';
import {GET as versions} from '@/app/api/artifacts/[id]/versions/route';
import {GET as version} from '@/app/api/artifacts/[id]/versions/[version]/route';
import {POST as revert} from '@/app/api/artifacts/[id]/revert/route';
import {GET as capture} from '@/app/api/artifacts/[id]/export/route';

export async function operationHttp(token:string,name:string,args:Record<string,unknown>){
 const {id,...body}=args;const base=`/api/artifacts/${id}`;
 const ctx={params:Promise.resolve({id:String(id),version:String(args.version)})};
 let response:Response;
 switch(name){
  case 'create_artifact':response=await create(request('/api/artifacts',{method:'POST',token,json:body}));break;
  case 'list_artifacts':response=await list(request('/api/artifacts',{token}));break;
  case 'get_artifact':response=await get(request(base,{token}),ctx);break;
  case 'update_artifact':response=await update(await observedRequest(base,{method:'PUT',token,json:body}),ctx);break;
  case 'delete_artifact':response=await remove(request(base,{method:'DELETE',token}),ctx);break;
  case 'edit_artifact':response=await edit(request(base+'/edits',{method:'POST',token,json:body}),ctx);break;
  case 'fork_artifact':response=await fork(request(base+'/fork',{method:'POST',token,json:body}),ctx);break;
  case 'list_versions':response=await versions(request(base+'/versions',{token}),ctx);break;
  case 'get_version':response=await version(request(base+'/versions/'+args.version,{token}),ctx);break;
  case 'revert_artifact':response=await revert(await observedRequest(base+'/revert',{method:'POST',token,json:body}),ctx);break;
  case 'export_artifact':response=await capture(request(base+'/export',{token}),ctx);break;
  default:throw new Error(`Unsupported HTTP test operation ${name}`);
 }
 return {isError:!response.ok,data:await response.json() as Record<string,unknown>};
}
