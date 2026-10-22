import type { GroupAuthorityFacts, OwnerAuthority } from "./group-authority-contracts.ts";
/** Never infer group ownership from an email, a client role, or a matching actor. */
export function ownerAuthority(
  owner: string,
  group: boolean,
  actor: string | null,
  facts?: GroupAuthorityFacts,
): OwnerAuthority {
  if (!group) return { group: false, role: null, owns: actor !== null && actor === owner };
  const member = actor && facts?.actor === actor
    ? facts.memberships.find((entry) => entry.owner === owner)
    : undefined;
  return { group: true, role: member?.role === "editor" || member?.role === "viewer" ? member.role : null, owns: false };
}
