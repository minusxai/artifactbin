import { preservedOrphanActor } from "./orphans.ts";
import type { MigrationMaps } from "./contracts.ts";
import { emailAddress } from "../email.ts";
import { createHash } from "node:crypto";
import { isLegacyNonloginActor } from "../principal-policy.ts";
import type { LegacyArtifact, PlannedPage } from "./contracts.ts";
import type {
  MigrationOwnershipOverride,
  MigrationOwnershipAssignment,
} from "./ownership-override-contracts.ts";
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const migrationOwnershipSourceDigest = (
  artifact: LegacyArtifact,
): string => digest(artifact);
export function migrationOwnershipScopeDigest(
  policy: Omit<MigrationOwnershipOverride, "scopeSha256">,
): string {
  return digest({
    schemaVersion: policy.schemaVersion,
    sourceNamespace: policy.sourceNamespace,
    targetEmail: policy.targetEmail,
    ...(policy.datasetWriteGrants?.length
      ? {
          datasetWriteGrants: [...policy.datasetWriteGrants]
            .sort((a, b) => a.legacyId.localeCompare(b.legacyId))
            .map((g) => ({
              ...g,
              operations: [...g.operations].sort((a, b) =>
                JSON.stringify(a).localeCompare(JSON.stringify(b)),
              ),
            })),
        }
      : {}),
    entries: [...policy.entries].sort((a, b) =>
      a.legacyId.localeCompare(b.legacyId),
    ),
  });
}
export function validateMigrationOwnershipOverride(
  policy: MigrationOwnershipOverride | undefined,
  namespace: string,
  ids?: readonly string[],
): void {
  if (!policy) return;
  if (
    policy.schemaVersion !== 1 ||
    policy.sourceNamespace !== namespace ||
    !namespace ||
    policy.targetEmail !== emailAddress(policy.targetEmail) ||
    policy.entries.length === 0 ||
    policy.scopeSha256 !== migrationOwnershipScopeDigest(policy)
  )
    throw new Error("Invalid migration ownership override scope");
  const seen = new Set<string>();
  const known = ids ? new Set(ids) : null;
  for (const entry of policy.entries) {
    if (
      !entry.legacyId ||
      seen.has(entry.legacyId) ||
      !/^[a-f0-9]{64}$/.test(entry.sourceSha256) ||
      (known && !known.has(entry.legacyId))
    )
      throw new Error("Invalid migration ownership source scope");
    seen.add(entry.legacyId);
  }
  const datasets = new Set<string>();
  for (const grant of policy.datasetWriteGrants ?? []) {
    if (
      !grant.legacyId ||
      datasets.has(grant.legacyId) ||
      seen.has(grant.legacyId) ||
      !/^[a-f0-9]{64}$/.test(grant.sourceSha256) ||
      !/^[a-f0-9]{64}$/.test(grant.originalResourceSha256) ||
      !grant.operations.length
    )
      throw Error("Invalid ownership dataset grant scope");
    datasets.add(grant.legacyId);
    const operations = new Set<string>();
    for (const op of grant.operations) {
      const key = JSON.stringify([op.pageLegacyId, op.operationName]);
      if (
        !seen.has(op.pageLegacyId) ||
        typeof op.operationName !== "string" ||
        !op.operationName ||
        op.operationName.length > 1024 ||
        op.operationName.includes("\0") ||
        operations.has(key)
      )
        throw Error("Invalid ownership dataset operation scope");
      operations.add(key);
    }
  }
}
export function resolveMigrationOwnership(
  artifact: LegacyArtifact,
  namespace: string,
  owner: PlannedPage["owner"],
  policy?: MigrationOwnershipOverride,
): {
  owner: PlannedPage["owner"];
  ownershipAssignment?: MigrationOwnershipAssignment;
} {
  validateMigrationOwnershipOverride(policy, namespace);
  const entry = policy?.entries.find((e) => e.legacyId === artifact.id);
  if (!entry || !policy) return { owner };
  if (
    !owner ||
    owner.kind === "group" ||
    !isLegacyNonloginActor(owner.id) ||
    artifact.format !== "markup" ||
    artifact.deleted_at ||
    entry.sourceSha256 !== migrationOwnershipSourceDigest(artifact)
  )
    throw new Error(
      "Migration ownership assignment does not match preserved source authority",
    );
  const assignedOwner = { kind: "user" as const, id: policy.targetEmail };
  return {
    owner: assignedOwner,
    ownershipAssignment: {
      sourceNamespace: namespace,
      legacyId: artifact.id,
      sourceSha256: entry.sourceSha256,
      scopeSha256: policy.scopeSha256,
      originalOwner: owner,
      assignedOwner,
    },
  };
}

/** Resolves archival ownership without changing identity maps or source records. */
export function originalMigrationOwner(
  artifact: LegacyArtifact,
  namespace: string,
  maps: MigrationMaps,
): PlannedPage["owner"] {
  const orphan = preservedOrphanActor(namespace, artifact);
  const kind = orphan
    ? "orphan"
    : artifact.group_id
      ? "group"
      : artifact.user_id
        ? "user"
        : "token";
  const id =
    orphan ??
    (artifact.group_id
      ? maps.groups[artifact.group_id]
      : artifact.user_id
        ? maps.users[artifact.user_id]
        : maps.tokens[String(artifact.token_id)]);
  return id ? { kind, id } : null;
}
