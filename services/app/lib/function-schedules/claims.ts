/**
 * A SCHEDULED RUN'S CLAIM, fenced. A run holds its schedule row under a lease in DATABASE time (`lease_until`, set
 * from now()), named by `claim_token` and the fencing epoch `claim_epoch` (one more on every claim). A lease that
 * expires (a process suspended, a run past its wall time) may be claimed again by another process, so the old run's
 * effects must stop, not only its final status write:
 *
 *  - before each capability the run reaches, `renewScheduleClaim` extends the lease only while this claim is still
 *    the current one (lib/page-doors `resolverAdmit`); a lost claim reaches nothing more;
 *  - each effect a run commits (a caps.sql write) checks `scheduleClaimHolds` inside its own transaction, which locks
 *    the schedule row FOR SHARE: a reclaim waits for that commit, and a reclaim that committed first refuses it.
 *
 * Lock order (lib/artifact-access locks.ts): the schedule row is no artifact and no access fact; it is locked last,
 * after the page and the datasets, and no writer of it holds an artifact lock, so it adds no cycle.
 */
import {RESOLVER_LIMITS,type Queryable,type RunnerAdmission} from '@artifactbin/contracts';
import {getDb} from '@/lib/platform';

/** How long a claim holds its schedule without renewal: well past the longest run (the app's wait for one). */
export const LEASE_MS=RESOLVER_LIMITS.appWaitMs+5*60_000;
type Claimed=Required<Pick<RunnerAdmission,'claim'>>['claim'];
const CURRENT='page_id=$1 AND link=$2 AND function=$3 AND claim_token=$4 AND claim_epoch=$5 AND lease_until>now()';
const key=(page:string,fn:string,claim:Claimed)=>[page,claim.link,fn,claim.token,claim.epoch];

/** Extends the lease while this claim is still current; false when it was lost (expired and claimed again, or released). */
export async function renewScheduleClaim(page:string,fn:string,claim:Claimed):Promise<boolean>{
 return !!(await (await getDb()).query(`UPDATE page_function_schedules SET lease_until=now()+$6*interval '1 millisecond' WHERE ${CURRENT} RETURNING 1`,[...key(page,fn,claim),LEASE_MS])).rows.length;
}
/** Inside an effect's transaction: the claim is still current, its row locked FOR SHARE until the effect commits. */
export async function scheduleClaimHolds(tx:Queryable,page:string,fn:string,claim:Claimed):Promise<boolean>{
 return !!(await tx.query(`SELECT 1 FROM page_function_schedules WHERE ${CURRENT} FOR SHARE`,key(page,fn,claim))).rows.length;
}
