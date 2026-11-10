/**
 * THE SCHEDULE CAPACITY INVARIANT: one publisher has at most FUNCTION_SCHEDULE_LIMIT (contracts) scheduled functions
 * active across the live html heads whose content it published (`content_publisher_user_id`). Every transaction that
 * can activate schedules checks it after its write, inside the transaction, so no ordering of publishes, trash and
 * restores exceeds it: create and fork (insertArtifact), publication and revert (the stamping `publish`) and trash
 * restore (restoreTrashedSubtree). An unchanged republish (replaceArtifactInTx's early return) writes nothing and
 * stamps no publisher, so it activates nothing. Metadata, sharing and transfer never change the publisher.
 *
 * SERIALIZED PER PUBLISHER: the check locks each affected publisher's `users` row FOR UPDATE before counting, so two
 * transactions that add to one publisher's count run one after the other and the second counts the first. LOCK
 * ORDER (lib/artifact-access README): the account rows are facts, step 3, taken after the transaction's artifacts,
 * in `lockOrder`; a deadlock with a writer in another order aborts one, which rolls back whole.
 */
import {FUNCTION_SCHEDULE_LIMIT,type Queryable} from '@artifactbin/contracts';
import {lockOrder} from '@/lib/artifact-access';
import {DatasetError} from '@/lib/datasets';

export class ScheduleLimitError extends DatasetError {
 readonly code='schedule_limit';
 constructor(total:number){super(`This would give the publishing account ${total} scheduled functions across the pages it published; one account may have at most ${FUNCTION_SCHEDULE_LIMIT}. Remove a schedule here or from another page it published, then try again.`,400);}
}
const HEADS=`FROM artifacts a
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a.meta->'htmlLinks')='array' THEN a.meta->'htmlLinks' ELSE '[]'::jsonb END) AS e(el)
 JOIN html_backend_versions v ON v.backend_id=e.el->>'backendId' AND v.version=e.el->>'version' AND v.page_id=a.id`;
const LIVE_SCHEDULED=`a.deleted_at IS NULL AND a.format='html' AND e.el->>'kind'='backend' AND v.function_schedules IS NOT NULL`;

/** After a write in `tx` that may have activated the schedules of `ids`: refuse (ScheduleLimitError) any publisher over the limit. */
export async function assertScheduleCapacity(tx:Queryable,ids:readonly string[]):Promise<void>{
 if(!ids.length)return;
 const publishers=(await tx.query<{publisher:string}>(`SELECT DISTINCT a.content_publisher_user_id AS publisher ${HEADS} WHERE ${LIVE_SCHEDULED} AND a.id=ANY($1::text[]) AND a.content_publisher_user_id IS NOT NULL`,[ids])).rows.map(r=>r.publisher).sort(lockOrder);
 for(const publisher of publishers)await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[publisher]);
 for(const publisher of publishers){
  const total=(await tx.query<{n:number}>(`SELECT count(*)::int AS n ${HEADS} CROSS JOIN LATERAL jsonb_object_keys(v.function_schedules) AS k(name) WHERE ${LIVE_SCHEDULED} AND a.content_publisher_user_id=$1`,[publisher])).rows[0]?.n??0;
  if(total>FUNCTION_SCHEDULE_LIMIT)throw new ScheduleLimitError(total);
 }
}
