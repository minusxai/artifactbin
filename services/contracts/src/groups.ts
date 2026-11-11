import {isValidHandle} from './handles';
/** Group identity is independent of accounts and artifacts. IDs, never handles, carry authority. */
export type GroupRole = 'editor' | 'viewer';
export type ArtifactDestination = {type:'personal'} | {type:'group';id:string};
export type DefaultDestination = ArtifactDestination | {type:'inherit'};
export interface AccountPreferences {default_destination:DefaultDestination;}
/** `parent_id`: the group's parent in the installation's single-parent tree, null for a root (lib/groups hierarchy). */
export interface GroupSummary {id:string;handle:string;name:string;description:string;role:GroupRole|null;parent_id?:string|null;}
export interface GroupMember {user_id:string;username:string|null;name:string|null;role:GroupRole;}
/**
 * One page a group's member can open through the group (`GET /api/groups/{id}/artifacts`): an html page the group, or
 * one of its ancestors, owns or is shared with (a share reaches a group's subtree). A page readable only through its
 * link is never listed. Ids, titles, display names and counts only.
 */
export interface GroupArtifact {
  id:string;title:string;updated_at:string;
  owner:{kind:'user'|'group';name:string};
  /** The groups on the asked group's chain the page is shared with; never a group outside that chain. */
  shared_with:{id:string;name:string}[];
  /** Open comment threads. */
  comments:number;
}
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
/**
 * A create-group request normalized (handle lowercased and trimmed, name and description trimmed), or null when it
 * is malformed: the one rule the app checks before charging its quota and the identity module enforces.
 */
export function normalizeCreateGroup(input:{handle?:unknown;name?:unknown;description?:unknown;parent_id?:unknown}|null|undefined):{handle:string;name:string;description:string;parentId:string|null}|null{
 if(typeof input?.handle!=='string'||typeof input?.name!=='string'||(input.description!==undefined&&typeof input.description!=='string')
  ||(input.parent_id!==undefined&&input.parent_id!==null&&(typeof input.parent_id!=='string'||!input.parent_id)))return null;
 const handle=input.handle.toLowerCase().trim(),name=input.name.trim(),description=(input.description as string|undefined)?.trim()??'';
 if(!isValidHandle(handle)||!name||name.length>120||description.length>2000)return null;
 return {handle,name,description,parentId:(input.parent_id as string|null|undefined)??null};
}
