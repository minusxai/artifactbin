import {resolveToken} from './tokens';
import {validateQueryValues} from './story/query-values';
import {createHash} from 'node:crypto';
import {readableArtifact} from './artifact-read';
import {artifactState} from './artifact-state';
import {dataflowForRow,declarationsForRow,type TokenActor} from './artifacts';
import {catalogOf} from './datasets/catalog';
import {executeCatalog} from './datasets/execute';
import {DatasetError} from './datasets/errors';
import {json} from './http';
import {parseQueryRequest} from './story/query-request';
import type {TableResult} from '@artifactbin/contracts';
import {REVALIDATE_ACTOR_HEADER} from '@artifactbin/contracts';

/** Query validation, pagination and authorization are independent of the transport. */
export async function queryResource(actor:TokenActor,id:string,body:Record<string,unknown>,signal?:AbortSignal,checkActor?:()=>Promise<void>):Promise<Response>{
 if(Object.keys(body).some(key=>!['sql','values','name','limit','cursor','refresh'].includes(key)))return json({error:'unknown_query_fields'},400);
 if(body.sql!==undefined&&(typeof body.sql!=='string'||!body.sql.trim())||body.name!==undefined&&(typeof body.name!=='string'||!body.name)||body.refresh!==undefined&&typeof body.refresh!=='boolean')return json({error:'invalid_query'},400);
 const parsed=parseQueryRequest({...(body.values===undefined?{}:{values:body.values})});if(parsed instanceof Response)return parsed;
 const limit=body.limit??20;if(!Number.isInteger(limit)||Number(limit)<1||Number(limit)>100)return json({error:'invalid_limit'},400);
 await checkActor?.();
 const readable=await readableArtifact(actor,id);if(!readable)return json({error:'not_found'},404);
 const {row}=readable;const state=artifactState(row);
 const fingerprint=createHash('sha256').update(JSON.stringify([id,state,body.sql??null,body.name??null,parsed.values??{},limit])).digest('hex');
 let offset=0;
 if(body.cursor!==undefined){
  try{
   if(typeof body.cursor!=='string'||body.cursor.length>1024)throw Error();
   const cursor=JSON.parse(Buffer.from(body.cursor,'base64url').toString());
   if(cursor.fingerprint!==fingerprint||!Number.isSafeInteger(cursor.offset)||cursor.offset<0)throw Error();
   offset=cursor.offset;
  }catch{return json({error:'invalid_cursor',hint:'Restart this query without --cursor; the resource or query inputs changed.'},400);}
 }
 const authorize=async()=>{
  signal?.throwIfAborted();await checkActor?.();const current=await readableArtifact(actor,id);
  if(!current||artifactState(current.row)!==state)throw new DatasetError('Query access or resource changed',404);
 };
 const result=(name:string,table:TableResult)=>({id,name,execution:'remote',...table,rows:table.rows.slice(0,Number(limit)),next_cursor:table.rows.length>Number(limit)?Buffer.from(JSON.stringify({fingerprint,offset:offset+Number(limit)})).toString('base64url'):null});
 try{
  if(row.format==='dataset'){
   const catalog=catalogOf(row);if(!catalog)return json({error:'not_a_dataset'},400);
   const selected=typeof body.name==='string'?catalog.tables.find(table=>table.name===body.name||`${table.schema}.${table.name}`===body.name):catalog.tables.length===1?catalog.tables[0]:undefined;
   if(body.name&&!selected||!body.sql&&!selected)return json({error:'unknown_table',hint:'Select a table with --name.',names:catalog.tables.map(table=>`${table.schema}.${table.name}`)},400);
   const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
   const sql=typeof body.sql==='string'?body.sql:`select * from ${quote(selected!.schema)}.${quote(selected!.name)}`;
   const table=await executeCatalog(catalog,sql,parsed.values,{datasetId:id,limit:Number(limit)+1,offset,refresh:body.refresh===true,authorize,signal});
   await authorize();return json({results:[result(selected?`${selected.schema}.${selected.name}`:'result',table)]},200,{[REVALIDATE_ACTOR_HEADER]:'1'});
  }
  if(body.sql!==undefined)return json({error:'invalid_query',hint:'Use --name for a declared document query; --input SQL applies to datasets.'},400);
  if(row.format!=='markup'&&row.format!=='folder')return json({error:'not_queryable'},400);
  const flow=declarationsForRow(row)?.flow;const names=flow?.queries.map(query=>query.name)??[];
  if(body.name&&!names.includes(String(body.name)))return json({error:'unknown_query',names},400);
  const invalid=validateQueryValues(flow??{values:[],queries:[]},parsed.values??{});if(invalid)return json({error:invalid.code,names:invalid.names},400);
  const selected=body.name?[String(body.name)]:names;
  if(body.cursor&&selected.length!==1)return json({error:'invalid_cursor',hint:'Select one declared query with --name before paging.'},400);
  const results=[];
  for(const name of selected){
   const outcome=await dataflowForRow(row,{values:parsed.values,only:[name],page:{name,limit:Number(limit)+1,offset},viewer:actor,authorize,signal});
   const failure=outcome?.state.errors[name];if(failure)return json({error:'query_failed',name,detail:failure},400);
   const table=outcome?.state.tables[name];if(table)results.push(result(name,table));
  }
  await authorize();return json({results},200,{[REVALIDATE_ACTOR_HEADER]:'1'});
 }catch(error){
  if(error instanceof DatasetError)return json({error:'query_failed',message:error.message},error.status);
  // The SQL validator refuses a statement with a bare Error ("Dataset SQL: …"); that is the caller's
  // statement, not a server fault, and preflight already reports it as invalid_sql. Left to escape it
  // became a 500 the agent could not read (a local eval leg: pi lost four calls to `undeclared parameter $team`).
  if(error instanceof Error&&error.message.startsWith('Dataset SQL: '))return json({error:'invalid_sql',message:error.message},400);
  throw error;
 }
}

export async function queryResourceForRequest(actor:TokenActor,id:string,body:Record<string,unknown>,request:Request):Promise<Response>{
 try{return await queryResource(actor,id,body,request.signal,async()=>{
  const bearer=request.headers.get('authorization');if(!bearer)return;
  const token=bearer.startsWith('Bearer ')?await resolveToken(bearer.slice(7).trim()):null;
  if(!token||token.id!==actor.tokenId||token.userId!==actor.userId)throw new DatasetError('Query access revoked',403);
 });}catch(error){if(error instanceof DatasetError)return json({error:'query_access_revoked'},error.status);throw error;}
}
