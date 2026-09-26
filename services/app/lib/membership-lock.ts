import type {Queryable} from '@artifactbin/contracts';
/** Membership writers serialize on users. A same-value update also advances
 * xmin so a one-statement document writer can detect that its count snapshot
 * predates a writer it waited for. No profile field or timestamp changes. */
export async function lockMembershipUsers(tx:Queryable,ids:string[]):Promise<void>{
 await tx.query(`WITH locked AS MATERIALIZED (
  SELECT id FROM users WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE
 ) UPDATE users u SET id=u.id FROM locked l WHERE u.id=l.id`,[[...new Set(ids)]]);
}
