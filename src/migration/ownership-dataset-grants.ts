import { createHash } from "node:crypto";
import type { DatasetImportMetadata } from "../datasets/import-contracts.ts";
import type { MigrationJobSource } from "./job-contracts.ts";
import type { MigrationOwnershipOverride } from "./ownership-override-contracts.ts";
import type { MigrationOwnershipDatasetGrantAudit } from "./ownership-dataset-grants-contracts.ts";
import {
  migrationOwnershipSourceDigest,
  validateMigrationOwnershipOverride,
} from "./ownership-override.ts";
import { canonicalMigrationValue } from "./verification-values.ts";
const canonical = canonicalMigrationValue;
export const migrationOwnershipResourceDigest = (resource: unknown): string =>
  createHash("sha256").update(canonical(resource)).digest("hex");
const key = (op: { pageLegacyId: string; operationName: string }) =>
  JSON.stringify([op.pageLegacyId, op.operationName]);
const operationKeys = (metadata: DatasetImportMetadata, id: string) => [
  ...new Map(
    (metadata.operations ?? [])
      .filter((r) => r.operation.datasetId === id)
      .map((r) => {
        const item = {
          pageLegacyId: r.operation.page.legacyId,
          operationName: r.operation.name,
        };
        return [key(item), item] as const;
      }),
  ).values(),
];
function validateAudit(
  audit: MigrationOwnershipDatasetGrantAudit,
  policy: MigrationOwnershipOverride,
): void {
  const grant = policy.datasetWriteGrants?.find(
    (g) => g.legacyId === audit.datasetLegacyId,
  );
  if (
    !grant ||
    audit.sourceNamespace !== policy.sourceNamespace ||
    audit.scopeSha256 !== policy.scopeSha256 ||
    audit.assignedEditor !== policy.targetEmail ||
    audit.sourceSha256 !== grant.sourceSha256 ||
    migrationOwnershipSourceDigest(audit.originalSource) !==
      grant.sourceSha256 ||
    migrationOwnershipResourceDigest(audit.originalResource) !==
      grant.originalResourceSha256
  )
    throw Error("Ownership dataset grant source or scope differs");
  const source = audit.originalSource,
    resource = audit.originalResource;
  if (
    source.id !== grant.legacyId ||
    source.format !== "dataset" ||
    source.deleted_at ||
    source.access !== "readwrite" ||
    source.dataset_policy != null ||
    resource.legacyId !== source.id ||
    !resource.writable ||
    resource.deleted ||
    resource.snapshot.policy !== null ||
    resource.currentVersion !== source.version ||
    resource.owner === policy.targetEmail ||
    !["public", "unlisted"].includes(resource.access.visibility) ||
    resource.access.visibility !== source.visibility
  )
    throw Error("Ownership dataset grant authority differs");
  const allowed = new Set(grant.operations.map(key));
  const seen = new Set<string>();
  for (const op of audit.operations) {
    if (!allowed.has(key(op)) || seen.has(key(op)))
      throw Error("Ownership dataset grant operation differs");
    seen.add(key(op));
  }
  if (!seen.size) throw Error("Empty ownership dataset grant");
}
export async function prepareMigrationOwnershipDatasetGrants(
  source: MigrationJobSource,
  metadata: DatasetImportMetadata,
  policy?: MigrationOwnershipOverride,
): Promise<MigrationOwnershipDatasetGrantAudit[]> {
  validateMigrationOwnershipOverride(policy, source.manifest.sourceNamespace);
  if (!policy?.datasetWriteGrants?.length) return [];
  const audits: MigrationOwnershipDatasetGrantAudit[] = [];
  for (const grant of policy.datasetWriteGrants) {
    const originalSource = (await source.readArtifact(grant.legacyId))
      .artifacts[0]!;
    const resource = metadata.resources.find(
      (r) => r.legacyId === grant.legacyId,
    );
    if (!resource) throw Error("Ownership dataset grant resource unavailable");
    const operations = operationKeys(metadata, grant.legacyId).filter((op) =>
      policy.entries.some((e) => e.legacyId === op.pageLegacyId),
    );
    if (
      canonical(operations.map(key).sort()) !==
      canonical(grant.operations.map(key).sort())
    )
      throw Error("Ownership dataset grant registered operations differ");
    for (const id of new Set(operations.map((op) => op.pageLegacyId))) {
      const page = (await source.readArtifact(id)).artifacts[0]!;
      if (
        migrationOwnershipSourceDigest(page) !==
        policy.entries.find((e) => e.legacyId === id)?.sourceSha256
      )
        throw Error("Ownership dataset grant page source differs");
    }
    const audit = {
      sourceNamespace: metadata.sourceNamespace,
      scopeSha256: policy.scopeSha256,
      datasetLegacyId: grant.legacyId,
      sourceSha256: grant.sourceSha256,
      originalSource,
      originalResource: resource,
      assignedEditor: policy.targetEmail,
      operations,
    };
    validateAudit(audit, policy);
    audits.push(audit);
  }
  return audits;
}
/** Projection occurs after readiness selection; blocked write pages never cause grants. */
export function projectMigrationOwnershipDatasetGrants(
  metadata: DatasetImportMetadata,
  audits: readonly MigrationOwnershipDatasetGrantAudit[] = [],
  policy?: MigrationOwnershipOverride,
): {
  metadata: DatasetImportMetadata;
  ownershipDatasetGrants: MigrationOwnershipDatasetGrantAudit[];
} {
  if (!policy) {
    if (audits.length)
      throw Error("Trusted ownership policy required for dataset grants");
    return { metadata, ownershipDatasetGrants: [] };
  }
  validateMigrationOwnershipOverride(policy, metadata.sourceNamespace);
  const selected: MigrationOwnershipDatasetGrantAudit[] = [];
  const resources = [...metadata.resources];
  const seen = new Set<string>();
  for (const audit of audits) {
    validateAudit(audit, policy);
    if (seen.has(audit.datasetLegacyId))
      throw Error("Duplicate ownership dataset grant");
    seen.add(audit.datasetLegacyId);
    const approved = new Set(audit.operations.map(key));
    const operations = operationKeys(metadata, audit.datasetLegacyId).filter(
      (op) => approved.has(key(op)),
    );
    if (!operations.length) continue;
    const index = resources.findIndex(
      (r) => r.legacyId === audit.datasetLegacyId,
    );
    if (
      index < 0 ||
      canonical(resources[index]) !== canonical(audit.originalResource)
    )
      throw Error("Ownership dataset original resource differs");
    const current = resources[index]!;
    resources[index] = {
      ...current,
      access: {
        ...current.access,
        shares: { ...current.access.shares, [policy.targetEmail]: "editor" },
      },
    };
    selected.push({ ...audit, operations });
  }
  return {
    metadata: { ...metadata, resources },
    ownershipDatasetGrants: selected,
  };
}
/** Independent import check; callers cannot introduce editor shares outside the trusted projection. */
export function validateMigrationOwnershipDatasetGrantBatch(
  metadata: DatasetImportMetadata,
  audits: readonly MigrationOwnershipDatasetGrantAudit[] = [],
  policy?: MigrationOwnershipOverride,
): void {
  if (!policy) {
    if (audits.length)
      throw Error("Trusted ownership policy required for dataset grants");
    return;
  }
  const originals = {
    ...metadata,
    resources: metadata.resources.map(
      (resource) =>
        audits.find((a) => a.datasetLegacyId === resource.legacyId)
          ?.originalResource ?? resource,
    ),
  };
  const expected = projectMigrationOwnershipDatasetGrants(
    originals,
    audits,
    policy,
  );
  if (
    canonical(expected.metadata) !== canonical(metadata) ||
    canonical(expected.ownershipDatasetGrants) !== canonical(audits)
  )
    throw Error("Ownership dataset grant projection differs");
  for (const grant of policy.datasetWriteGrants ?? []) {
    const resource = metadata.resources.find(
      (r) => r.legacyId === grant.legacyId,
    );
    if (
      resource &&
      !audits.some((a) => a.datasetLegacyId === grant.legacyId) &&
      migrationOwnershipResourceDigest(resource) !==
        grant.originalResourceSha256
    )
      throw Error("Unattested ownership dataset resource");
  }
}
