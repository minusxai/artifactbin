import { fail } from "./errors.ts";
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

/** Select a namespace only after loading the current actor's trusted facts. */
export function namespaceOwner(actor: string, selected: string | undefined, write: boolean, facts?: GroupAuthorityFacts): string {
  if (selected === undefined || selected === actor) return actor;
  const authority = ownerAuthority(selected, true, actor, facts);
  if (!authority.role || (write && authority.role !== "editor"))
    fail(403, "You do not have access to this owner namespace");
  return selected;
}
