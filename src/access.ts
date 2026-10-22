import type {
  SharedFile,
  AccessPolicy,
  FilePermissions,
  AccessPatch,
  ShareRole,
} from "./contracts.ts";
import { fail } from "./errors.ts";
import { emailAddress } from "./email.ts";
import { ownerAuthority } from "./group-authority.ts";
import type { GroupAuthorityFacts } from "./group-authority-contracts.ts";
const roles: ShareRole[] = ["viewer", "commenter", "editor"];
export function policyFor(file: Pick<SharedFile, "access">): AccessPolicy {
  return (
    file.access || {
      visibility: "unlisted",
      linkRole: "commenter",
      shares: {},
      version: 0,
    }
  );
}
export function permissions(
  file: Pick<SharedFile, "owner" | "access"> & { ownerKind?: "user" | "group" },
  actor: string | null,
  link: boolean,
  scoped = false,
  groupFacts?: GroupAuthorityFacts,
): FilePermissions {
  const p = policyFor(file);
  const authority = ownerAuthority(file.owner, file.ownerKind === "group", actor, groupFacts);
  if (authority.owns || authority.role === "editor")
    return {
      role: "owner",
      read: true,
      comment: true,
      edit: !scoped,
      manage: !scoped,
    };
  const named =
    actor && Object.hasOwn(p.shares, actor) ? p.shares[actor] : null;
  const linked = link && p.visibility !== "private" ? p.linkRole : null;
  const rank = Math.max(
    roles.indexOf(named as ShareRole),
    authority.role === "viewer" ? 0 : -1,
    roles.indexOf(linked as ShareRole),
  );
  const role = roles[rank] || null;
  return {
    role,
    read: !!role,
    comment: !!actor && rank >= 1,
    edit: !!actor && rank >= 2 && !scoped,
    manage: false,
  };
}
export function updatePolicy(
  file: Pick<SharedFile, "owner" | "access">,
  patch: AccessPatch,
  version: number,
): AccessPolicy {
  const old = policyFor(file);
  if (version !== old.version)
    fail(412, "Sharing changed. Reload it before saving.");
  const p = { ...old, shares: { ...old.shares }, version: old.version + 1 };
  if ("visibility" in patch) {
    if (!["public", "unlisted", "private"].includes(patch.visibility))
      fail(422, "Invalid visibility");
    p.visibility = patch.visibility;
  } else if ("linkRole" in patch) {
    if (!roles.includes(patch.linkRole)) fail(422, "Invalid role");
    p.linkRole = patch.linkRole;
  } else if ("email" in patch) {
    const email = emailAddress(patch.email);
    if (email === file.owner) fail(422, "The owner always retains access.");
    if (patch.role === null) delete p.shares[email];
    else {
      if (!roles.includes(patch.role)) fail(422, "Invalid role");
      p.shares[email] = patch.role;
    }
    if (Object.keys(p.shares).length > 200)
      fail(422, "A file can have up to 200 invited emails.");
  } else fail(422, "Choose a sharing change");
  return p;
}
