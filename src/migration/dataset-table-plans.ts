import type { LegacyRow } from "./contracts.ts";
import type { DatasetMigrationBatch } from "./dataset-destination-contracts.ts";
export type TablePlan = {
  table: string;
  keys: readonly string[];
  rows: LegacyRow[];
  json: readonly string[];
};
export function migrationDatasetTablePlans(
  batch: DatasetMigrationBatch,
): TablePlan[] {
  if (
    batch.queryRegistrations?.some(
      (r) => r.sourceNamespace !== batch.metadata.sourceNamespace,
    )
  )
    throw Error("query_namespace_mismatch");
  const m = batch.metadata,
    n = m.sourceNamespace;
  const plan = (
    table: string,
    keys: string[],
    rows: LegacyRow[],
    json: string[] = [],
  ): TablePlan => ({
    table,
    keys,
    rows: rows.map((row) => ({ source_namespace: n, ...row })),
    json,
  });
  return [
    plan(
      "profile_assets",
      ["asset_id"],
      (batch.profileAssets ?? []).map((asset) => ({
        legacy_user_id: asset.legacyUserId,
        asset_id: asset.assetId,
        sha256: asset.sha256,
        byte_length: asset.byteLength,
        width: asset.width,
        height: asset.height,
        content_type: asset.contentType,
        storage_key: asset.storageKey,
      })),
    ),
    plan(
      "dataset_public_profiles",
      ["legacy_user_id"],
      (m.profiles ?? []).map((r) => ({
        legacy_user_id: r.legacyUserId,
        name: r.name,
        handle: r.handle,
        image: r.image,
      })),
    ),
    plan(
      "dataset_person_bindings",
      [
        "backend_id",
        "backend_version",
        "page_id",
        "page_version",
        "value_name",
      ],
      (m.personBindings ?? []).map((r) => ({
        backend_id: r.backendId,
        backend_version: r.backendVersion,
        page_id: r.pageId,
        page_version: r.pageVersion,
        value_name: r.valueName,
        descriptor: r,
      })),
      ["descriptor"],
    ),
    plan(
      "dataset_resources",
      ["legacy_id"],
      m.resources.map((r) => ({
        legacy_id: r.legacyId,
        current_version: r.currentVersion,
        policy_revision: r.policyRevision,
        owner: r.owner,
        generation: r.generation,
        access: r.access,
        deleted: r.deleted,
        writable: r.writable === true,
        snapshot: r.snapshot,
      })),
      ["access", "snapshot"],
    ),
    plan(
      "dataset_versions",
      ["legacy_id", "version"],
      m.versions.map((r) => ({
        legacy_id: r.legacyId,
        version: r.version,
        catalog: r.tables,
        source_catalog: r.catalog,
        unavailable_tables: r.unavailableTables,
      })),
      ["catalog", "source_catalog", "unavailable_tables"],
    ),
    plan(
      "dataset_principals",
      ["kind", "legacy_id"],
      m.principals.map((r) => ({
        actor: r.actor,
        kind: r.kind,
        legacy_id: r.legacyId,
        identity: r.identity,
        expires_at:
          r.expiresAt === null ? null : new Date(r.expiresAt).toISOString(),
      })),
    ),
    plan(
      "dataset_groups",
      ["legacy_group_id"],
      m.groups.map((r) => ({
        owner: r.owner,
        legacy_group_id: r.legacyGroupId,
      })),
    ),
    plan(
      "dataset_pages",
      ["page_id", "page_version"],
      m.pages.map((r) => ({
        page_id: r.pageId,
        page_version: r.pageVersion,
        snapshot: r.snapshot,
      })),
      ["snapshot"],
    ),
    plan(
      "dataset_bindings",
      ["backend_id", "backend_version", "page_id", "page_version", "name"],
      m.bindings.map((r) => {
        const { tables: _, ...descriptor } = r;
        return {
          backend_id: r.backendId,
          backend_version: r.backendVersion,
          page_id: r.page.id,
          page_version: r.page.version,
          name: r.name,
          dataset_id: r.dataset.id,
          dataset_version: r.dataset.version,
          descriptor,
        };
      }),
      ["descriptor"],
    ),
    plan(
      "dataset_page_joins",
      ["page_id", "legacy_user_id"],
      m.acceptedJoins.map((r) => ({
        page_id: r.pageId,
        legacy_user_id: r.legacyUserId,
        joined_at:
          r.joinedAt == null ? null : new Date(r.joinedAt).toISOString(),
      })),
    ),
    plan(
      "dataset_query_registrations",
      ["backend_id", "backend_version", "page_id", "page_version"],
      (batch.queryRegistrations ?? []).map((r) => ({
        backend_id: r.plan.registration.backendId,
        backend_version: r.plan.registration.backendVersion,
        page_id: r.plan.registration.pageId,
        page_version: r.plan.registration.pageVersion,
        source_sha256: r.plan.registration.sourceSha256,
        registration: r,
      })),
      ["registration"],
    ),
  ];
}
