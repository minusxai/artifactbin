import { emailAddress } from "../../email.ts";
import { nativeDigest } from "./selection.ts";
import type {
  NativeV3IdentityInput,
  NativeV3IdentityPlan,
  NativeV3IdentityUser,
} from "./v3-identity-contracts.ts";
/** Offline creation plan only: no credentials are copied and no grants are inferred. */
export function planNativeV3Identities(
  input: NativeV3IdentityInput,
): NativeV3IdentityPlan {
  const index = <T extends { id: string }>(rows: readonly T[]) => {
    const map = new Map<string, T>();
    for (const row of rows) {
      if (!row.id || map.has(row.id))
        throw Error("Invalid or duplicate inventory key");
      map.set(row.id, row);
    }
    return map;
  };
  const source = index(input.sourceUsers),
    target = index(input.targetUsers),
    tokens = index(input.sourceTokens),
    targetTokens = index(input.targetTokens);
  const clock = Date.parse(input.targetCollectedAt);
  if (!Number.isFinite(clock)) throw Error("Invalid inventory clock");
  const email = (u: NativeV3IdentityUser) => {
    if (!u.email) return null;
    try {
      return emailAddress(u.email);
    } catch {
      return null;
    }
  };
  const required = new Set(input.requiredUserIds),
    requiredTokens = [...new Set(input.requiredTokenIds)].sort();
  for (const id of requiredTokens) {
    const owner = tokens.get(id)?.user_id;
    if (owner) required.add(owner);
  }
  for (const id of required) {
    const row = source.get(id);
    for (const linked of [row?.parent_user_id, row?.merged_into_user_id])
      if (linked) required.add(linked);
  }
  const mappedUsers: Record<string, { userId: string; email: string | null }> =
      {},
    mappedActors: Record<string, { userId: string }> = {},
    mappedTokens: Record<string, { tokenId: string }> = {};
  const result: NativeV3IdentityPlan = {
    sourceNamespace: input.sourceNamespace,
    sourceInventorySha256: input.sourceInventorySha256,
    targetInventorySha256: input.targetInventorySha256,
    targets: { actors: mappedActors, users: mappedUsers, tokens: mappedTokens },
    targetIdentitySha256: "",
    users: [],
    createUsers: [],
    tokens: [],
    artifactIds: {},
    userCellMappings: [],
    blockers: [],
    sha256: "",
  };
  const block = (
    kind: "user" | "token" | "artifact",
    sourceId: string,
    code: string,
  ) => result.blockers.push({ kind, sourceId, code });
  for (const id of [...required].sort()) {
    const row = source.get(id);
    if (!row) {
      block("user", id, "source_user_missing");
      continue;
    }
    const normalized = email(row);
    if (row.email && !normalized) {
      block("user", id, "source_email_invalid");
      continue;
    }
    const matches = normalized
      ? input.targetUsers.filter((u) => email(u) === normalized)
      : [];
    const sameId = target.get(id);
    if (sameId && (!normalized || email(sameId) !== normalized)) {
      block("user", id, "source_user_id_occupied");
      continue;
    }
    let reuse: NativeV3IdentityUser | undefined;
    if (matches.length) {
      if (row.kind !== "account") {
        block("user", id, "source_email_unverified");
        continue;
      }
      const candidate = matches[0]!;
      if (
        matches.length !== 1 ||
        candidate.kind !== "account" ||
        candidate.merged_into_user_id ||
        (candidate.expires_at &&
          (!Number.isFinite(Date.parse(candidate.expires_at)) ||
            Date.parse(candidate.expires_at) <= clock))
      ) {
        block("user", id, "target_email_unverified");
        continue;
      }
      reuse = candidate;
    } else if (
      normalized &&
      [...required].filter((key) => {
        const u = source.get(key);
        return u && email(u) === normalized;
      }).length > 1
    ) {
      block("user", id, "source_email_ambiguous");
      continue;
    }
    const actor = input.legacyMaps.users[id];
    if (!actor) {
      block("user", id, "source_actor_missing");
      continue;
    }
    const targetId = reuse?.id ?? id,
      sourceRowSha256 = nativeDigest(row),
      targetRowSha256 = reuse ? nativeDigest(reuse) : undefined;
    const prior = result.targets.actors[actor];
    if (prior && prior.userId !== targetId) {
      block("user", id, "source_actor_ambiguous");
      continue;
    }
    mappedUsers[id] = { userId: targetId, email: normalized };
    mappedActors[actor] = { userId: targetId };
    result.users.push({
      sourceId: id,
      targetId,
      action: reuse ? "reuse-verified-email" : "create-preserved",
      sourceRowSha256,
      ...(targetRowSha256 ? { targetRowSha256 } : {}),
    });
    if (!reuse)
      result.createUsers.push({
        ...row,
        email: normalized,
        sourceId: id,
        sourceRowSha256,
      });
    else if (targetId !== id)
      result.userCellMappings.push({
        sourceUserId: id,
        targetUserId: targetId,
        sourceRowSha256,
        targetRowSha256: targetRowSha256!,
        reason: "verified-email",
      });
  }
  // References in proposed account rows point to explicit mapped identities, never guessed IDs.
  for (const row of result.createUsers) {
    for (const key of ["parent_user_id", "merged_into_user_id"] as const) {
      const ref = row[key];
      if (ref) {
        const mapped = result.targets.users[ref];
        if (!mapped) block("user", row.id, "source_user_reference_unmapped");
        else row[key] = mapped.userId;
      }
    }
  }
  for (const id of requiredTokens) {
    const row = tokens.get(id);
    if (!row) {
      block("token", id, "source_token_missing");
      continue;
    }
    if (targetTokens.has(id)) {
      block("token", id, "token_id_occupied");
      continue;
    }
    const userId = row.user_id
      ? result.targets.users[row.user_id]?.userId
      : null;
    if (row.user_id && !userId) {
      block("token", id, "token_owner_unmapped");
      continue;
    }
    mappedTokens[id] = { tokenId: id };
    result.tokens.push({
      sourceId: id,
      targetId: id,
      userId: userId ?? null,
      action: "create-disabled-provenance",
      sourceRowSha256: nativeDigest(row),
      sourceCreatedAt: row.created_at ?? null,
      sourceDeletedAt: row.deleted_at ?? null,
      sourceExpiresAt: row.expires_at ?? null,
    });
  }
  const occupied = new Set(
    [...input.targetArtifacts, ...input.targetReservations].map((r) => r.id),
  );
  for (const id of [...new Set(input.artifactIds)].sort()) {
    if (occupied.has(id)) block("artifact", id, "artifact_id_occupied");
    else result.artifactIds[id] = id;
  }
  result.targetIdentitySha256 = nativeDigest(result.targets);
  const { sha256: _, ...proof } = result;
  result.sha256 = nativeDigest(proof);
  return result;
}
