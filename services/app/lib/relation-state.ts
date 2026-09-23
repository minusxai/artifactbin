/** Storage for relation lifecycles. Callers own authorization and subject/object locks. */
import {RELATION_EVENTS,type Queryable,type RelationVerb,type RelationStatus,type RelationDirection} from '@artifactbin/contracts';

export interface RelationState {status:RelationStatus;direction:RelationDirection;initiated_by:string;revision:number;accepted_at:string|null}
/** A read projection, not another table: keeps the membership wire independent of storage. */
export const JOIN_RELATIONS = `(SELECT object_id AS artifact_id, subject_id AS user_id, status, direction,
 coalesce(initiated_by,subject_id) AS initiated_by, accepted_at AS joined_at, revision FROM relations
 WHERE subject_kind='user' AND verb='join' AND object_kind='artifact')`;

export async function setRelationState(tx:Queryable,subjectId:string,verb:RelationVerb,objectId:string,state:{status:RelationStatus;direction:RelationDirection;initiatedBy:string;revision:number}):Promise<void>{
 const object=RELATION_EVENTS[verb]?.object;if(!object)throw Error('Unknown relation verb');
 await tx.query(`INSERT INTO relations(subject_kind,subject_id,verb,object_kind,object_id,status,direction,initiated_by,accepted_at,revision,deleted_at)
 VALUES('user',$1,$2,$3,$4,$5,$6,$7,CASE WHEN $5='accepted' THEN now() ELSE NULL END,$8,CASE WHEN $5 IN ('left','dismissed') THEN now() ELSE NULL END)
 ON CONFLICT(subject_kind,subject_id,verb,object_kind,object_id) DO UPDATE SET status=EXCLUDED.status,direction=EXCLUDED.direction,initiated_by=EXCLUDED.initiated_by,
 accepted_at=CASE WHEN EXCLUDED.status='accepted' AND relations.status<>'accepted' THEN EXCLUDED.accepted_at ELSE relations.accepted_at END,
 revision=EXCLUDED.revision,deleted_at=EXCLUDED.deleted_at`,[subjectId,verb,object,objectId,state.status,state.direction,state.initiatedBy,state.revision]);
}

export async function seedOwnerJoin(tx:Queryable,artifactId:string,userId:string):Promise<void>{
 await tx.query("INSERT INTO relations(subject_kind,subject_id,verb,object_kind,object_id,status,direction,initiated_by,accepted_at) VALUES('user',$1,'join','artifact',$2,'accepted','request',$1,now()) ON CONFLICT DO NOTHING",[userId,artifactId]);
}

export async function dismissPendingRelations(tx:Queryable,userId:string,blockedId:string):Promise<void>{
 await tx.query("UPDATE relations SET status='dismissed',deleted_at=now(),revision=revision+1 WHERE subject_kind='user' AND status='pending' AND ((subject_id=$1 AND initiated_by=$2)OR(subject_id=$2 AND initiated_by=$1))",[userId,blockedId]);
}
