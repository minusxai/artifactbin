import type {Queryable} from '@artifactbin/contracts';
/** Notification eligibility requires a live artifact-specific self consent. */
export async function hasExplicitNotificationMembership(tx:Queryable,documentId:string,userId:string):Promise<boolean>{
 return (await explicitNotificationMemberships(tx,[documentId],userId)).has(documentId);
}
/** The documents among `documentIds` this user holds that consent for, in one statement. */
export async function explicitNotificationMemberships(tx:Queryable,documentIds:readonly string[],userId:string):Promise<Set<string>>{
 if(!documentIds.length)return new Set();
 return new Set((await tx.query<{object_id:string}>("SELECT object_id FROM relations WHERE subject_kind='user' AND subject_id=$2 AND verb='join' AND object_kind='artifact' AND object_id=ANY($1::text[]) AND status='accepted' AND deleted_at IS NULL AND explicit_join=true",[[...new Set(documentIds)],userId])).rows.map(row=>row.object_id));
}
