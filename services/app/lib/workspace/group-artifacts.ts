/**
 * WHAT A MEMBER CAN OPEN THROUGH A GROUP (`GET /api/groups/{id}/artifacts`, operation `list_group_artifacts`), for the
 * person asking, a browser session or their bearer alike, decided by this product's own rules:
 *
 * - The person is a DIRECT member of the live group (a parent's or a subgroup's membership is not this group's);
 *   otherwise the group is `not_found`, as every group read answers a non-member.
 * - Candidates are html pages a group on that group's chain owns or is shared with (a share and a group-owned page's
 *   audience reach a group's subtree, so a parent's reach a subgroup's members; nothing reaches upward or sideways),
 *   each kept only if the person's role WITHOUT the link reads it (a listing never comes from a link,
 *   lib/artifact-access). A deleted group has no chain and grants nothing.
 *
 * The answer carries ids, titles, display names and counts only: no email, no source, no row. Newest first, 200 at most.
 */
import type {GroupArtifact} from '@artifactbin/contracts';
import type {AccessActor} from '@/lib/accounts';
import {LIVE_ARTIFACT_SQL,roleWithoutLink} from '@/lib/artifact-access';
import {GroupError,getGroupRole,groupChain} from '@/lib/groups';
import {getDb} from '@/lib/platform';

const LIMIT=200;
type Row={id:string;title:string|null;updated_at:Date|string;user_id:string|null;token_id:string|null;group_id:string|null;format:'html'};

export async function groupArtifactsFor(actor:AccessActor,groupId:string):Promise<GroupArtifact[]>{
 const db=await getDb();
 if(!actor.userId||!await getGroupRole(actor.userId,groupId,db))throw new GroupError('not_found',404);
 const chain=await groupChain(db,groupId);
 if(!chain.length)throw new GroupError('not_found',404);
 const candidates=(await db.query<Row>(`SELECT id,title,updated_at,user_id,token_id,group_id,format FROM artifacts a
   WHERE a.format='html' AND a.${LIVE_ARTIFACT_SQL} AND (a.group_id=ANY($1::text[]) OR EXISTS (SELECT 1 FROM artifact_group_shares s WHERE s.artifact_id=a.id AND s.group_id=ANY($1::text[])))
   ORDER BY a.updated_at DESC,a.id LIMIT ${LIMIT}`,[chain])).rows;
 const rows:Row[]=[];
 for(const row of candidates)if(await roleWithoutLink(row,actor)!=='none')rows.push(row);
 const ids=rows.map(r=>r.id),users=[...new Set(rows.flatMap(r=>r.group_id||!r.user_id?[]:[r.user_id]))],groups=[...new Set([...chain,...rows.flatMap(r=>r.group_id?[r.group_id]:[])])];
 const [names,groupNames,shares,comments]=await Promise.all([
  db.query<{id:string;name:string|null;username:string|null}>('SELECT id,name,username FROM users WHERE id=ANY($1::text[])',[users]),
  db.query<{id:string;name:string}>('SELECT id,name FROM groups WHERE id=ANY($1::text[]) AND deleted_at IS NULL',[groups]),
  db.query<{artifact_id:string;group_id:string}>('SELECT artifact_id,group_id FROM artifact_group_shares WHERE artifact_id=ANY($1::text[]) AND group_id=ANY($2::text[]) ORDER BY group_id',[ids,chain]),
  db.query<{artifact_id:string;n:number}>("SELECT artifact_id,COUNT(*)::int AS n FROM annotations WHERE artifact_id=ANY($1::text[]) AND root_id IS NULL AND status='open' AND deleted_at IS NULL GROUP BY artifact_id",[ids]),
 ]);
 const person=new Map(names.rows.map(u=>[u.id,u.name??u.username??'Someone'])),group=new Map(groupNames.rows.map(g=>[g.id,g.name])),count=new Map(comments.rows.map(c=>[c.artifact_id,c.n]));
 return rows.map(r=>({
  id:r.id,title:r.title||'Untitled',updated_at:new Date(r.updated_at).toISOString(),
  owner:r.group_id?{kind:'group' as const,name:group.get(r.group_id)??'A group'}:{kind:'user' as const,name:(r.user_id&&person.get(r.user_id))||'Someone'},
  shared_with:shares.rows.filter(s=>s.artifact_id===r.id&&group.has(s.group_id)).map(s=>({id:s.group_id,name:group.get(s.group_id)!})),
  comments:count.get(r.id)??0,
 }));
}
