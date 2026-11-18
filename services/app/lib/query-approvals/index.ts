/**
 * APPROVED QUERIES: a page's declared query on the install's default connection (contracts `HtmlDeclaredQuery` on a
 * `default:` link) that an Admin of the group owning the page approved to run AS THAT GROUP, at member level, for every
 * reader who can open the page. Without one, nothing changes: a page's queries run as the reader, whose own access to
 * the data decides what they get. Server-only.
 *
 * WHO APPROVES: a person who is an Admin of the group that owns the page (direct, or through an ancestor: the
 * `group_admins` view), and only that. A person-owned page has no approvals; an Editor or Member, an agent signed in as
 * a group, a workload and a test account never approve.
 *
 * WHAT IS COVERED, exactly: the query's text, the connection it runs on (`default:` and the link's namespace) and what a
 * reader may vary in it (`data-af-params`), normalised and hashed (`queryApprovalHash`). Nothing else about the page.
 * The Admin approves the hash they were shown; another one is refused (`query_changed`), so an edit made meanwhile is
 * never approved unseen.
 *
 * WHEN IT HOLDS, asked at every read (`approvedRun`, again after the read: lib/page-doors): the approval is not ended;
 * the version read and the page's head both declare that hash; the page is still that group's; the approver is still
 * its Admin and an active account. Every way it stops ENDS it for good, until a fresh approval: a write of the page that
 * no longer declares an approved hash (`endQueryApprovals`, from lib/artifacts' head write: reverting the text does not
 * bring it back), moving the page to another owner, a revoke; and the approver losing Admin or the group being deleted
 * (`endStaleApprovals`: from lib/groups after every group change the app makes, and at the first read that finds one
 * no longer holding, whoever changed it), so being made Admin again, or the group's row coming back, revives nothing.
 *
 * Every approval and every end is audited (contracts events `query_approved`, `query_approval_ended`: who, the page, the
 * query's name and hash, the connection, the group; `at` is when), and so is every read it answered
 * (`approved_query_read`, lib/page-doors: the real reader as subject, the approval in the payload).
 */
import {createHash} from 'node:crypto';
import type {HtmlDeclaredQuery,HtmlDefaultConnectionLink,HtmlPageLink,HtmlQueryParams,Queryable} from '@artifactbin/contracts';
import type {AccessActor} from '@/lib/accounts';
import {actorSubject,generateInternalId,getDb,recordEvent} from '@/lib/platform';

export class QueryApprovalError extends Error {
 constructor(readonly status:number,readonly code:string,message:string){super(message);this.name='QueryApprovalError';}
 get body(){return {error:this.code,message:this.message};}
}

/** The connection a default-connection link reads, as an approval names it. */
const connectionName=(link:Pick<HtmlDefaultConnectionLink,'namespace'>):string=>`default:${link.namespace}`;
/** What a reader may vary, in one order: names sorted; a list's values deduplicated and sorted. */
function canonicalParams(params:HtmlQueryParams={}):unknown[]{
 return Object.keys(params).sort().map(name=>{const allowed=params[name]!;return 'type' in allowed?[name,allowed.type]:[name,[...new Set(allowed.values.map(value=>JSON.stringify(value)))].sort()];});
}
/**
 * THE APPROVAL'S HASH: sha256 of the normalised triple, the query's text (line endings made `\n`, ends trimmed; never
 * its inside, whose spaces may be data), its connection and its allowed parameters. The connection is the link's
 * namespace and its name too: the run removes `NAME.` qualifiers from the text (lib/connections), so a renamed link
 * would run a different statement.
 */
function queryApprovalHash(query:Pick<HtmlDeclaredQuery,'sql'|'params'>,link:Pick<HtmlDefaultConnectionLink,'namespace'|'name'>):string{
 return createHash('sha256').update(JSON.stringify([query.sql.replace(/\r\n?/g,'\n').trim(),connectionName(link),link.name.toLowerCase(),canonicalParams(query.params)])).digest('hex');
}
interface Declared {query:HtmlDeclaredQuery;link:HtmlDefaultConnectionLink;hash:string}
/** A version's declared queries on its default-connection links, each with its hash. */
function declaredOn(version:{links:readonly HtmlPageLink[];queries:readonly HtmlDeclaredQuery[]}):Declared[]{
 return version.queries.flatMap(query=>{
  const link=version.links.find((l):l is HtmlDefaultConnectionLink=>l.kind==='default-connection'&&l.name===query.link);
  return link?[{query,link,hash:queryApprovalHash(query,link)}]:[];
 });
}
const ofMeta=(meta:Record<string,unknown>)=>declaredOn({links:(meta.htmlLinks??[]) as HtmlPageLink[],queries:(meta.htmlQueries??[]) as HtmlDeclaredQuery[]});

interface ApprovalRow {id:string;page_id:string;query_name:string;query_hash:string;connection:string;group_id:string;approved_by:string;created_at:string}
/** The live approvals of `page` that hold now (see the header), newest first; `hash` narrows to one triple. */
async function holding(db:Queryable,page:string,hash?:string):Promise<ApprovalRow[]>{
 return (await db.query<ApprovalRow>(`SELECT a.id,a.page_id,a.query_name,a.query_hash,a.connection,a.group_id,a.approved_by,a.created_at FROM page_query_approvals a
   JOIN artifacts p ON p.id=a.page_id AND p.deleted_at IS NULL AND p.format='html' AND p.group_id=a.group_id
  WHERE a.page_id=$1 AND a.ended_at IS NULL AND ($2::text IS NULL OR a.query_hash=$2)
    AND EXISTS (SELECT 1 FROM group_admins ga WHERE ga.group_id=a.group_id AND ga.user_id=a.approved_by)
    AND EXISTS (SELECT 1 FROM users u WHERE u.id=a.approved_by AND u.active AND NOT u.test_account)
  ORDER BY a.created_at DESC,a.id`,[page,hash??null])).rows;
}

/**
 * THE READ'S QUESTION (lib/page-doors): does an approval hold for `declared`, the query of the version read, with the
 * page's `head`? The approval's id and group, or null (the read runs as the reader).
 */
export async function approvedRun(pageId:string,head:{links:readonly HtmlPageLink[];queries:readonly HtmlDeclaredQuery[]},declared:{query:HtmlDeclaredQuery;link:HtmlDefaultConnectionLink}):Promise<{id:string;groupId:string;hash:string;connection:string}|null>{
 const hash=queryApprovalHash(declared.query,declared.link);
 if(!declaredOn(head).some(entry=>entry.hash===hash))return null;
 const db=await getDb();
 const row=(await holding(db,pageId,hash))[0];
 if(row)return {id:row.id,groupId:row.group_id,hash,connection:row.connection};
 // A live approval that no longer holds (its approver is no Admin, its group is gone): ended now, so nothing revives it.
 if((await db.query('SELECT 1 FROM page_query_approvals WHERE page_id=$1 AND query_hash=$2 AND ended_at IS NULL LIMIT 1',[pageId,hash])).rows.length)
  await db.transaction(async tx=>{await tx.query('SELECT id FROM artifacts WHERE id=$1 FOR SHARE',[pageId]);await endStaleApprovals(tx,null,pageId);});
 return null;
}

const DATE=/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
/**
 * Why `sent` is not what `allowed` lets a reader vary (one sentence), or null when it is. `server` names the values the
 * server fills itself (lib/connections `VIEWER_PARAMS`), refused by the run, not judged here.
 */
export function paramsOutside(allowed:HtmlQueryParams={},sent:unknown,server:readonly string[]):string|null{
 if(sent===undefined)return null;
 if(!sent||typeof sent!=='object'||Array.isArray(sent))return 'params must be an object of scalars';
 for(const [name,value] of Object.entries(sent)){
  if(server.includes(name))continue;
  const rule=allowed[name];
  if(!rule)return `this query's approval does not let a reader set ${name}`;
  const fits='values' in rule?rule.values.some(entry=>entry===value):rule.type==='text'?typeof value==='string':rule.type==='number'?typeof value==='number'&&Number.isFinite(value)
   :rule.type==='boolean'?typeof value==='boolean':typeof value==='string'&&DATE.test(value)&&!Number.isNaN(Date.parse(value));
  if(!fits)return `this query's approval does not allow that value of ${name}`;
 }
 return null;
}

/** Who the reader asks for access: the owning group's name, or the owning person's name. */
export async function pageOwnerName(page:{group_id?:string|null;user_id?:string|null}):Promise<string|null>{
 const db=await getDb();
 if(page.group_id)return (await db.query<{name:string|null}>('SELECT name FROM groups WHERE id=$1',[page.group_id])).rows[0]?.name??null;
 if(!page.user_id)return null;
 const person=(await db.query<{name:string|null;username:string|null}>('SELECT name,username FROM users WHERE id=$1',[page.user_id])).rows[0];
 return person?.name||person?.username||null;
}

interface PageRow {id:string;group_id:string|null;user_id:string|null;format:string;meta:Record<string,unknown>}
/**
 * The page, for an Admin of its owning group, and that group's name. Refused: a caller who is no person (a group's
 * agent, a workload, nobody) `forbidden`; a person-owned page `not_group_owned` to its owner; anyone in the group who is
 * not its Admin `forbidden`; everyone else the uniform `not_found`.
 */
async function adminPage(db:Queryable,actor:AccessActor,pageId:string,lock=false):Promise<{page:PageRow;group:string}>{
 if(!actor.userId||actor.principalGroup||actor.workload)throw new QueryApprovalError(403,'forbidden','only a person who is an Admin of the group that owns the page approves its queries');
 // The page row first, FOR SHARE when deciding a write (lib/artifact-access locks.ts, step 1); identity is never locked.
 if(lock)await db.query('SELECT id FROM artifacts WHERE id=$1 FOR SHARE',[pageId]);
 const page=(await db.query<PageRow>('SELECT id,group_id,user_id,format,meta FROM artifacts WHERE id=$1 AND deleted_at IS NULL',[pageId])).rows[0];
 if(!page||page.format!=='html')throw new QueryApprovalError(404,'not_found','not found');
 if(!page.group_id){
  if(page.user_id===actor.userId)throw new QueryApprovalError(400,'not_group_owned','a page owned by a person has no approved queries: move it to a group, whose Admins may approve them');
  throw new QueryApprovalError(404,'not_found','not found');
 }
 const role=(await db.query<{admin:boolean;member:boolean;name:string}>(`SELECT g.name,EXISTS (SELECT 1 FROM group_admins ga WHERE ga.group_id=g.id AND ga.user_id=$2) AS admin,
   EXISTS (SELECT 1 FROM group_members m WHERE m.group_id=g.id AND m.user_id=$2) AS member FROM groups g WHERE g.id=$1 AND g.deleted_at IS NULL`,[page.group_id,actor.userId])).rows[0];
 if(role?.admin)return {page,group:role.name};
 throw role?.member?new QueryApprovalError(403,'forbidden','only an Admin of the group that owns this page approves its queries'):new QueryApprovalError(404,'not_found','not found');
}

/** What readers will be able to see once `declared` is approved, in one plain statement. */
function statementOf(declared:Declared,group:string):string{
 const allowed=Object.entries(declared.query.params??{}).map(([name,rule])=>'values' in rule?`${name} (one of ${rule.values.map(value=>String(value)).join(', ')})`:`${name} (any ${rule.type})`);
 return `Everyone who can open this page will see what ${declared.query.name} returns when ${group} reads it as a member, whatever their own access to this data. `+
  (allowed.length?`They may choose ${allowed.join(' and ')}; any other value is refused. `:'They cannot change anything in it. ')+
  `Changing its text, its connection or what readers may vary ends the approval.`;
}

export interface QueryApprovalView {
 name:string;connection:string;sql:string;params:HtmlQueryParams;hash:string;statement:string;
 approval:{id:string;approved_by:{id:string;name:string|null;username:string|null};approved_at:string}|null;
}
/** For an Admin of the owning group: each declared query of the page's head on a default-connection link, and its approval if one holds. */
export async function pageQueryApprovals(actor:AccessActor,pageId:string):Promise<{group:{id:string;name:string};queries:QueryApprovalView[]}>{
 const db=await getDb();
 const {page,group}=await adminPage(db,actor,pageId);
 const live=await holding(db,pageId);
 const people=new Map((await db.query<{id:string;name:string|null;username:string|null}>('SELECT id,name,username FROM users WHERE id=ANY($1::text[])',[[...new Set(live.map(row=>row.approved_by))]])).rows.map(row=>[row.id,row]));
 return {group:{id:page.group_id!,name:group},queries:ofMeta(page.meta).map(declared=>{
  const held=live.find(row=>row.query_hash===declared.hash);
  const by=held&&people.get(held.approved_by);
  return {name:declared.query.name,connection:connectionName(declared.link),sql:declared.query.sql,params:declared.query.params??{},hash:declared.hash,statement:statementOf(declared,group),
   approval:held?{id:held.id,approved_by:{id:held.approved_by,name:by?.name??null,username:by?.username??null},approved_at:new Date(held.created_at).toISOString()}:null};
 })};
}

type EndReason='revoked'|'edited'|'moved'|'replaced'|'approver_not_admin'|'group_deleted';
const payload=(row:Pick<ApprovalRow,'id'|'query_name'|'query_hash'|'connection'|'group_id'>,reason?:EndReason)=>
 ({approval_id:row.id,query:row.query_name,query_hash:row.query_hash,connection:row.connection,group_id:row.group_id,...(reason?{reason}:{})});

/** An Admin of the owning group approves the head's declared query `query` whose hash they were shown (`hash`). Audited. */
export async function approvePageQuery(actor:AccessActor,pageId:string,input:{query?:unknown;hash?:unknown}):Promise<{id:string;query:string;hash:string;connection:string}>{
 if(typeof input.query!=='string'||typeof input.hash!=='string')throw new QueryApprovalError(400,'validation_failed','send {query, hash}: the declared query\'s name and the hash you were shown');
 const db=await getDb();
 return db.transaction(async tx=>{
  const {page}=await adminPage(tx,actor,pageId,true);
  if((await tx.query<{test_account:boolean}>('SELECT test_account FROM users WHERE id=$1',[actor.userId])).rows[0]?.test_account)throw new QueryApprovalError(403,'test_account_restricted','a test account approves nothing');
  const declared=ofMeta(page.meta).find(entry=>entry.query.name===input.query);
  if(!declared)throw new QueryApprovalError(404,'unknown_query',`this page declares no query on a default: link named ${JSON.stringify(String(input.query).slice(0,64))}`);
  if(declared.hash!==input.hash)throw new QueryApprovalError(409,'query_changed',`${declared.query.name} changed since you looked at it: read it again before approving`);
  const replaced=(await tx.query<ApprovalRow>(`UPDATE page_query_approvals SET ended_at=now(),ended_by=$3,ended_reason='replaced' WHERE page_id=$1 AND query_name=$2 AND ended_at IS NULL RETURNING *`,[pageId,declared.query.name,actor.userId])).rows;
  for(const row of replaced)await recordEvent(tx,actorSubject(actor),'query_approval_ended',{kind:'artifact',id:pageId},payload(row,'replaced'));
  const row={id:`pqa_${generateInternalId()}`,query_name:declared.query.name,query_hash:declared.hash,connection:connectionName(declared.link),group_id:page.group_id!};
  await tx.query('INSERT INTO page_query_approvals (id,page_id,query_name,query_hash,connection,group_id,approved_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',[row.id,pageId,row.query_name,row.query_hash,row.connection,row.group_id,actor.userId]);
  await recordEvent(tx,actorSubject(actor),'query_approved',{kind:'artifact',id:pageId},payload(row));
  return {id:row.id,query:row.query_name,hash:row.query_hash,connection:row.connection};
 });
}

/** An Admin of the owning group revokes approval `id` of the page: it ends at once. Audited; false when none was live. */
export async function revokePageQuery(actor:AccessActor,pageId:string,id:string):Promise<boolean>{
 const db=await getDb();
 return db.transaction(async tx=>{
  await adminPage(tx,actor,pageId,true);
  const ended=(await tx.query<ApprovalRow>(`UPDATE page_query_approvals SET ended_at=now(),ended_by=$3,ended_reason='revoked' WHERE page_id=$1 AND id=$2 AND ended_at IS NULL RETURNING *`,[pageId,id,actor.userId])).rows;
  for(const row of ended)await recordEvent(tx,actorSubject(actor),'query_approval_ended',{kind:'artifact',id:pageId},payload(row,'revoked'));
  return ended.length>0;
 });
}

/**
 * Ends, inside the writer's transaction (which holds the page rows FOR UPDATE), live approvals, audited as that writer's:
 * of `pageId`, every one its new head no longer declares (`edited`: `head` is the written row; one that is not a page
 * declares none); of each of `pageId`, every one (`moved`: the pages went to another owner).
 */
export async function endQueryApprovals(tx:Queryable,actor:Pick<AccessActor,'userId'|'tokenId'|'principalGroup'>,pageId:string|readonly string[],reason:'edited'|'moved',head?:{format:string;meta:Record<string,unknown>}):Promise<void>{
 const kept=reason==='edited'&&head?.format==='html'?ofMeta(head.meta).map(entry=>entry.hash):[];
 const ended=(await tx.query<ApprovalRow>(`UPDATE page_query_approvals SET ended_at=now(),ended_by=$3,ended_reason=$4 WHERE page_id=ANY($1::text[]) AND ended_at IS NULL AND NOT (query_hash=ANY($2::text[])) RETURNING *`,[typeof pageId==='string'?[pageId]:[...pageId],kept,actor.userId,reason])).rows;
 for(const row of ended)await recordEvent(tx,actorSubject(actor),'query_approval_ended',{kind:'artifact',id:row.page_id},payload(row,reason));
}

/**
 * Ends, audited (`subject`: who made the change, or null when a read found it), every live approval (of `pageId`, or of
 * every page) whose group is deleted (`group_deleted`), whose page is no longer that group's (`moved`), or whose
 * approver is no longer its Admin or no longer an active account (`approver_not_admin`). A page in the trash keeps its
 * approvals, as it keeps everything else, until it is restored or purged.
 */
export async function endStaleApprovals(tx:Queryable,subject:string|null,pageId?:string):Promise<void>{
 const ended=(await tx.query<ApprovalRow&{ended_reason:EndReason}>(`WITH stale AS (
   SELECT a.id,CASE WHEN NOT EXISTS (SELECT 1 FROM groups g WHERE g.id=a.group_id AND g.deleted_at IS NULL) THEN 'group_deleted'
     WHEN NOT EXISTS (SELECT 1 FROM artifacts p WHERE p.id=a.page_id AND p.group_id=a.group_id) THEN 'moved' ELSE 'approver_not_admin' END AS reason
   FROM page_query_approvals a WHERE a.ended_at IS NULL AND ($1::text IS NULL OR a.page_id=$1) AND NOT (
    EXISTS (SELECT 1 FROM groups g WHERE g.id=a.group_id AND g.deleted_at IS NULL)
    AND EXISTS (SELECT 1 FROM artifacts p WHERE p.id=a.page_id AND p.group_id=a.group_id)
    AND EXISTS (SELECT 1 FROM group_admins ga WHERE ga.group_id=a.group_id AND ga.user_id=a.approved_by)
    AND EXISTS (SELECT 1 FROM users u WHERE u.id=a.approved_by AND u.active AND NOT u.test_account)))
  UPDATE page_query_approvals a SET ended_at=now(),ended_by=$2,ended_reason=stale.reason FROM stale WHERE a.id=stale.id AND a.ended_at IS NULL RETURNING a.*`,[pageId??null,subject])).rows;
 for(const row of ended)await recordEvent(tx,subject?{kind:'user',id:subject}:null,'query_approval_ended',{kind:'artifact',id:row.page_id},payload(row,row.ended_reason));
}
