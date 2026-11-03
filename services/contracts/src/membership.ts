import type {RelationStatus,RelationDirection} from './relations';
import type {DatasetColumn} from './sql';
export const PENDING_MEMBERSHIP_LIMIT = 30;
export type MembershipStatus = RelationStatus;
export type MembershipDirection = RelationDirection;
type MembershipAction = 'join' | 'invite' | 'accept' | 'approve' | 'dismiss' | 'leave';
export interface ArtifactMember {
  user_id: string;
  username: string | null;
  name: string | null;
  status: MembershipStatus;
  direction: MembershipDirection;
  initiated_by: string;
  joined_at: string | null;
  /** Artifact-specific consent, distinct from automatic invitation acceptance. */
  explicit_join: boolean;
}
export interface MembershipInput {
  action: MembershipAction;
  usernames?: string[];
  /** Explicitly grant viewing access with an invitation; requires sharing authority. */
  includeAccess?: boolean;
  userId?: string;
}
export interface MembershipState {
  /** Public status of explicitly saved mentions; never includes invitation details. */
  mentions?:Record<string,MembershipStatus>;
  members: ArtifactMember[];
  pending: ArtifactMember[];
  self: ArtifactMember | null;
  canManage: boolean;
  canInvite: boolean;
}

export const MEMBER_COLUMNS:DatasetColumn[]=[{name:'user_id',type:'user'},{name:'joined_at',type:'timestamp'}];

/** A member notification (invitation, request, follow, reply…) as `GET /api/my/notifications` returns it. */
export interface MemberNotificationItem {group_handle?:string|null;id:string;artifact_id:string|null;user_id:string;status:string|null;direction:string|null;sender_id:string;username:string|null;kind:string;source:string|null;title:string|null;read_at:string|null;revision:number;created_at?:string;first_update_id?:string|null;agent_label?:string|null}
/** The notification inbox as the page reads it. */
export interface InboxState {autoAccept:boolean;notifications:MemberNotificationItem[];blocks:Array<{user_id:string;username:string|null}>;unread:number;next:number|null}
