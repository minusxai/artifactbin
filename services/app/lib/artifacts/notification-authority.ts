/** Transaction-only authorization shared by query execution, result commit and disclosure. */
import {getGroupRole} from '../groups';
import {notificationRuleSourceIds,notificationRevision as hash} from '@/lib/notifications/context';
import {explicitNotificationMemberships} from '@/lib/notifications/membership';
import {grantsOf,grantsPermitRead,readThrough,type ReadRow} from '@/lib/artifacts/dataset-policy/grants';
import {liveAccessFacts,preloadAccessFacts,type AccessFacts} from './access-facts';
import type {MutationNotificationJobInput,MutationNotificationPlan,NotificationSource,Queryable,MutationInitiator} from '@artifactbin/contracts';
import type { ArtifactRow } from './access';
import type { RoleActor } from '@/lib/accounts';
import {hasDocumentEditorAccess} from './document-policy';
import {catalogOf} from '@/lib/datasets/catalog';
import {PUBLIC_BASE_URL} from '@/lib/platform/config';
import {NotificationExecutionError} from '@/lib/notifications/errors';
import {resolveDatasetConnection} from '@/lib/datasets/secrets';
import {DatasetError} from '@/lib/datasets/errors';

interface Account {id:string;email:string|null;kind:string;expires_at:string|null}
interface LiveToken {id:string;user_id:string|null;expires_at:string|null;audience:string|null;scope:string|null}
interface Identity {actor:RoleActor;kind:string|null;revision:string}
interface Share {user_id:string|null;email:string;role:string}
interface NotificationArtifactAuthority {row:ArtifactRow;shares:Share[];revision:string}
const denied=()=>new NotificationExecutionError('notification_access_revoked');
const owner=(row:ArtifactRow,actor:RoleActor)=>!row.group_id&&(row.user_id?row.user_id===actor.userId:row.token_id===actor.tokenId);
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
 return {row,shares,revision:hash([row.id,row.format,row.user_id,row.group_id,row.token_id,row.visibility,row.link_role,row.sharing_revision??0,row.policy_revision??0,row.dataset_policy??null,shares])};
}
/**
 * The fields readability consults: never the document graph, and `meta` (large on a document) only
 * for datasets — a source that is not a dataset is unreadable whatever its metadata says.
 */
type ReadableArtifact = ReadRow & Pick<ArtifactRow,'meta'>;
const READABLE_COLUMNS="id,token_id,user_id,group_id,format,visibility,link_role,dataset_policy,policy_revision,sharing_revision,CASE WHEN format='dataset' THEN meta END AS meta";
/** A connection-backed source needs its bound credential; a missing or unreadable one revokes access. */
async function connectionAvailable(tx:Queryable,row:ReadableArtifact):Promise<void>{
 const connection=catalogOf(row)?.connection;
 if(connection){try{await resolveDatasetConnection(connection,undefined,row.id,tx);}catch(error){if(error instanceof DatasetError)throw denied();throw error;}}
}
async function sourceReadable(tx:Queryable,source:{row:ReadableArtifact},document:{row:ReadRow},identity:Identity,facts:AccessFacts=liveAccessFacts(identity.actor,tx),connection:(row:ReadableArtifact)=>Promise<void>=row=>connectionAvailable(tx,row)):Promise<boolean>{
 if(source.row.format!=='dataset'||!await readThrough(tx,document.row,identity.actor,facts))return false;
 await connection(source.row);
 return grantsOf(source.row)?grantsPermitRead(source.row,identity.actor,document.row,tx,facts):readThrough(tx,source.row,identity.actor,facts);
}
export async function notificationExecutionFence(tx:Queryable,input:MutationNotificationJobInput):Promise<MutationNotificationPlan['executionFence']>{
 const principal=await notificationPrincipal(tx,input.initiator.principal),document=await notificationArtifactAuthority(tx,input.origin.documentId);
 if(principal.actor.userId!==input.bindings.userId||document.row.format!=='markup'||!await readThrough(tx,document.row,principal.actor))throw denied();
 return {principalRevision:principal.revision,documentRevision:document.revision,contextRevision:input.contextRevision};
}
/** Fence the initiating credential through the mutation commit, including revocation during SQL. */
export async function lockNotificationExecution(tx:Queryable,input:MutationNotificationJobInput):Promise<void>{
 const principal=input.initiator.principal;
 if(principal.kind==='token')await tx.query('SELECT id FROM tokens WHERE id=$1 FOR SHARE',[principal.id]);
 if(input.bindings.userId)await tx.query('SELECT id FROM users WHERE id=$1 FOR SHARE',[input.bindings.userId]);
 await notificationExecutionFence(tx,input);
}
/** Generic exposed schema and connection binding; row content/refresh timestamps are not authority. */
export function notificationSourceSchema(authority:{row:Pick<ArtifactRow,'meta'>}):string {
 const catalog=catalogOf(authority.row);
 if(!catalog)throw new NotificationExecutionError('notification_schema_changed');
 const {kind,defaultSchema,connection,notebook,notebookSources}=catalog;
 return hash({kind,defaultSchema,connection,notebook,notebookSources,tables:catalog.tables.map(({objectKey:_,...table})=>table)});
}
export async function notificationExecutionSource(tx:Queryable,input:MutationNotificationJobInput,id:string):Promise<NotificationArtifactAuthority & {receipt:NotificationSource}>{
 const principal=await notificationPrincipal(tx,input.initiator.principal),document=await notificationArtifactAuthority(tx,input.origin.documentId),source=await notificationArtifactAuthority(tx,id);
 if(principal.actor.userId!==input.bindings.userId||!await sourceReadable(tx,source,document,principal))throw denied();
 return {...source,receipt:{artifactId:id,authorityRevision:source.revision,schemaRevision:notificationSourceSchema(source)}};
}
export async function notificationSourcesReadable(tx:Queryable,documentId:string,recipientId:string,sources:NotificationSource[]):Promise<boolean>{
 return (await notificationSourcesReadableMany(tx,recipientId,[{documentId,sources}]))[0]===true;
}
/**
 * May `recipientId` still read each saved notification — its document and every source behind it?
 * The one decision for delivery, admission and the inbox, made for any number of items in a fixed
 * number of statements (plus one credential check per distinct connection-backed source).
 */
export async function notificationSourcesReadableMany(tx:Queryable,recipientId:string,items:ReadonlyArray<{documentId:string;sources:NotificationSource[]}>):Promise<boolean[]>{
 const user=await account(tx,recipientId);
 if(!user||user.kind==='guest')return items.map(()=>false);
 const members=await explicitNotificationMemberships(tx,items.map(item=>item.documentId),recipientId);
 const ids=[...new Set(items.flatMap(item=>members.has(item.documentId)?[item.documentId,...item.sources.map(source=>source.artifactId)]:[]))];
 const rows=new Map((ids.length?(await tx.query<ReadableArtifact>(`SELECT ${READABLE_COLUMNS} FROM artifacts WHERE id=ANY($1::text[]) AND deleted_at IS NULL`,[ids])).rows:[]).map(row=>[row.id,row]));
 const identity:Identity={actor:{userId:user.id,tokenId:null,email:user.email},kind:user.kind,revision:''};
 const facts=await preloadAccessFacts(tx,identity.actor,[...rows.values()]),connections=new Map<string,Promise<void>>();
 const connection=(row:ReadableArtifact)=>{
  let checked=connections.get(row.id);
  if(!checked){checked=connectionAvailable(tx,row);checked.catch(()=>undefined);connections.set(row.id,checked);}
  return checked;
 };
 const readable=async(documentId:string,sources:NotificationSource[]):Promise<boolean>=>{
  try{
   const document=rows.get(documentId);if(!document)throw denied();
   if(document.format!=='markup'||!await readThrough(tx,document,identity.actor,facts))return false;
   for(const source of sources){
    const row=rows.get(source.artifactId);if(!row)throw denied();
    if(notificationSourceSchema({row})!==source.schemaRevision||!await sourceReadable(tx,{row},{row:document},identity,facts,connection))return false;
   }
   return true;
  }catch(error){if(error instanceof NotificationExecutionError)return false;throw error;}
 };
 const decided:boolean[]=[];
 for(const item of items)decided.push(members.has(item.documentId)&&await readable(item.documentId,item.sources));
 await facts.settle();
 return decided;
}
async function admitRecipients(tx:Queryable,input:MutationNotificationJobInput,plan:MutationNotificationPlan,ids:string[]):Promise<string[]>{
 const admitted:string[]=[];
 for(const id of ids){
  const sources=plan.rules.filter(rule=>rule.rows.some(row=>row.recipientIds.includes(id))).flatMap(rule=>rule.sources);
  if(await notificationSourcesReadable(tx,input.origin.documentId,id,sources))admitted.push(id);
 }
 return admitted;
}
async function validateNotificationPlan(tx:Queryable,input:MutationNotificationJobInput,plan:MutationNotificationPlan):Promise<void>{
 const names=input.rules.map(rule=>rule.name).sort();
 if(JSON.stringify(names)!==JSON.stringify(plan.rules.map(rule=>rule.ruleName).sort()))throw new NotificationExecutionError('notification_context_invalid');
 const fence=await notificationExecutionFence(tx,input);
 if(JSON.stringify(fence)!==JSON.stringify(plan.executionFence))throw new NotificationExecutionError('notification_authority_changed',true);
 for(const rule of plan.rules){
  const expected=notificationRuleSourceIds(input,rule.ruleName).sort();
  if(JSON.stringify(expected)!==JSON.stringify(rule.sources.map(source=>source.artifactId).sort()))throw new NotificationExecutionError('notification_context_invalid');
  for(const source of rule.sources){
   const current=await notificationExecutionSource(tx,input,source.artifactId);
   if(current.receipt.schemaRevision!==source.schemaRevision)throw new NotificationExecutionError('notification_schema_changed');
   if(current.receipt.authorityRevision!==source.authorityRevision)throw new NotificationExecutionError('notification_authority_changed',true);
  }
 }
}
async function canManageNotificationDocument(tx:Queryable,principal:MutationInitiator['principal'],documentId:string):Promise<boolean>{
 try{
  const identity=await notificationPrincipal(tx,principal),authority=await notificationArtifactAuthority(tx,documentId),{row,shares}=authority;
  if(row.format!=='markup')return false;
  if(owner(row,identity.actor)||row.group_id&&await getGroupRole(identity.actor.userId,row.group_id,tx)==='editor')return true;
  if(identity.kind!=='account')return false;
  return hasDocumentEditorAccess(identity.actor)||(row.visibility!=='private'&&row.link_role==='editor')||shares.some(share=>share.role==='editor'&&(share.user_id?share.user_id===identity.actor.userId:!!identity.actor.email&&share.email===identity.actor.email));
 }catch(error){if(error instanceof NotificationExecutionError)return false;throw error;}
}
export const notificationAuthority={validatePlan:validateNotificationPlan,admitRecipients,canManage:canManageNotificationDocument};
