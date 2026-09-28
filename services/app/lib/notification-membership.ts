import type {Queryable} from '@artifactbin/contracts';
/** Notification eligibility requires a live artifact-specific self consent. */
export async function hasExplicitNotificationMembership(tx:Queryable,documentId:string,userId:string):Promise<boolean>{
 return !!(await tx.query("SELECT 1 FROM relations WHERE subject_kind='user' AND subject_id=$2 AND verb='join' AND object_kind='artifact' AND object_id=$1 AND status='accepted' AND deleted_at IS NULL AND explicit_join=true",[documentId,userId])).rows.length;
}
