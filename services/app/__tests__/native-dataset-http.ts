/** Explicit page GraphQL fixture client for a page's dataset links (their generated roots). No authoring conversion or authority fallback. */
import {POST as graphql} from '@/app/api/artifacts/[id]/graphql/route';
import {request,type RequestOptions} from './harness';
export type DatasetAuth=Pick<RequestOptions,'actor'|'token'|'cookie'|'origin'>;
interface DatasetAnswer{data?:Record<string,any>|null;errors?:readonly {message:string;extensions?:{code?:string}}[];extensions?:{outcomes?:Record<string,string>}}
export interface DatasetReply{response:Response;body:DatasetAnswer}
export function nativeDatasetClient(pageId:string){
 const gql=async(query:string,variables:Record<string,unknown>={},auth:DatasetAuth={},idempotencyKey?:string):Promise<DatasetReply>=>{
  const response=await graphql(request(`/api/artifacts/${pageId}/graphql`,{...auth,method:'POST',json:{revision:'1',query,variables},...(idempotencyKey?{headers:{'Idempotency-Key':idempotencyKey}}:{})}),{params:Promise.resolve({id:pageId})});
  return {response,body:await response.clone().json()};
 };
 return {
  gql,
  /** Every row of a single-table link, `_id` first, then the named columns. */
  rows:(root:string,columns:string,auth:DatasetAuth={})=>gql(`{ ${root}(limit: 1000) { _id ${columns} } }`,{},auth),
  /** One mutation operation; committed only when every root it names reports committed. */
  committed:(reply:DatasetReply)=>!reply.body.errors?.length&&Object.values(reply.body.extensions?.outcomes??{}).length>0&&Object.values(reply.body.extensions!.outcomes!).every(outcome=>outcome==='committed'),
 };
}
