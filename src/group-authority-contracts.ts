/** A group owner is a non-login principal, never the authenticated member. */
export type GroupRole = "viewer" | "editor";
export interface GroupMembership {
  readonly owner: string;
  readonly role: GroupRole;
}
/** Fresh repository facts, read under the group's transaction lock. */
export interface GroupAuthorityFacts {
  readonly actor: string;
  readonly memberships: readonly GroupMembership[];
}
export interface OwnerAuthority {
  readonly group: boolean;
  readonly role: GroupRole | null;
  readonly owns: boolean;
}
export interface GroupMembershipRepository {
  /** Replacement/removal serializes against all authorized transactions. */
  set(owner: string, actor: string, role: GroupRole | null): Promise<void>;
}
/** Omitted owner means the authenticated user's personal namespace. */
export interface OwnerNamespaceSelection {
  owner?: string;
}
/** Membership-derived navigation metadata; a selected owner never grants authority. */
export interface LibraryNamespace {
  readonly owner: string;
  readonly kind: "personal" | "group";
  readonly name: string;
  readonly handle: string | null;
  readonly role: GroupRole | null;
}
