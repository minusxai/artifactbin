import {validateMigrationUserChoiceBindings} from "./user-choice-bindings.ts";
import { verifyMigrationSourceQueryAuthority } from "./source-query-authority.ts";
import {
  verifyDeletedDatasetAuthority,
  verifyDeletedDatasetLifecycleLinks,
  deletedDatasetBatchFingerprint,
  deletedDatasetAuthoritySha256,
  isProtectedDeletedDatasetRow,
} from "./deleted-dataset-authority.ts";
import {
  verifyAdditiveDatasetBase,
  additiveAuthoritySha256,
  additiveDatasetBatchFingerprint,
  additiveRowSha256,
  normalizeAdditiveRow,
} from "./dataset-pages/additive-authority.ts";
import { verifySourceQueries } from "../persistence/source-queries.ts";
import { validateMigrationSourceQueryBatch } from "./source-query-preparation.ts";
import type { MigrationSourceQueryRegistration } from "../datasets/source-query/contracts.ts";
import { validateMigrationOwnershipDatasetGrantBatch } from "./ownership-dataset-grants.ts";
import { verifyMigrationOwnershipDatasetGrantAudit } from "./ownership-dataset-grant-audit.ts";
import type { MigrationOwnershipOverride } from "./ownership-override-contracts.ts";
import { migrationDatasetTablePlans } from "./dataset-table-plans.ts";
import { destinationSchemas } from "./destination-schema.ts";
import {
  requireMigrationEquality as equal,
  canonicalMigrationValue,
} from "./verification-values.ts";
import type { SqlReader, LegacyRow } from "./contracts.ts";
import type { DatasetMigrationBatch } from "./dataset-destination-contracts.ts";
/** Exact current policy and immutable provenance are read from runtime tables, never accepted from a receipt. */
export async function verifyMigrationDatasetMetadata(
  db: SqlReader,
  schema: string,
  batch: DatasetMigrationBatch,
  ownershipOverride?: MigrationOwnershipOverride,
  sourceQueryRegistrations?: readonly MigrationSourceQueryRegistration[],
): Promise<number> {
  validateMigrationUserChoiceBindings(batch.metadata);
  validateMigrationOwnershipDatasetGrantBatch(
    batch.metadata,
    batch.ownershipDatasetGrants,
    batch.additive || batch.deletedAdditive ? undefined : ownershipOverride,
  );
  validateMigrationSourceQueryBatch(
    batch.metadata,
    batch.sourceQueryRegistrations,
    sourceQueryRegistrations,
  );
  const { runtime, archive } = destinationSchemas(schema);
  if (batch.deletedAdditive)
    await verifyDeletedDatasetAuthority(db, schema, batch, true);
  if (batch.additive) await verifyAdditiveDatasetBase(db, schema, batch);
  let count = 0;
  for (const plan of migrationDatasetTablePlans(batch)) {
    const key = (row: LegacyRow) =>
      canonicalMigrationValue(plan.keys.map((k) => row[k]));
    const expected = new Map(plan.rows.map((row) => [key(row), row]));
    let offset = 0;
    while (true) {
      const rows = (
        await db.query(
          `SELECT row_to_json(t) AS value FROM ${runtime}.${plan.table} t WHERE source_namespace=$1 ORDER BY ${plan.keys.join(",")} LIMIT 20 OFFSET $2`,
          [batch.metadata.sourceNamespace, offset],
        )
      ).rows;
      if (!rows.length) break;
      for (const item of rows) {
        const row = item.value as LegacyRow;
        if (plan.table === "dataset_principals" && row.expires_at !== null)
          row.expires_at = new Date(String(row.expires_at)).toISOString();
        if (plan.table === "dataset_page_joins" && row.joined_at !== null)
          row.joined_at = new Date(String(row.joined_at)).toISOString();
        const k = key(row);
        const wanted = expected.get(k);
        if (
          !wanted &&
          batch.additive?.base.inventory.tables
            .find((t) => t.table === plan.table)
            ?.rows.some(
              (r) =>
                canonicalMigrationValue(r.key) === k &&
                r.sha256 === additiveRowSha256(normalizeAdditiveRow(row)),
            )
        )
          continue;
        if (
          !wanted &&
          isProtectedDeletedDatasetRow(
            batch,
            plan.table,
            plan.keys.map((k) => row[k]),
            row,
          )
        )
          continue;
        if (!wanted)
          throw Error(
            "Migration verification failed: unexpected dataset metadata",
          );
        equal(row, wanted, "dataset policy/catalog/principal metadata");
        expected.delete(k);
        count++;
      }
      offset += rows.length;
    }
    if (expected.size)
      throw Error("Migration verification failed: missing dataset metadata");
  }
  const operations = batch.metadata.operations ?? [];
  const expected = new Map(
    operations.map((r) => [
      canonicalMigrationValue([
        r.operation.backendId,
        r.operation.backendVersion,
        r.operation.page.id,
        r.operation.page.version,
        r.operation.name,
      ]),
      r,
    ]),
  );
  let offset = 0;
  while (true) {
    const rows = (
      await db.query(
        `SELECT backend_id,backend_version,page_id,page_version::text,name,source_namespace,binding_name,dataset_id,operation FROM ${runtime}.dataset_mutation_operations WHERE source_namespace=$1 ORDER BY backend_id,backend_version,page_id,page_version,name LIMIT 20 OFFSET $2`,
        [batch.metadata.sourceNamespace, offset],
      )
    ).rows;
    if (!rows.length) break;
    for (const row of rows) {
      const k = canonicalMigrationValue([
        row.backend_id,
        row.backend_version,
        row.page_id,
        Number(row.page_version),
        row.name,
      ]);
      const wanted = expected.get(k);
      if (
        !wanted &&
        batch.additive?.base.inventory.protectedRows.some(
          (r) =>
            r.table === "dataset_mutation_operations" &&
            canonicalMigrationValue(r.key) === k &&
            r.sha256 ===
              additiveRowSha256({
                ...row,
                page_version: Number(row.page_version),
              }),
        )
      )
        continue;
      if (
        !wanted &&
        batch.deletedAdditive?.base.inventory.protectedRows.some(
          (r) =>
            r.table === "dataset_mutation_operations" &&
            canonicalMigrationValue(r.key) === k &&
            r.sha256 ===
              additiveRowSha256({
                ...row,
                page_version: Number(row.page_version),
              }),
        )
      )
        continue;
      if (!wanted)
        throw Error(
          "Migration verification failed: unexpected dataset operation",
        );
      equal(
        row,
        {
          backend_id: wanted.operation.backendId,
          backend_version: wanted.operation.backendVersion,
          page_id: wanted.operation.page.id,
          page_version: String(wanted.operation.page.version),
          name: wanted.operation.name,
          source_namespace: wanted.sourceNamespace,
          binding_name: wanted.bindingName,
          dataset_id: wanted.operation.datasetId,
          operation: wanted.operation,
        },
        "dataset operation content",
      );
      expected.delete(k);
      count++;
    }
    offset += rows.length;
  }
  if (expected.size)
    throw Error("Migration verification failed: missing dataset operation");
  equal(
    (
      await db.query(
        `SELECT base_manifest_sha256,relation_manifest_sha256,relation_exported_at FROM ${archive}.dataset_receipts WHERE source_namespace=$1`,
        [batch.metadata.sourceNamespace],
      )
    ).rows,
    [
      {
        base_manifest_sha256: batch.baseManifestSha256,
        relation_manifest_sha256: batch.relationManifestSha256,
        relation_exported_at: batch.relationExportedAt,
      },
    ],
    "dataset independent snapshot provenance",
  );
  if (batch.deletedAdditive) {
    await verifyDeletedDatasetLifecycleLinks(db, schema, batch);
    equal(
      (
        await db.query(
          `SELECT fingerprint,base_fingerprint FROM ${archive}.dataset_deleted_additive_receipts WHERE source_namespace=$1 AND authority_sha256=$2`,
          [
            batch.metadata.sourceNamespace,
            deletedDatasetAuthoritySha256(batch.deletedAdditive),
          ],
        )
      ).rows,
      [
        {
          fingerprint: deletedDatasetBatchFingerprint(batch),
          base_fingerprint:
            batch.deletedAdditive.base.inventory.datasetFingerprint,
        },
      ],
      "deleted additive dataset receipt",
    );
  }
  if (batch.additive) {
    const receipt = (
      await db.query(
        `SELECT fingerprint,base_fingerprint FROM ${archive}.dataset_additive_receipts WHERE source_namespace=$1 AND authority_sha256=$2`,
        [
          batch.metadata.sourceNamespace,
          additiveAuthoritySha256(batch.additive),
        ],
      )
    ).rows;
    equal(
      receipt,
      [
        {
          fingerprint: additiveDatasetBatchFingerprint(batch),
          base_fingerprint: batch.additive.base.inventory.datasetFingerprint,
        },
      ],
      "additive dataset receipt",
    );
  }
  count += await verifyMigrationOwnershipDatasetGrantAudit(
    db,
    archive,
    batch.metadata.sourceNamespace,
    batch.ownershipDatasetGrants ?? [],
  );
  const sourceQueryClient = {
    query: async (text: string, values?: readonly unknown[]) => ({
      ...(await db.query(
        text.replace(
          /\bdataset_source_queries\b/g,
          `${runtime}.dataset_source_queries`,
        ),
        values ? [...values] : undefined,
      )),
      rowCount: null,
    }),
  };
  for (const group of batch.sourceQueryRegistrations ?? []) {
    await verifyMigrationSourceQueryAuthority(db, schema, batch, group);
    await verifySourceQueries(
      sourceQueryClient,
      group.receipt,
      batch.metadata.sourceNamespace,
      group.queries,
    );
    count += group.queries.length;
  }
  return count;
}
