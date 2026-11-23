/**
 * APPROVED QUERIES: a page's declared query on the install's default connection (contracts `HtmlDeclaredQuery` on a
 * `default:` link) that an Admin of the group owning the page approved to run AS THAT GROUP, at member level, for the
 * page's readers who read as the group (below). Without one, nothing changes: a page's queries run as the reader, whose
 * own access to the data decides what they get. Server-only.
 *
 * WHO APPROVES: a person who is an Admin of the group that owns the page (direct, or through an ancestor: the
 * `group_admins` view), and only that. A person-owned page has no approvals; an Editor or Member, an agent signed in as
 * a group and a test account never approve.
 *
 * WHO READS AS THE GROUP (`readsAsGroup`): a signed-in ordinary account (identity `users.kind` `account`, active, not a
 * test account), as a person (never a group's sign-in), that can open the page (the door asks only after
 * admitting the reader; an export capture reads as the requester its key names). A guest, a test user, a visitor with no
 * session and a capture without such a requester run the query as themselves, as on any page; only an account that reads
 * as the group is told the owner's name when refused (lib/page-doors approved-queries).
 *
 * WHAT IS COVERED, exactly: the query's text, the connection it runs on (`default:` and the link's namespace) and what a
 * reader may vary in it (`data-af-params`), normalised and hashed (`queryApprovalHash`). Nothing else about the page.
 * The Admin approves the hash they were shown; another one is refused (`query_changed`), so an edit made meanwhile is
 * never approved unseen. Approving it again as the same Admin answers the approval already live.
 *
 * WHO CAN OPEN THE PAGE stays as the Admin approved it: while one is live, only an Admin of the owning group changes the
 * page's visibility, link role, named shares, group shares, an invitation that gives access, or its folder
 * (`assertAudienceChange`, asked by every writer of those in lib/artifacts, inside its transaction holding the page row);
 * anyone else is refused `approved_query_live`. Group membership is not the page's sharing: whoever joins a group that
 * can open the page (the owning group's subtree, or a group it is shared with) is in the audience the Admin approved and
 * reads as the group from their next request, as they gain every other access of that group; joining, leaving,
 * attaching or creating groups never ends an approval. A folder gives nobody access to what it holds (lib/artifact-access
 * decides a page from its own row alone), so nothing flows down from one.
 *
 * WHEN IT HOLDS, asked at every read (`approvedRun`, again after the read: lib/page-doors): the approval is not ended;
 * the version read and the page's head both declare that hash; the page is still that group's; the approver is still
 * an active, non-test account holding the very Admin membership row they approved under (`approver_via`: the group it is
 * in, the owning group or an ancestor; `approver_since`: that row's creation). Every way it stops ENDS it for good, until
 * a fresh approval: a write of the page that no longer declares an approved hash (`endQueryApprovals`, from lib/artifacts'
 * head write: reverting the text does not bring it back), moving the page to another owner, deleting it (restoring it
 * brings none back), a revoke; and the approver losing that membership or the group being
 * deleted (`endStaleApprovals`: from lib/groups after every group change the app makes, and at the first read that finds
 * one no longer holding, whoever changed it; a group change looks only at the groups it can affect and below, and names its
 * actor only on the endings it caused, an ending it merely found is the system's: no person). A membership row taken away and put back, or a group deleted (its members'
 * rows go with it) and put back, is a new row: it revives nothing even with no read between. The one change the identity
 * views cannot tell apart is a role flipped away and back IN PLACE on the same row with no read between; the identity
 * module makes that flip only in `setGroupMember`, whose change the app records, which ends the approval at once.
 *
 * Every approval and every end is audited (contracts events `query_approved`, `query_approval_ended`: who, the page, the
 * query's name and hash, the connection, the group; `at` is when), and so is every read it answered
 * (`approved_query_read`, lib/page-doors: the real reader as subject, the approval in the payload).
 */
import {createHash} from 'node:crypto';
import type {HtmlDeclaredQuery, HtmlDefaultConnectionLink, HtmlPageLink, HtmlQueryParams} from '@artifactbin/contracts/html-page';
import type {Queryable} from '@artifactbin/contracts/db';
import type {AccessActor} from '@/lib/accounts';
import {actorSubject,generateInternalId,getDb,recordEvent} from '@/lib/platform';

export class QueryApprovalError extends Error {
 constructor(readonly status:number,readonly code:string,message:string){super(message);this.name='QueryApprovalError';}
 get body(){return {error:this.code,message:this.message};}
 /** The refusal as a door answers it. */
 response():Response{return Response.json(this.body,{status:this.status});}
}

/** The connection a default-connection link reads, as an approval names it. */
const connectionName=(link:Pick<HtmlDefaultConnectionLink,'namespace'>):string=>`default:${link.namespace}`;
/** A rule of `params` that is its own, never one an object inherits (`constructor`, `__proto__`). */
const ownRule=(params:HtmlQueryParams,name:string)=>Object.hasOwn(params,name)?params[name]:undefined;
/** What a reader may vary, in one order: names sorted; a list's values deduplicated and sorted. */
function canonicalParams(params:HtmlQueryParams={}):unknown[]{
 return Object.keys(params).sort().map(name=>{const allowed=ownRule(params,name)!;return 'type' in allowed?[name,allowed.type]:[name,[...new Set(allowed.values.map(value=>JSON.stringify(value)))].sort()];});
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

/**
 * SQL over approval `a`: its approver still holds the Admin membership row they approved under (in `approver_via`, the
 * owning group or a live ancestor of it, created at `approver_since`: a row put back is another row), and is an active
 * account that is no test account.
 */
const APPROVER_HOLDS=`EXISTS (WITH RECURSIVE up(id,depth) AS (SELECT a.group_id,0 UNION ALL SELECT g.parent_id,up.depth+1 FROM up JOIN groups g ON g.id=up.id AND g.deleted_at IS NULL WHERE g.parent_id IS NOT NULL AND up.depth<10000)
   SELECT 1 FROM up JOIN groups vg ON vg.id=up.id AND vg.deleted_at IS NULL JOIN group_members m ON m.group_id=up.id AND m.user_id=a.approved_by AND m.role='admin'
   WHERE up.id=a.approver_via AND m.created_at=a.approver_since)
  AND EXISTS (SELECT 1 FROM group_admins ga WHERE ga.group_id=a.group_id AND ga.user_id=a.approved_by)
  AND EXISTS (SELECT 1 FROM users u WHERE u.id=a.approved_by AND u.active AND NOT u.test_account)`;

interface ApprovalRow {id:string;page_id:string;query_name:string;query_hash:string;connection:string;group_id:string;approved_by:string;created_at:string}
const APPROVAL_COLUMNS='a.id,a.page_id,a.query_name,a.query_hash,a.connection,a.group_id,a.approved_by,a.created_at';
/** The live approvals of `page` that hold now (see the header), newest first; `hash` narrows to one triple. */
async function holding(db:Queryable,page:string,hash?:string):Promise<ApprovalRow[]>{
 return (await db.query<ApprovalRow>(`SELECT ${APPROVAL_COLUMNS} FROM page_query_approvals a
   JOIN artifacts p ON p.id=a.page_id AND p.deleted_at IS NULL AND p.format='html' AND p.group_id=a.group_id
  WHERE a.page_id=$1 AND a.ended_at IS NULL AND ($2::text IS NULL OR a.query_hash=$2) AND ${APPROVER_HOLDS}
  ORDER BY a.created_at DESC,a.id`,[page,hash??null])).rows;
}

/**
 * WHO READS AS THE GROUP (see the header): a person signed in with an ordinary account, active and no test account.
 * Whether they can open the page is the caller's to have asked first.
 */
export async function readsAsGroup(actor:AccessActor,db?:Queryable):Promise<boolean>{
 if(!actor.userId||actor.principalGroup)return false;
 return !!(await (db??await getDb()).query<{ok:boolean}>("SELECT (kind='account' AND active AND NOT test_account) AS ok FROM users WHERE id=$1",[actor.userId])).rows[0]?.ok;
}

/**
 * Group scope at the time of a delegated read. The group must be live and its ancestry complete.
 * A group connection cannot guarantee a personal row filter, so a bound reader cannot use the approval.
 */
export async function approvedQueryScope(userId:string|null,groupId:string,db?:Queryable):Promise<string[]|null>{
 if(!userId)return null;
 const [row]=(await (db??await getDb()).query<{tenancies:string[]}>(
  `WITH RECURSIVE chain(id,parent_id,tenancy_id) AS (
    SELECT id,parent_id,tenancy_id FROM groups WHERE id=$2 AND deleted_at IS NULL
    UNION
    SELECT g.id,g.parent_id,g.tenancy_id FROM groups g JOIN chain c ON g.id=c.parent_id WHERE g.deleted_at IS NULL
  ), scope AS (
    SELECT COALESCE(array_agg(DISTINCT tenancy_id ORDER BY tenancy_id) FILTER (WHERE tenancy_id IS NOT NULL),'{}') AS tenancies
    FROM chain HAVING bool_or(parent_id IS NULL)
  )
  SELECT scope.tenancies FROM users u CROSS JOIN scope
  WHERE u.id=$1 AND u.kind='account' AND u.active AND NOT u.test_account
    AND u.tenancy_id IS NULL`,
  [userId,groupId])).rows;
 return row?.tenancies??null;
}

/**
 * THE READ'S QUESTION (lib/page-doors): does an approval hold for `declared`, the query of the version read, with the
 * page's `head`? The approval's id and group, or null (the read runs as the reader). `reader` is who reads: one who does
 * not read as the group (`readsAsGroup`) is answered null without asking.
 */
export async function approvedRun(pageId:string,head:{links:readonly HtmlPageLink[];queries:readonly HtmlDeclaredQuery[]},declared:{query:HtmlDeclaredQuery;link:HtmlDefaultConnectionLink},reader:AccessActor):Promise<{id:string;groupId:string;hash:string;connection:string}|null>{
 const hash=queryApprovalHash(declared.query,declared.link);
 if(!declaredOn(head).some(entry=>entry.hash===hash))return null;
 const db=await getDb();
 if(!await readsAsGroup(reader,db))return null;
 const row=(await holding(db,pageId,hash))[0];
 if(row)return {id:row.id,groupId:row.group_id,hash,connection:row.connection};
 // A live approval that no longer holds (its approver is no Admin, its group is gone): ended now, so nothing revives it.
 if((await db.query('SELECT 1 FROM page_query_approvals WHERE page_id=$1 AND query_hash=$2 AND ended_at IS NULL LIMIT 1',[pageId,hash])).rows.length)
  await db.transaction(async tx=>{await tx.query('SELECT id FROM artifacts WHERE id=$1 FOR SHARE',[pageId]);await endStaleApprovals(tx,null,{page:pageId});});
 return null;
}

const DATE=/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
/**
 * Why `sent` is not what `allowed` lets a reader vary (one sentence, which the reader is shown), or null when it is.
 * `server` names the values the server fills itself (lib/connections `VIEWER_PARAMS`), refused by the run, not judged
 * here. Only the approval's own rules count: a name it does not hold itself is no parameter of it.
 */
export function paramsOutside(allowed:HtmlQueryParams={},sent:unknown,server:readonly string[]):string|null{
 if(sent===undefined)return null;
 if(!sent||typeof sent!=='object'||Array.isArray(sent))return 'params must be an object of scalars';
 for(const [name,value] of Object.entries(sent)){
  if(server.includes(name))continue;
  const rule=ownRule(allowed,name);
  if(!rule||typeof rule!=='object')return `${name} cannot be set for this query.`;
  const fits=Object.hasOwn(rule,'values')?Array.isArray((rule as {values?:unknown}).values)&&(rule as {values:readonly unknown[]}).values.some(entry=>entry===value)
   :(rule as {type?:unknown}).type==='text'?typeof value==='string':(rule as {type?:unknown}).type==='number'?typeof value==='number'&&Number.isFinite(value)
   :(rule as {type?:unknown}).type==='boolean'?typeof value==='boolean':(rule as {type?:unknown}).type==='date'&&typeof value==='string'&&DATE.test(value)&&!Number.isNaN(Date.parse(value));
  if(!fits)return `That value of ${name} is not allowed for this query.`;
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
 * agent, nobody) `forbidden`; a person-owned page `not_group_owned` to its owner; anyone in the group who is
 * not its Admin `forbidden`; everyone else the uniform `not_found`.
 */
async function adminPage(db:Queryable,actor:AccessActor,pageId:string,lock=false):Promise<{page:PageRow;group:string}>{
 if(!actor.userId||actor.principalGroup)throw new QueryApprovalError(403,'forbidden','only a person who is an Admin of the group that owns the page approves its queries');
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

/**
 * What approving `declared` means, in plain words, for the Admin's confirmation (the sharing dialog shows it, and an
 * agent says it before approving), in at most four short sentences: who sees what, what they may change, who may change
 * the page's sharing, and which edits end it. Every way it ends is the header's and `approve_query`'s to list.
 */
function statementOf(declared:Declared,group:string):string{
 const allowed=Object.entries(declared.query.params??{}).map(([name,rule])=>'values' in rule?`${name} (one of ${rule.values.map(value=>String(value)).join(', ')})`:`${name} (any ${rule.type})`);
 return `Everyone signed in with their own account who can open this page, including people who later join a group that can open it, will see what ${declared.query.name} returns as ${group} sees it. `+
  (allowed.length?`They may choose ${allowed.join(' and ')}; any other value is refused. `:'They cannot change anything in it. ')+
  `While it is approved, only an Admin of ${group} may change this page's sharing. `+
  `Editing the query, its connection or what readers may vary ends the approval.`;
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

type EndReason='revoked'|'edited'|'moved'|'replaced'|'deleted'|'approver_not_admin'|'group_deleted';
const payload=(row:Pick<ApprovalRow,'id'|'query_name'|'query_hash'|'connection'|'group_id'>,reason?:EndReason,system?:boolean)=>
 ({approval_id:row.id,query:row.query_name,query_hash:row.query_hash,connection:row.connection,group_id:row.group_id,...(reason?{reason}:{}),...(system?{system:true as const}:{})});

/**
 * An Admin of the owning group approves the head's declared query `query` whose hash they were shown (`hash`). Audited.
 * The same Admin approving the same hash again is answered the approval already live; another approval made at the same
 * moment by someone else, or of another hash, is `approval_conflict`.
 */
export async function approvePageQuery(actor:AccessActor,pageId:string,input:{query?:unknown;hash?:unknown}):Promise<{id:string;query:string;hash:string;connection:string}>{
 if(typeof input.query!=='string'||typeof input.hash!=='string')throw new QueryApprovalError(400,'validation_failed','send {query, hash}: the declared query\'s name and the hash you were shown');
 const db=await getDb();
 return db.transaction(async tx=>{
  const {page}=await adminPage(tx,actor,pageId,true);
  if((await tx.query<{test_account:boolean}>('SELECT test_account FROM users WHERE id=$1',[actor.userId])).rows[0]?.test_account)throw new QueryApprovalError(403,'test_account_restricted','a test account approves nothing');
  const declared=ofMeta(page.meta).find(entry=>entry.query.name===input.query);
  if(!declared)throw new QueryApprovalError(404,'unknown_query',`this page declares no query on a default: link named ${JSON.stringify(String(input.query).slice(0,64))}`);
  if(declared.hash!==input.hash)throw new QueryApprovalError(409,'query_changed',`${declared.query.name} changed since you looked at it: read it again before approving`);
  const answer=(row:Pick<ApprovalRow,'id'>)=>({id:row.id,query:declared.query.name,hash:declared.hash,connection:connectionName(declared.link)});
  // One that no longer holds ends first; the same Admin's live approval of this very hash is the answer.
  await endStaleApprovals(tx,actor.userId,{page:pageId});
  const same=async()=>(await tx.query<ApprovalRow>(`SELECT ${APPROVAL_COLUMNS} FROM page_query_approvals a WHERE a.page_id=$1 AND a.query_name=$2 AND a.ended_at IS NULL`,[pageId,declared.query.name])).rows[0];
  const live=await same();
  if(live&&live.query_hash===declared.hash&&live.approved_by===actor.userId)return answer(live);
  const replaced=(await tx.query<ApprovalRow>(`UPDATE page_query_approvals SET ended_at=now(),ended_by=$3,ended_reason='replaced' WHERE page_id=$1 AND query_name=$2 AND ended_at IS NULL RETURNING *`,[pageId,declared.query.name,actor.userId])).rows;
  for(const row of replaced)await recordEvent(tx,actorSubject(actor),'query_approval_ended',{kind:'artifact',id:pageId},payload(row,'replaced'));
  const row={id:`pqa_${generateInternalId()}`,query_name:declared.query.name,query_hash:declared.hash,connection:connectionName(declared.link),group_id:page.group_id!};
  // The approver's Admin membership row it holds under (the nearest, `group_admins.via_group_id`) is its witness.
  const inserted=(await tx.query(`INSERT INTO page_query_approvals (id,page_id,query_name,query_hash,connection,group_id,approved_by,approver_via,approver_since)
    SELECT $1,$2,$3,$4,$5,$6,$7,m.group_id,m.created_at FROM group_admins ga JOIN group_members m ON m.group_id=ga.via_group_id AND m.user_id=ga.user_id AND m.role='admin'
    WHERE ga.group_id=$6 AND ga.user_id=$7 LIMIT 1
    ON CONFLICT (page_id,query_name) WHERE ended_at IS NULL DO NOTHING RETURNING id`,[row.id,pageId,row.query_name,row.query_hash,row.connection,row.group_id,actor.userId])).rows;
  if(!inserted.length){
   // Another approval of this query committed while this one ran (it waited on the live index).
   const other=await same();
   if(other&&other.query_hash===declared.hash&&other.approved_by===actor.userId)return answer(other);
   throw new QueryApprovalError(409,'approval_conflict',`${declared.query.name} was approved by someone else at the same moment: read the page's queries again`);
  }
  await recordEvent(tx,actorSubject(actor),'query_approved',{kind:'artifact',id:pageId},payload(row));
  return answer(row);
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
 * Ends, inside the writer's transaction (which holds the page rows), live approvals, audited as that writer's: of
 * `pageId`, every one its new head no longer declares (`edited`: `head` is the written row; one that is not a page
 * declares none); of each of `pageId`, every one (`moved`: the pages went to another owner; `deleted`: to the trash).
 */
export async function endQueryApprovals(tx:Queryable,actor:Pick<AccessActor,'userId'|'tokenId'|'principalGroup'>,pageId:string|readonly string[],reason:'edited'|'moved'|'deleted',head?:{format:string;meta:Record<string,unknown>}):Promise<void>{
 const kept=reason==='edited'&&head?.format==='html'?ofMeta(head.meta).map(entry=>entry.hash):[];
 const ended=(await tx.query<ApprovalRow>(`UPDATE page_query_approvals SET ended_at=now(),ended_by=$3,ended_reason=$4 WHERE page_id=ANY($1::text[]) AND ended_at IS NULL AND NOT (query_hash=ANY($2::text[])) RETURNING *`,[typeof pageId==='string'?[pageId]:[...pageId],kept,actor.userId,reason])).rows;
 for(const row of ended)await recordEvent(tx,actorSubject(actor),'query_approval_ended',{kind:'artifact',id:row.page_id},payload(row,reason));
}

/** What `endStaleApprovals` looks at, and whose doing an ending is. */
export interface StaleScope {
 /** Only this page's approvals. */
 page?:string;
 /** Only approvals of these groups and their descendants (what a change to those groups can affect); absent: every one. */
 groups?:readonly string[];
 /**
  * Without it every ending is the subject's. With it only those the change caused are: an approver it concerns
  * (`approvers`), a group it deleted (`deleted`: the changed groups), the groups below one it reparented (`reparented`).
  * Any other found stale on the way, one the change did not cause, is a system ending: no person, `system` in the event.
  */
 blame?:{approvers:readonly string[];deleted:readonly string[];reparented:readonly string[]};
}
/**
 * Ends, audited, every live approval (in `scope`) whose group is deleted (`group_deleted`), whose page is no longer that
 * group's (`moved`), or whose approver no longer holds the Admin membership row they approved under or is no longer an
 * active account (`approver_not_admin`). `subject` is who made the change (null when a read found it); see `StaleScope`
 * for which endings are theirs.
 */
export async function endStaleApprovals(tx:Queryable,subject:string|null,scope:StaleScope={}):Promise<void>{
 const {page,groups,blame}=scope;
 const down='WITH RECURSIVE down(id) AS (SELECT unnest($2::text[]) UNION SELECT g.id FROM down JOIN groups g ON g.parent_id=down.id)';
 const inScope='($1::text IS NULL OR a.page_id=$1) AND ($2::text[] IS NULL OR a.group_id IN (SELECT id FROM down))';
 const where=[page??null,groups?[...groups]:null];
 // Most installs and most group changes have no live approval at all: then nothing is asked of the group tree.
 if(!(await tx.query(`${down} SELECT 1 FROM page_query_approvals a WHERE a.ended_at IS NULL AND ${inScope} LIMIT 1`,where)).rows.length)return;
 const ended=(await tx.query<ApprovalRow&{ended_reason:EndReason;ended_by:string|null}>(`${down},reparented(id) AS (SELECT unnest($6::text[]) UNION SELECT g.id FROM reparented JOIN groups g ON g.parent_id=reparented.id),stale AS (
   SELECT a.id,CASE WHEN NOT EXISTS (SELECT 1 FROM groups g WHERE g.id=a.group_id AND g.deleted_at IS NULL) THEN 'group_deleted'
     WHEN NOT EXISTS (SELECT 1 FROM artifacts p WHERE p.id=a.page_id AND p.group_id=a.group_id) THEN 'moved' ELSE 'approver_not_admin' END AS reason
   FROM page_query_approvals a WHERE a.ended_at IS NULL AND ${inScope} AND NOT (
    EXISTS (SELECT 1 FROM groups g WHERE g.id=a.group_id AND g.deleted_at IS NULL)
    AND EXISTS (SELECT 1 FROM artifacts p WHERE p.id=a.page_id AND p.group_id=a.group_id)
    AND ${APPROVER_HOLDS}))
  UPDATE page_query_approvals a SET ended_at=now(),ended_reason=stale.reason,
   ended_by=CASE WHEN $7::boolean OR a.approved_by=ANY($4::text[]) OR (stale.reason='group_deleted' AND a.group_id=ANY($5::text[])) OR a.group_id IN (SELECT id FROM reparented) THEN $3::text END
  FROM stale WHERE a.id=stale.id AND a.ended_at IS NULL RETURNING a.*`,[...where,subject,blame?[...blame.approvers]:[],blame?[...blame.deleted]:[],blame?[...blame.reparented]:[],!blame])).rows;
 for(const row of ended)await recordEvent(tx,row.ended_by?{kind:'user',id:row.ended_by}:null,'query_approval_ended',{kind:'artifact',id:row.page_id},payload(row,row.ended_reason,!row.ended_by));
}

/** The page fields an audience change is judged against: its row as the writer locked it. */
interface AudiencePage {id:string;format:string;group_id?:string|null;visibility:string;link_role?:string|null;ancestor_ids?:readonly string[]|null}
/** What a write asks to change of who can open a page; `grant`: it gives someone access (a group share, an invitation's). */
export interface AudienceChange {visibility?:string|undefined;link_role?:string|null|undefined;ancestor_ids?:readonly string[]|undefined;shares?:readonly {email:string;role:string}[]|undefined;grant?:boolean}
/** The share list as `writeShares` (lib/artifacts) stores it: addresses trimmed and lowercased, the last role given wins. */
const shareMap=(shares:readonly {email:string;role:string}[])=>new Map(shares.map(entry=>[entry.email.trim().toLowerCase(),entry.role]));
/**
 * WHO CAN OPEN A PAGE WITH A LIVE APPROVAL (see the header), asked by every writer of its audience inside its
 * transaction, after locking `page`'s row: refused `approved_query_live` (403) unless nothing changes, the page has no
 * live approval, or `actor` is a person who is an Admin of the owning group. A page with no approval asks one query.
 */
export async function assertAudienceChange(tx:Queryable,actor:AccessActor,page:AudiencePage,next:AudienceChange):Promise<void>{
 if(page.format!=='html'||!page.group_id)return;
 const plain=(next.visibility!==undefined&&next.visibility!==page.visibility)||(next.link_role!=null&&next.link_role!==(page.link_role??'viewer'))
  ||(next.ancestor_ids!==undefined&&JSON.stringify(next.ancestor_ids)!==JSON.stringify(page.ancestor_ids??[]))||next.grant===true;
 if(!plain&&next.shares===undefined)return;
 if(!(await tx.query('SELECT 1 FROM page_query_approvals WHERE page_id=$1 AND ended_at IS NULL LIMIT 1',[page.id])).rows.length)return;
 if(!plain){
  const now=shareMap((await tx.query<{email:string;role:string}>('SELECT email,role FROM artifact_shares WHERE artifact_id=$1',[page.id])).rows),asked=shareMap(next.shares!);
  if(now.size===asked.size&&[...asked].every(([email,role])=>now.get(email)===role))return;
 }
 if(actor.userId&&!actor.principalGroup&&(await tx.query('SELECT 1 FROM group_admins WHERE group_id=$1 AND user_id=$2',[page.group_id,actor.userId])).rows.length)return;
 // One that no longer holds ends here; only a live one keeps the page's audience its Admins'.
 await endStaleApprovals(tx,actor.userId,{page:page.id});
 if(!(await tx.query('SELECT 1 FROM page_query_approvals WHERE page_id=$1 AND ended_at IS NULL LIMIT 1',[page.id])).rows.length)return;
 const group=(await tx.query<{name:string}>('SELECT name FROM groups WHERE id=$1',[page.group_id])).rows[0]?.name??'the group that owns it';
 throw new QueryApprovalError(403,'approved_query_live',`This page has an approved query that runs as ${group}: while it is live, only an Admin of ${group} may change who can open the page. Ask an Admin to make this change, or to revoke the approval first.`);
}

/**
 * WHAT A STORED RENDER OF THE PAGE FOR `reader` DEPENDS ON (lib/export): every approval the page ever had (each id and
 * whether it is ended), whether `reader` reads as the group, and the ones holding for them now, hashed into a revision
 * segment; and `current`, that no image of another revision is ever served for it, not even a card's while it
 * refreshes. A page that never had an approval: `''` and false, as before approvals.
 */
export async function approvalRenderState(pageId:string,reader:AccessActor|null):Promise<{revision:string;current:boolean;scopeDenied:boolean}>{
 const db=await getDb();
 const all=(await db.query<{id:string;ended:boolean}>('SELECT id,ended_at IS NOT NULL AS ended FROM page_query_approvals WHERE page_id=$1 ORDER BY id',[pageId])).rows;
 if(!all.length)return {revision:'',current:false,scopeDenied:false};
 const group=!!reader&&await readsAsGroup(reader,db);
 const approvals=group?await holding(db,pageId):[];
 const owner=approvals[0]?.group_id;
 const scope=owner?await approvedQueryScope(reader!.userId,owner,db):null;
 const held=scope?approvals.map(row=>row.id).sort():[];
 return {revision:`-q${createHash('sha256').update(JSON.stringify([all,group,held,scope])).digest('hex').slice(0,16)}`,current:true,scopeDenied:!!owner&&!scope};
}
