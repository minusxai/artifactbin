/** Group identity is independent of accounts and artifacts. IDs, never handles, carry authority. */
export type GroupRole = 'editor' | 'viewer';
export type ArtifactDestination = {type:'personal'} | {type:'group';id:string};
export type DefaultDestination = ArtifactDestination | {type:'inherit'};
export interface AccountPreferences {default_destination:DefaultDestination;}
/** `parent_id`: the group's parent in the installation's single-parent tree, null for a root (lib/groups hierarchy). */
export interface GroupSummary {id:string;handle:string;name:string;description:string;role:GroupRole|null;parent_id?:string|null;}
export interface GroupMember {user_id:string;username:string|null;name:string|null;role:GroupRole;}
export interface GroupInvitation {id:string;email:string;role:GroupRole;created_at:string;invited_by:string;changed?:boolean;}
export interface GroupDetail {group:GroupSummary;members:GroupMember[];linked_groups:GroupSummary[];invitations?:GroupInvitation[];}
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
