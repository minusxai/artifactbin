import type {HtmlPageVersion,HtmlBackendLink,Queryable} from '@artifactbin/contracts';
import { liveTokenSql, type AccessActor } from '@/lib/accounts';
import { getArtifactById, getArtifactFor, canReadArtifact, durableMutation, pinMutationContext, artifactState, type ArtifactRow, type MutationReceipt } from '@/lib/artifacts';
import { writerFor, grantsOf, grantContext, can, attestRegisteredHtmlMutation } from '@/lib/artifact-access';
import {canWriteDataset,mutateDataset,isMutationRefused} from '@/lib/document-data';
import {readHtmlPage} from '@/lib/html-publication';
import {getHtmlBackendVersion,type HtmlBackendVersionRecord} from '@/lib/html-backends';
import {createRegisteredMutationService, registeredMutationPlan, type MutationContext, type RegisteredMutationPorts} from '@/lib/registered-page-mutations';
const unavailable=()=>Error('registered_mutation_unavailable');
/** Host factory receives actual request actor and immutable saved page/backend, not page arguments. */
export function createRetainedRegisteredMutation(actor:AccessActor,page:HtmlPageVersion,link:HtmlBackendLink,backend:HtmlBackendVersionRecord,revalidateActor:()=>Promise<AccessActor>){
 // Public authentication admits account-backed credentials only; legacy ownership tokens cannot authenticate.
 if(!actor.userId)throw Error('registered_mutation_account_required');
 const plan=registeredMutationPlan(page,link,backend);if(!plan)throw unavailable();
 const context:MutationContext={...plan.registration,subject:actor.userId,callerKey:JSON.stringify([actor.userId,actor.tokenId,actor.groupId??null])};
 let doc:ArtifactRow|undefined,dataset:ArtifactRow|undefined,document:{id:string;editId:string;registeredHtml:object}|undefined;
 const verifyTransaction=async(tx:Queryable)=>{
  // Token revocation and account expiry cannot race the final transaction: the token is live at the wall clock, after the commit's row locks.
  if(actor.tokenId){const token=(await tx.query<{user_id:string|null}>(`SELECT user_id FROM tokens WHERE id=$1 AND ${liveTokenSql('clock_timestamp()')} FOR SHARE`,[actor.tokenId])).rows[0];if(!token||token.user_id!==(actor.userId??null))throw unavailable();}
  if(actor.userId&&!(await tx.query('SELECT id FROM users WHERE id=$1 AND (expires_at IS NULL OR expires_at>now()) FOR SHARE',[actor.userId])).rows.length)throw unavailable();
  const current=(await tx.query<ArtifactRow>('SELECT * FROM artifacts WHERE id=$1 AND deleted_at IS NULL',[page.pageId])).rows[0];
  // A page saved since import has its current version only in the locked head row; it is archived at the next save.
  const saved=(await tx.query<{source:string;meta:{htmlLinks?:HtmlBackendLink[]}}>('SELECT source,meta FROM artifact_versions WHERE artifact_id=$1 AND version=$2',[page.pageId,page.version])).rows[0]??(current?.version===page.version?current as unknown as {source:string;meta:{htmlLinks?:HtmlBackendLink[]}}:undefined);
  const row=(await tx.query<{backend_id:string;page_id:string;version:string;name:string;source:string;type_defs:string;compiled:string;owner_id:string;secret_bindings:string[]}>('SELECT * FROM html_backend_versions WHERE backend_id=$1 AND version=$2',[link.backendId,link.version])).rows[0];
  if(!current||current.format!=='html'||current.version!==page.version||current.edit_id!==doc?.edit_id||current.user_id!==backend.ownerId||current.source!==page.html||!saved||saved.source!==page.html||!saved.meta.htmlLinks?.some(value=>value.kind==='backend'&&value.name===link.name&&value.backendId===link.backendId&&value.version===link.version)||!row||row.owner_id!==backend.ownerId)throw unavailable();
  registeredMutationPlan(page,link,{backendId:row.backend_id,pageId:row.page_id,version:row.version,name:row.name,source:row.source,typeDefs:row.type_defs,compiled:row.compiled,ownerId:row.owner_id,secretBindings:row.secret_bindings});
 };
 const ports:RegisteredMutationPorts={
  async authorize(_context,registered,signal){
   signal.throwIfAborted();if(JSON.stringify(await revalidateActor())!==JSON.stringify(actor))throw unavailable();
   const live=await getArtifactById(page.pageId),saved=await readHtmlPage(actor,page.pageId);
   if(!live||live.format!=='html'||live.user_id!==backend.ownerId||saved.version!==page.version||saved.html!==page.html||!await canReadArtifact(live,actor))throw unavailable();
   const actual=await getHtmlBackendVersion(link.backendId,link.version);if(!actual||actual.ownerId!==backend.ownerId||!registeredMutationPlan(saved,link,actual))throw unavailable();
   if(registered.builtins.some(value=>value.name==='_me.id')&&!await can(actor,'write_as_me',live))throw unavailable();
   doc=live;document={id:live.id,editId:live.edit_id,registeredHtml:attestRegisteredHtmlMutation(live.id,live.edit_id,verifyTransaction)};
   const candidate=await getArtifactById(registered.target.datasetId);dataset=candidate&&grantsOf(candidate)?candidate:await getArtifactFor(writerFor(live),registered.target.datasetId)??undefined;
   if(!dataset)throw unavailable();if(grantsOf(dataset))await grantContext(dataset,actor,document);
   if(await canWriteDataset(dataset,actor,document))throw unavailable();
  },
  async durable(_context,key,fingerprint,work){
   const reply=await durableMutation(actor,'https://registered-page.invalid',key,{fingerprint},async receipt=>{const outcome=await work(receipt);return {status:outcome.outcome==='committed'?200:409,body:{registeredMutation:outcome}};});
   const stored=reply.body.registeredMutation;if(stored)return stored as Awaited<ReturnType<typeof work>>;
   const committed=reply.body.mutationOperation as {version:number;affected:number}|undefined;
   // mutateDataset saved this receipt atomically with its pointer CAS.
   if(reply.status===200&&committed)return {requestId:'',outcome:'committed',revision:String(committed.version),affected:committed.affected,reset:[...plan.reset]};
   return {requestId:'',outcome:reply.body.error==='operation_pending'||reply.body.error==='outcome_unknown'?'unknown':'rejected',revision:null,affected:null,reset:[]};
  },
  platform:async()=>({userId:actor.userId??null,now:new Date().toISOString(),tz:'UTC'}),
  async commit(_context,registered,params,receipt,signal){
   signal.throwIfAborted();if(!doc||!dataset||!document)throw unavailable();
   await pinMutationContext(receipt as MutationReceipt,{registration:registered.registration,operation:registered.name,params});
   const result=await mutateDataset(dataset,actor,registered.sql,params,{target:{schema:registered.target.schema,table:registered.target.table},document,receipt:receipt as MutationReceipt,expectedState:artifactState(dataset),expectedAffected:registered.expectedAffected,paramTypes:Object.fromEntries([...Object.values(registered.values).map(value=>[value.parameter,value.type] as const),...registered.builtins.map(value=>[value.parameter,'string' as const])])});
   return isMutationRefused(result)?{outcome:'rejected',revision:null,affected:null,...(result.reason==='row_changed'||result.reason==='row_not_unique'?{reason:result.reason}:{})}:{outcome:'committed',revision:String(result.row.version),affected:result.affected};
  },
 };
 const execute=createRegisteredMutationService(ports);
 return {context,plan,execute:async(input:unknown,signal:AbortSignal)=>{const result=await execute(context,plan,input,signal);return {...result,requestId:(input as {requestId:string}).requestId};}};
}
