/** Group persistence boundary. Implementations must never treat group IDs as user IDs. */
import type {AccountPreferences,CreateGroupInput,DefaultDestination,GroupDetail,GroupRole,GroupSummary} from '@artifactbin/contracts';
import type {Queryable} from '../platform/db';
export interface GroupRecord {id:string;handle:string;name:string;description:string;created_by:string;deleted_at:string|null;}
export async function createGroup(_userId:string,_input:CreateGroupInput):Promise<GroupSummary>{throw Error('Group implementation pending');}
export async function getGroupById(_id:string,_db?:Queryable):Promise<GroupRecord|null>{throw Error('Group implementation pending');}
export async function getGroupDetail(_userId:string|null,_idOrHandle:string):Promise<GroupDetail|null>{throw Error('Group implementation pending');}
export async function listGroups(_userId:string):Promise<GroupSummary[]>{throw Error('Group implementation pending');}
export async function getGroupRole(_userId:string|null,_groupId:string,_db?:Queryable):Promise<GroupRole|null>{throw Error('Group implementation pending');}
export async function setGroupMember(_actorId:string,_groupId:string,_userId:string,_role:GroupRole):Promise<void>{throw Error('Group implementation pending');}
export async function removeGroupMember(_actorId:string,_groupId:string,_userId:string):Promise<void>{throw Error('Group implementation pending');}
export async function getAccountPreferences(_userId:string):Promise<AccountPreferences>{throw Error('Group implementation pending');}
export async function setAccountPreferences(_userId:string,_destination:DefaultDestination):Promise<AccountPreferences>{throw Error('Group implementation pending');}
