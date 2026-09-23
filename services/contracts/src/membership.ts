import type {DatasetColumn} from './sql';
export const PENDING_MEMBERSHIP_LIMIT = 30;
export type MembershipStatus = 'pending' | 'accepted' | 'dismissed' | 'left';
export type MembershipDirection = 'invitation' | 'request';
export type MembershipAction = 'join' | 'invite' | 'accept' | 'approve' | 'dismiss' | 'leave';
export interface ArtifactMember {
  user_id: string;
  username: string | null;
  name: string | null;
  status: MembershipStatus;
  direction: MembershipDirection;
  initiated_by: string;
  joined_at: string | null;
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
