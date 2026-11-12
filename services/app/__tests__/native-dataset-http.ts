/** SQL fixture client for a page's dataset links; real handler and caller authority. */
import {POST as sqlPost} from '@/app/api/artifacts/[id]/sql/route';
import {request,type RequestOptions} from './harness';
export type DatasetAuth=Pick<RequestOptions,'actor'|'token'|'cookie'|'origin'>;
interface DatasetAnswer{rows?:Array<Record<string,any>>;returning?:Array<Record<string,any>>;affected?:number;error?:string;message?:string}
export interface DatasetReply{response:Response;body:DatasetAnswer}
export function nativeDatasetClient(pageId:string){
 const sql=async(sql:string,params:Record<string,unknown>={},auth:DatasetAuth={},idempotencyKey?:string):Promise<DatasetReply>=>{
  const response=await sqlPost(request(`/api/artifacts/${pageId}/sql`,{...auth,method:'POST',json:{revision:'1',sql,params},...(idempotencyKey?{headers:{'Idempotency-Key':idempotencyKey}}:{})}),{params:Promise.resolve({id:pageId})});
  return {response,body:await response.clone().json()};
 };
 return {sql,rows:(table:string,columns:string,auth:DatasetAuth={})=>sql(`select _id, ${columns.split(/\s+/).map(c=>'"'+c.replaceAll('"','""')+'"').join(', ')} from "${table.replaceAll('"','""')}"`,{},auth),committed:(reply:DatasetReply)=>reply.response.ok&&typeof reply.body.affected==='number'};
}
