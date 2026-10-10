/** Group identity is independent of accounts and artifacts. IDs, never handles, carry authority. */
export type GroupRole = 'editor' | 'viewer';
export type ArtifactDestination = {type:'personal'} | {type:'group';id:string};
export type DefaultDestination = ArtifactDestination | {type:'inherit'};
export interface AccountPreferences {default_destination:DefaultDestination;}
export interface GroupSummary {id:string;handle:string;name:string;description:string;role:GroupRole|null;}
export interface GroupMember {user_id:string;username:string|null;name:string|null;role:GroupRole;}
export interface GroupInvitation {id:string;email:string;role:GroupRole;created_at:string;}
export interface GroupDetail {group:GroupSummary;members:GroupMember[];linked_groups:GroupSummary[];invitations?:GroupInvitation[];}
export interface DeploymentState {mode:'public'|'company';setup_complete:boolean;is_owner:boolean;default_group:GroupSummary|null;}
export interface CreateGroupInput {handle:string;name:string;description?:string;}
export interface NewArtifactDestinationContext {
 explicit?:ArtifactDestination;
 parent?:ArtifactDestination;
 preference?:DefaultDestination;
 deployment_default?:ArtifactDestination;
}
