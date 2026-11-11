/**
 * THE SCHEDULE CAPACITY INVARIANT: one publisher has at most FUNCTION_SCHEDULE_LIMIT (contracts) scheduled functions
 * active across the live html heads whose content it published (`content_publisher_user_id`). Every transaction that
 * can activate schedules checks it after its write, inside the transaction, so no ordering of publishes, trash and
 * restores exceeds it: create and fork (insertArtifact), publication and revert (the stamping `publish`) and trash
 * restore (restoreTrashedSubtree). An unchanged republish (replaceArtifactInTx's early return) writes nothing and
 * stamps no publisher, so it activates nothing. Metadata, sharing and transfer never change the publisher.
 *
 * SERIALIZED PER PUBLISHER: the check takes each affected publisher's schedule-capacity advisory lock (lib/platform
 * lockSubjects; the account row is identity's and never locked by the app) before counting, so two transactions that
 * add to one publisher's count run one after the other and the second counts the first. LOCK ORDER (lib/artifact-access
 * locks.ts): a tail after the transaction's artifacts, in `lockOrder`; a deadlock with a writer in another order
 * aborts one, which rolls back whole.
 *
 * WHO OWNS RECURRING WORK (contract §7): with `SCHEDULES__OWNER=minusx` the same transactions refuse to activate any
 * page schedule the page's live head did not already declare before the write (`schedules_owned_by_minusx`, 409), by
 * page, link and function name: exactly the publish path's rule (lib/publish governed.ts), so fork, trash restore and
 * revert cannot leave a page declaring a schedule a publish would have refused. They REFUSE rather than strip: a
 * schedule is read from the function file's source text, which nothing here rewrites. A trashed page's head declares
 * nothing (its schedules are inactive), so restoring a scheduled page there is refused; a version without the
 * schedule export is the way back.
 */
import {FUNCTION_SCHEDULE_LIMIT,type Queryable} from '@artifactbin/contracts';
import {DatasetError} from '@/lib/datasets';
import {lockSubjects,schedulesOwner} from '@/lib/platform';

/** A write refused because it would activate page schedules: its code and the lines a caller shows (`details`). */
export class ScheduleRefusal extends DatasetError {
 constructor(readonly code:'schedule_limit'|'schedules_owned_by_minusx',readonly details:string[],status:number){super(details.join('; '),status);}
}
export class ScheduleLimitError extends ScheduleRefusal {
 constructor(total:number){super('schedule_limit',[`This would give the publishing account ${total} scheduled functions across the pages it published; one account may have at most ${FUNCTION_SCHEDULE_LIMIT}. Remove a schedule here or from another page it published, then try again.`],400);}
}
class SchedulesOwnedByMinusxError extends ScheduleRefusal {
 constructor(added:readonly {link:string;function:string}[]){super('schedules_owned_by_minusx',added.map(entry=>`resolver "${entry.link}" schedules ${entry.function}: recurring work on this installation is scheduled in MinusX, not by a page, so this would start a page schedule; publish a version without the schedule export instead`),409);}
}
const HEADS=`FROM artifacts a
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a.meta->'htmlLinks')='array' THEN a.meta->'htmlLinks' ELSE '[]'::jsonb END) AS e(el)
 JOIN html_backend_versions v ON v.backend_id=e.el->>'backendId' AND v.version=e.el->>'version' AND v.page_id=a.id`;
const LIVE_SCHEDULED=`a.deleted_at IS NULL AND a.format='html' AND e.el->>'kind'='backend' AND v.function_schedules IS NOT NULL`;

interface ScheduleKey {page:string;link:string;function:string}
const keyOf=(entry:ScheduleKey)=>JSON.stringify([entry.page,entry.link,entry.function]);
async function liveSchedules(tx:Queryable,ids:readonly string[]):Promise<ScheduleKey[]>{
 return (await tx.query<ScheduleKey>(`SELECT a.id AS page,e.el->>'name' AS link,k.name AS function ${HEADS} CROSS JOIN LATERAL jsonb_object_keys(v.function_schedules) AS k(name) WHERE ${LIVE_SCHEDULED} AND a.id=ANY($1::text[]) ORDER BY 1,2,3`,[ids])).rows;
}
/**
 * The schedules the live heads of `ids` declare BEFORE a write that may replace those heads (a revert or a publish),
 * for `assertScheduleCapacity` to compare against; nothing to remember unless MinusX owns recurring work.
 */
export async function schedulesBefore(tx:Queryable,ids:readonly string[]):Promise<ReadonlySet<string>>{
 return schedulesOwner()==='minusx'&&ids.length?new Set((await liveSchedules(tx,ids)).map(keyOf)):new Set();
}
/**
 * After a write in `tx` that may have activated the schedules of `ids`: under `SCHEDULES__OWNER=minusx` refuse
 * (SchedulesOwnedByMinusxError) any schedule not in `before` (`schedulesBefore`; none for a creation, a fork or a
 * restore), then refuse (ScheduleLimitError) any publisher over the limit.
 */
export async function assertScheduleCapacity(tx:Queryable,ids:readonly string[],before:ReadonlySet<string>=new Set()):Promise<void>{
 if(!ids.length)return;
 if(schedulesOwner()==='minusx'){
  const added=(await liveSchedules(tx,ids)).filter(entry=>!before.has(keyOf(entry)));
  if(added.length)throw new SchedulesOwnedByMinusxError(added);
 }
 const publishers=(await tx.query<{publisher:string}>(`SELECT DISTINCT a.content_publisher_user_id AS publisher ${HEADS} WHERE ${LIVE_SCHEDULED} AND a.id=ANY($1::text[]) AND a.content_publisher_user_id IS NOT NULL`,[ids])).rows.map(r=>r.publisher);
 await lockSubjects(tx,'schedule-capacity',publishers);
 for(const publisher of publishers){
  const total=(await tx.query<{n:number}>(`SELECT count(*)::int AS n ${HEADS} CROSS JOIN LATERAL jsonb_object_keys(v.function_schedules) AS k(name) WHERE ${LIVE_SCHEDULED} AND a.content_publisher_user_id=$1`,[publisher])).rows[0]?.n??0;
  if(total>FUNCTION_SCHEDULE_LIMIT)throw new ScheduleLimitError(total);
 }
}
