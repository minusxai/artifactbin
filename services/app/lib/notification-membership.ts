import type {Queryable} from '@artifactbin/contracts';
import {isArtifactMember} from './membership';
/** Notification eligibility requires a current explicit join, not merely read access. */
export function hasExplicitNotificationMembership(tx:Queryable,documentId:string,userId:string):Promise<boolean>{
 return isArtifactMember(documentId,userId,tx);
}
