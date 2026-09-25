/** Authoring-time IO for a client's affected context. Never reads or writes the
 * target document. The subsequent operation commit checks current permissions
 * and dependency revisions independently; this result is not a certificate. */
import {catalogOf} from '../datasets/catalog';
import {retainUserScope} from '../datasets/user-fields';
import {MAX_DOCUMENT_BYTES,type DocumentResourcePreparation} from '@artifactbin/contracts';
import {getDb} from '../db';
import {editorScope,refLoaderForActor,assetImporterFor,fontResolver,type TokenActor} from '../artifacts';
import {json} from '../http';
import {prepareJsx,applyPreparedJsx} from './jsx-tier';
export async function prepareDocumentAuthoringContext(actor:TokenActor,id:string,body:Record<string,unknown>):Promise<Response>{
 if(typeof body.source!=='string'||Buffer.byteLength(body.source)>MAX_DOCUMENT_BYTES)return json({error:'invalid_authoring_context'},400);
 const db=await getDb(),scope=editorScope(actor);
 const owner=(await db.query<{token_id:string;user_id:string|null}>(`SELECT token_id,user_id FROM artifacts WHERE id=$1 AND format<>'folder' AND ${scope.where('$2')}`,[id,scope.val])).rows[0];
 if(!owner)return json({error:'not_found'},404);
 const prepared=await prepareJsx({},body.source,{loadRef:refLoaderForActor({tokenId:owner.token_id,userId:owner.user_id})});
 if(prepared instanceof Response)return prepared;
 const ready=body.dryRun===true?prepared.content:await applyPreparedJsx(prepared,{importAsset:assetImporterFor(owner.token_id,owner.user_id),resolveFont:fontResolver()});
 if(ready instanceof Response)return ready;
 const datasetBindings:NonNullable<DocumentResourcePreparation['datasetBindings']>=[];
 const refs=(ready.meta.refs as Array<{id:string}>|undefined)??[];
 for(const ref of refs){
  const dataset=(await db.query<{id:string;version:number;source:string|null;meta:Record<string,unknown>;user_id:string|null;token_id:string}>("SELECT id,version,source,meta,user_id,token_id FROM artifacts WHERE id=$1 AND format='dataset' AND deleted_at IS NULL",[ref.id])).rows[0];
  if(!dataset||!catalogOf(dataset)?.tables.some(t=>t.columns.some(c=>c.constraints?.memberOf?.includes('current'))))continue;
  if(owner.user_id?dataset.user_id!==owner.user_id:dataset.token_id!==owner.token_id)return json({error:'dataset_scope_owner_required'},403);
  const bound=retainUserScope(dataset,{meta:{userScopeDocument:id}});
  datasetBindings.push({id:dataset.id,version:dataset.version,source:bound.source,meta:{catalog:bound.meta.catalog,columns:bound.meta.columns,userScopeDocument:id}});
 }
 return json({valid:true,...(datasetBindings.length?{datasetBindings}:{}),...(ready.warnings?.length?{warnings:ready.warnings}:{})});
}
