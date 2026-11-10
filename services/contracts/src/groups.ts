/** Group identity is independent of accounts and artifacts. IDs, never handles, carry authority. */
export type GroupRole = 'editor' | 'viewer';
export type ArtifactDestination = {type:'personal'} | {type:'group';id:string};
export type DefaultDestination = ArtifactDestination | {type:'inherit'};
export interface AccountPreferences {default_destination:DefaultDestination;}
/** `parent_id`: the group's parent in the installation's single-parent tree, null for a root (lib/groups hierarchy). */
export interface GroupSummary {id:string;handle:string;name:string;description:string;role:GroupRole|null;parent_id?:string|null;}
export interface GroupMember {user_id:string;username:string|null;name:string|null;role:GroupRole;}
export interface GroupInvitation {id:string;email:string;role:GroupRole;created_at:string;invited_by:string;changed?:boolean;}
/** A group beside the one being read (its parent, a subgroup): `role` is the reader's own DIRECT membership of it, null for none. */
export interface GroupRelative {id:string;handle:string;name:string;role:GroupRole|null;}
/** Someone who is NOT a member of the group but receives what is shared with it, through a subgroup (`via`) they are a direct member of. */
export interface GroupAudienceMember {user_id:string;username:string|null;name:string|null;via:{id:string;handle:string;name:string};}
/**
 * `members` are DIRECT members only. `parent` and `subgroups` place the group in the installation's tree;
 * `subgroup_audience` (at most 100) lists the people its shares also reach through its subgroups.
 */
export interface GroupDetail {group:GroupSummary;members:GroupMember[];linked_groups:GroupSummary[];invitations?:GroupInvitation[];parent:GroupRelative|null;subgroups:GroupRelative[];subgroup_audience:GroupAudienceMember[];}
export interface DeploymentState {mode:'public'|'company';setup_complete:boolean;is_owner:boolean;default_group:GroupSummary|null;}
export interface CreateGroupInput {handle:string;name:string;description?:string;parent_id?:string|null;}
export interface NewArtifactDestinationContext {
 explicit?:ArtifactDestination;
 parent?:ArtifactDestination;
 preference?:DefaultDestination;
 deployment_default?:ArtifactDestination;
}

export interface UpdateGroupInput {name?:string;description?:string;}
export type GroupShareRole = 'viewer' | 'commenter' | 'editor';
export interface GroupShare {group:GroupSummary;role:GroupShareRole;}
