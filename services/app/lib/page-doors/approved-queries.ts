/**
 * A PAGE'S DECLARED QUERY ON THE DEFAULT CONNECTION at the page SQL door (`{query, params}`), and who it runs as: the
 * reader, unless the reader reads as the group (a signed-in ordinary account that can open the page: lib/query-approvals
 * `readsAsGroup`) and an approval holds for exactly the query of the version read (`approvedRun`). Then it runs as an
 * agent signed in as the page's owning group at member level (lib/connections `groupViewer`), the reader's own identity
 * never sent as the reader; a parameter outside what the approval allows is refused, saying the value is not allowed
 * for this query, never run as the reader instead. Only a declared query, read by name from the version, ever runs as
 * the group: a reader's own `sql` always runs as the reader. The approval is asked again after the read, so one revoked
 * meanwhile never answers. Anonymous readers are refused, as everywhere on the default connection. Every read run as
 * the group is recorded (contracts events `approved_query_read`): the real reader as its subject, the approval, query,
 * hash, connection and group in its payload, never the reader's values; best-effort, as every observational event
 * (lib/platform `emit`).
 */
import {sqlReadFailure,type HtmlPageVersion} from '@artifactbin/contracts';
import type {AccessActor} from '@/lib/accounts';
import {VIEWER_PARAMS,connectorViewer,declaredConnectionQuery,groupViewer,runDeclaredConnectionQuery,type ConnectionSqlReply} from '@/lib/connections';
import {approvedRun,pageOwnerName,paramsOutside,readsAsGroup} from '@/lib/query-approvals';
import {actorSubject,emit} from '@/lib/platform';

type Admission={step<T>(pending:Promise<T>):Promise<T>;dispatch(read:boolean):AbortSignal};

export async function pageDeclaredConnectionSql(actor:AccessActor,page:HtmlPageVersion,head:HtmlPageVersion,raw:{query?:unknown;params?:unknown},signal:AbortSignal,admission:Admission):Promise<ConnectionSqlReply|null>{
 const declared=raw.query===undefined?null:declaredConnectionQuery(page,raw.query);
 if(!declared)return null;
 const viewer=await admission.step(connectorViewer(actor));
 if(!viewer)return sqlReadFailure('sign_in_required',`sign in to read ${declared.link.name}: the default connection answers signed-in people only`);
 const approval=await admission.step(approvedRun(page.pageId,head,declared,actor));
 if(!approval)return runDeclaredConnectionQuery(viewer,declared,raw.params,signal,admission);
 const outside=paramsOutside(declared.query.params,raw.params,VIEWER_PARAMS);
 // Said as it is: the value is not one this query takes, whatever the reader's own access.
 if(outside){const refused=sqlReadFailure('permission_denied',outside);return {...refused,body:{...refused.body,notice:outside.charAt(0).toUpperCase()+outside.slice(1)}};}
 const reply=await runDeclaredConnectionQuery(groupViewer(approval.groupId,'member'),declared,raw.params,signal,admission);
 // Revoked, edited or no longer the group's while it ran: the door reads again, as the reader.
 if((await admission.step(approvedRun(page.pageId,head,declared,actor)))?.id!==approval.id)throw new Error('dataset_changed');
 void emit(actorSubject(actor),'approved_query_read',{kind:'artifact',id:page.pageId},{approval_id:approval.id,query:declared.query.name,query_hash:approval.hash,connection:approval.connection,group_id:approval.groupId});
 return reply;
}

/** The default refusal's sentence (contracts sql-failures), which names nobody. */
const NAMELESS=sqlReadFailure('permission_denied','').body.notice;
/**
 * A read of the default connection refused for this reader with the default sentence names whom to ask, the page's
 * owning group or the person who owns it (contracts sql-failures `permission_denied`), to a reader who reads as the
 * group (lib/query-approvals `readsAsGroup`: a signed-in ordinary account, which the door admitted to the page) only;
 * anyone else keeps the sentence that names nobody. Every other reply as it was.
 */
export async function namingOwner(reply:ConnectionSqlReply,owner:{group_id?:string|null;user_id?:string|null},reader:AccessActor):Promise<ConnectionSqlReply>{
 if(reply.body.error!=='permission_denied'||reply.body.notice!==NAMELESS||!await readsAsGroup(reader))return reply;
 const name=await pageOwnerName(owner);
 return name?{...reply,body:{...reply.body,notice:`You don't have access to this data. Ask ${name}, who owns this page, for access.`}}:reply;
}
