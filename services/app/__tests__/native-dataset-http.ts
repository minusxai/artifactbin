/** Explicit native dataset GraphQL fixture client. No authoring conversion or authority fallback. */
import type {DatasetSchemaResult,DatasetReadResult} from '@artifactbin/contracts';
import {POST as graphql} from '@/app/api/artifacts/[id]/graphql/route';
import {request,type RequestOptions} from './harness';
export type DatasetAuth=Pick<RequestOptions,'actor'|'token'|'cookie'|'origin'>;
interface DatasetAnswer<T>{data?:{records?:T};errors?:readonly {message:string}[];extensions?:unknown}
interface DatasetWireValue {type:'STRING'|'NUMBER'|'BOOLEAN'|'JSON';string?:string|null;number?:number|null;boolean?:boolean|null;json?:unknown}
type DatasetWireRows=Omit<DatasetReadResult,'rows'>&{rows:readonly {id:string;cells:readonly {columnId:string;value:DatasetWireValue}[]}[]};
export interface DatasetReply<T>{response:Response;body:DatasetAnswer<T>}
export function nativeDatasetClient(pageId:string){
 const call=async<T>(query:string,variables:Record<string,unknown>,auth:DatasetAuth={}):Promise<DatasetReply<T>>=>{
  const response=await graphql(request(`/api/artifacts/${pageId}/graphql`,{...auth,method:'POST',json:{revision:'1',query,variables}}),{params:Promise.resolve({id:pageId})});
  return {response,body:await response.clone().json()};
 };
 return {
  schema:(auth:DatasetAuth={})=>call<{schema:DatasetSchemaResult}>('{records{schema{revision tables{id label columns{id label type}}}}}',{},auth),
  rows:(tableId:string,auth:DatasetAuth={})=>call<{rows:DatasetWireRows}>('query($table:ID!){records{rows(tableId:$table,first:100){revision rows{id cells{columnId value{type string number boolean json}}}}}}',{table:tableId},auth),
  write:(tableId:string,expectedRevision:string,changes:unknown[],requestId:string,auth:DatasetAuth={})=>call<{writeRows:{outcome:string;revision:string|null}}>('mutation($table:ID!,$expected:String!,$changes:[records__RowChange!]!,$request:ID!){records{writeRows(tableId:$table,expectedRevision:$expected,changes:$changes,requestId:$request){outcome revision}}}',{table:tableId,expected:expectedRevision,changes,request:requestId},auth),
 };
}
