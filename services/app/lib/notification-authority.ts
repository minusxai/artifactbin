/** Transaction-only authorization shared by query execution, result commit and disclosure. */
import {notificationQueryContext,notificationRevision as hash} from './notification-context';
import type {MutationNotificationJobInput,MutationNotificationPlan,NotificationSource,Queryable,MutationInitiator,DatasetGrantPolicy} from '@artifactbin/contracts';
import {datasetGrantAllows,parseDatasetGrants} from '@artifactbin/utils';
import type {ArtifactRow,RoleActor} from './artifacts';
import {hasDocumentEditorAccess} from './document-policy';
import {catalogOf,importedTables} from './datasets/catalog';
import {PUBLIC_BASE_URL} from './config';
import {NotificationExecutionError} from './notification-error';

interface Account {id:string;email:string|null;kind:string;expires_at:string|null}
interface LiveToken {id:string;user_id:string|null;expires_at:string|null;audience:string|null;scope:string|null}
interface Identity {actor:RoleActor;kind:string|null;revision:string}
interface Share {user_id:string|null;email:string;role:string}
export interface NotificationArtifactAuthority {row:ArtifactRow;shares:Share[];revision:string}
const denied=()=>new NotificationExecutionError('notification_access_revoked');
const owner=(row:ArtifactRow,actor:RoleActor)=>row.user_id?row.user_id===actor.userId:row.token_id===actor.tokenId;
async function account(tx:Queryable,id:string):Promise<Account|null>{
 return (await tx.query<Account>("SELECT id,email,kind,expires_at FROM users WHERE id=$1 AND (expires_at IS NULL OR expires_at>now()) AND merged_into_user_id IS NULL",[id])).rows[0]??null;
}
export async function notificationPrincipal(tx:Queryable,principal:MutationInitiator['principal']):Promise<Identity>{
 if(principal.kind!=='user'&&principal.kind!=='token')throw denied();
 let userId:string|null=principal.kind==='user'?principal.id:null,token:LiveToken|null=null;
 if(principal.kind==='token'){
  token=(await tx.query<LiveToken>("SELECT id,user_id,expires_at,audience,scope FROM tokens WHERE id=$1 AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at>now())",[principal.id])).rows[0]??null;
  if(!token)throw denied();
  if(token.audience&&(token.audience!==`${new URL(PUBLIC_BASE_URL).origin}/api`||!token.scope?.split(/\s+/).includes('artifacts')))throw denied();
  userId=token.user_id;
 }
 const user=userId?await account(tx,userId):null;
 if(userId&&(!user||user.kind==='guest'))throw denied();
 return {actor:{userId,tokenId:token?.id??null,email:user?.email??null},kind:user?.kind??null,revision:hash([principal,token,user])};
}
export async function notificationArtifactAuthority(tx:Queryable,id:string):Promise<NotificationArtifactAuthority>{
 const row=(await tx.query<ArtifactRow>('SELECT * FROM artifacts WHERE id=$1 AND deleted_at IS NULL',[id])).rows[0];
 if(!row)throw denied();
 const shares=(await tx.query<Share>('SELECT user_id,email,role FROM artifact_shares WHERE artifact_id=$1 ORDER BY email',[id])).rows;
 return {row,shares,revision:hash([row.id,row.format,row.user_id,row.token_id,row.visibility,row.link_role,row.sharing_revision??0,row.policy_revision??0,row.dataset_policy??null,shares])};
}
function readable(authority:NotificationArtifactAuthority,identity:Identity):boolean {
 const {row,shares}=authority,{actor}=identity;
 if(owner(row,actor)||row.visibility!=='private')return true;
 if(identity.kind!=='account')return false;
 if(row.format==='markup'&&hasDocumentEditorAccess(actor))return true;
 return shares.some(share=>share.user_id?share.user_id===actor.userId:!!actor.email&&share.email===actor.email);
}
function policyOf(row:ArtifactRow):DatasetGrantPolicy|null{
 const policy=row.dataset_policy;
 return policy&&typeof policy==='object'&&'version' in policy&&policy.version===2?parseDatasetGrants(policy):null;
}
function sourceReadable(source:NotificationArtifactAuthority,document:NotificationArtifactAuthority,identity:Identity):boolean{
 if(source.row.format!=='dataset'||!readable(document,identity))return false;
 const policy=policyOf(source.row);
 if(!policy)return readable(source,identity);
 if(source.row.visibility==='private'&&!readable(source,identity))return false;
 return datasetGrantAllows(policy,'read',{caller:identity.actor,owner:{userId:source.row.user_id,tokenId:source.row.token_id},artifact:{id:document.row.id,owner:{userId:document.row.user_id,tokenId:document.row.token_id}}});
}
export async function notificationExecutionFence(tx:Queryable,input:MutationNotificationJobInput):Promise<MutationNotificationPlan['executionFence']>{
 const principal=await notificationPrincipal(tx,input.initiator.principal),document=await notificationArtifactAuthority(tx,input.origin.documentId);
 if(principal.actor.userId!==input.bindings.userId||document.row.format!=='markup'||!readable(document,principal))throw denied();
 return {principalRevision:principal.revision,documentRevision:document.revision,contextRevision:input.contextRevision};
}
/** Fence the initiating credential through the mutation commit, including revocation during SQL. */
export async function lockNotificationExecution(tx:Queryable,input:MutationNotificationJobInput):Promise<void>{
 const principal=input.initiator.principal;
 if(principal.kind==='token')await tx.query('SELECT id FROM tokens WHERE id=$1 FOR SHARE',[principal.id]);
 if(input.bindings.userId)await tx.query('SELECT id FROM users WHERE id=$1 FOR SHARE',[input.bindings.userId]);
 await notificationExecutionFence(tx,input);
}
/** Author delegation matches saved-document reads; V2 grants always use the actual initiator. */
export async function notificationExecutionSource(tx:Queryable,input:MutationNotificationJobInput,id:string):Promise<NotificationArtifactAuthority>{
 const principal=await notificationPrincipal(tx,input.initiator.principal),document=await notificationArtifactAuthority(tx,input.origin.documentId),source=await notificationArtifactAuthority(tx,id);
 if(!readable(document,principal)||source.row.format!=='dataset')throw denied();
 if(policyOf(source.row)){if(!sourceReadable(source,document,principal))throw denied();}
 else{
  const user=document.row.user_id?await account(tx,document.row.user_id):null;
  const publisher:Identity={actor:{userId:document.row.user_id,tokenId:document.row.token_id,email:user?.email},kind:user?.kind??null,revision:''};
  if(!readable(source,publisher))throw denied();
 }
 return source;
}
export function notificationSourceSchema(authority:NotificationArtifactAuthority,schema:string,table:string):string {
 const catalog=catalogOf(authority.row),relation=catalog?.kind==='stored'&&catalog.defaultSchema===schema?importedTables(catalog).find(item=>item.name===table):null;
 if(!relation)throw new NotificationExecutionError('notification_schema_changed');
 return hash(relation.columns);
}
async function disclosureContext(tx:Queryable,documentId:string,sources:NotificationSource[]){
 const document=await notificationArtifactAuthority(tx,documentId);
 if(document.row.format!=='markup')throw denied();
 const loaded=new Map<string,NotificationArtifactAuthority>();
 for(const source of sources){
  let authority=loaded.get(source.artifactId);
  if(!authority){authority=await notificationArtifactAuthority(tx,source.artifactId);loaded.set(source.artifactId,authority);}
  notificationSourceSchema(authority,source.schema,source.table);
 }
 return {document,sources:[...loaded.values()]};
}
async function admitRecipients(tx:Queryable,input:MutationNotificationJobInput,plan:MutationNotificationPlan,ids:string[]):Promise<string[]>{
 const context=await disclosureContext(tx,input.origin.documentId,plan.sources);
 const users=(await tx.query<Account>("SELECT id,email,kind,expires_at FROM users WHERE id=ANY($1::text[]) AND (expires_at IS NULL OR expires_at>now()) AND merged_into_user_id IS NULL",[ids])).rows;
 return users.filter(user=>{
  const identity:Identity={actor:{userId:user.id,tokenId:null,email:user.email},kind:user.kind,revision:''};
  return user.kind!=='guest'&&readable(context.document,identity)&&context.sources.every(source=>sourceReadable(source,context.document,identity));
 }).map(user=>user.id);
}
export async function notificationSourcesReadable(tx:Queryable,documentId:string,recipientId:string,sources:NotificationSource[]):Promise<boolean>{
 try{
  const user=await account(tx,recipientId);if(!user||user.kind==='guest')return false;
  const context=await disclosureContext(tx,documentId,sources),identity:Identity={actor:{userId:user.id,tokenId:null,email:user.email},kind:user.kind,revision:''};
  return readable(context.document,identity)&&context.sources.every(source=>sourceReadable(source,context.document,identity));
 }catch(error){if(error instanceof NotificationExecutionError)return false;throw error;}
}
export async function validateNotificationPlan(tx:Queryable,input:MutationNotificationJobInput,plan:MutationNotificationPlan):Promise<void>{
 const {flow,rule}=notificationQueryContext(input);
 const expected=rule.relations.filter(relation=>relation.schema!=='main').map(relation=>{
  const source=flow.imports.find(item=>item.name===relation.schema);
  if(!source)throw new NotificationExecutionError('notification_context_invalid');
  return [source.ref,relation.table].join(':');
 }).sort();
 if(JSON.stringify(expected)!==JSON.stringify(plan.sources.map(source=>[source.artifactId,source.table].join(':')).sort()))throw new NotificationExecutionError('notification_context_invalid');
 const fence=await notificationExecutionFence(tx,input);
 if(JSON.stringify(fence)!==JSON.stringify(plan.executionFence))throw new NotificationExecutionError('notification_authority_changed',true);
 for(const source of plan.sources){
  const authority=await notificationExecutionSource(tx,input,source.artifactId);
  if(notificationSourceSchema(authority,source.schema,source.table)!==source.schemaRevision)throw new NotificationExecutionError('notification_schema_changed');
  if(authority.revision!==source.authorityRevision)throw new NotificationExecutionError('notification_authority_changed',true);
 }
}
export async function canManageNotificationDocument(tx:Queryable,principal:MutationInitiator['principal'],documentId:string):Promise<boolean>{
 try{
  const identity=await notificationPrincipal(tx,principal),authority=await notificationArtifactAuthority(tx,documentId),{row,shares}=authority;
  if(row.format!=='markup')return false;
  if(owner(row,identity.actor))return true;
  if(identity.kind!=='account')return false;
  return hasDocumentEditorAccess(identity.actor)||(row.visibility!=='private'&&row.link_role==='editor')||shares.some(share=>share.role==='editor'&&(share.user_id?share.user_id===identity.actor.userId:!!identity.actor.email&&share.email===identity.actor.email));
 }catch(error){if(error instanceof NotificationExecutionError)return false;throw error;}
}
export const notificationAuthority={validatePlan:validateNotificationPlan,admitRecipients,canManage:canManageNotificationDocument};
