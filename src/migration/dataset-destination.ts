import { verifyMigrationSourceQueryAuthority } from "./source-query-authority.ts";
import {
  persistDeletedDatasetLifecycleLinks,
  validateDeletedDatasetBatch,
  verifyDeletedDatasetAuthority,
  deletedDatasetBatchFingerprint,
  deletedDatasetAuthoritySha256,
} from "./deleted-dataset-authority.ts";
import {
  verifyAdditiveDatasetBase,
  additiveAuthoritySha256,
  additiveDatasetBatchFingerprint,
} from "./dataset-pages/additive-authority.ts";
import {
  registerSourceQueries,
  verifySourceQueries,
} from "../persistence/source-queries.ts";
import { validateMigrationSourceQueryBatch } from "./source-query-preparation.ts";
import type { MigrationSourceQueryRegistration } from "../datasets/source-query/contracts.ts";
import { validateMigrationOwnershipDatasetGrantBatch } from "./ownership-dataset-grants.ts";
import { persistMigrationOwnershipDatasetGrantAudit } from "./ownership-dataset-grant-audit.ts";
import type { MigrationOwnershipOverride } from "./ownership-override-contracts.ts";
import { registerDatasetAttachments } from "../persistence/dataset-attachments.ts";
import { registerSavedQueries } from "../persistence/dataset-queries.ts";
import { validateMigrationPersonBindings } from "./person-binding-validation.ts";
import { migrationDatasetTablePlans as tablePlans } from "./dataset-table-plans.ts";
import type { TablePlan } from "./dataset-table-plans.ts";
import { registerDatasetMutationOperations } from "../persistence/dataset-mutations.ts";
import { createHash } from "node:crypto";
import type { SqlReader, LegacyRow } from "./contracts.ts";
import type {
  DatasetMetadataDestination,
  DatasetMigrationBatch,
} from "./dataset-destination-contracts.ts";
import { destinationSchemas } from "./destination-schema.ts";

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
  return JSON.stringify(value);
}
/** Strict compare-or-insert only. No upserts can restore revoked policy or change attribution. */
export class PostgresDatasetMetadataDestination
  implements DatasetMetadataDestination
{
  private readonly additiveSchema: string;
  private readonly names: ReturnType<typeof destinationSchemas>;
  private readonly db: SqlReader;
  private readonly ownershipOverride?: MigrationOwnershipOverride;
  private readonly sourceQueryRegistrations?: readonly MigrationSourceQueryRegistration[];
  constructor(
    db: SqlReader,
    schema: string,
    ownershipOverride?: MigrationOwnershipOverride,
    sourceQueryRegistrations?: readonly MigrationSourceQueryRegistration[],
  ) {
    this.ownershipOverride = ownershipOverride;
    this.sourceQueryRegistrations = sourceQueryRegistrations;
    this.db = db;
    this.names = destinationSchemas(schema);
    this.additiveSchema = schema;
  }
  async import(
    batch: DatasetMigrationBatch,
  ): Promise<{ created: number; unchanged: number }> {
    if (
      !/^[a-f0-9]{64}$/.test(batch.baseManifestSha256) ||
      !/^[a-f0-9]{64}$/.test(batch.relationManifestSha256) ||
      !Number.isFinite(Date.parse(batch.relationExportedAt)) ||
      !batch.metadata.sourceNamespace
    )
      throw new Error("Invalid dataset export provenance");
    if (batch.deletedAdditive) validateDeletedDatasetBatch(batch);
    validateMigrationOwnershipDatasetGrantBatch(
      batch.metadata,
      batch.ownershipDatasetGrants,
      batch.additive || batch.deletedAdditive
        ? undefined
        : this.ownershipOverride,
    );
    validateMigrationPersonBindings(batch.metadata);
    validateMigrationSourceQueryBatch(
      batch.metadata,
      batch.sourceQueryRegistrations,
      this.sourceQueryRegistrations,
    );
    const plans = tablePlans(batch);
    const key = (row: LegacyRow, keys: readonly string[]) =>
      canonical(keys.map((k) => row[k]));
    for (const p of plans) {
      const seen = new Set<string>();
      for (const row of p.rows) {
        const id = key(row, p.keys);
        if (seen.has(id))
          throw new Error("Duplicate dataset metadata identity");
        seen.add(id);
      }
    }
    const users = new Set<string>();
    for (const p of batch.metadata.principals)
      if (p.kind === "user") {
        if (users.has(p.actor)) throw new Error("Ambiguous dataset user actor");
        users.add(p.actor);
      }
    const digest = batch.deletedAdditive
      ? deletedDatasetBatchFingerprint(batch)
      : batch.additive
        ? additiveDatasetBatchFingerprint(batch)
        : createHash("sha256").update(canonical(batch)).digest("hex");
    const result = { created: 0, unchanged: 0 };
    await this.db.query("BEGIN");
    try {
      await this.db.query(`SET LOCAL search_path TO ${this.names.runtime}`);
      // Locks serialize migration reruns against live revocations while comparing current authority.
      await this.db.query(
        `LOCK TABLE ${[...plans.map((p) => this.names.runtime + "." + p.table), this.names.runtime + ".dataset_mutation_operations", this.names.runtime + ".dataset_source_queries", this.names.runtime + ".dataset_viewer_bindings", ...(batch.deletedAdditive ? [this.names.runtime + ".dataset_member_bindings", this.names.runtime + ".dataset_deleted_page_lifecycle_links", this.names.runtime + ".dataset_deleted_lifecycle_links"] : [])].join(",")} IN SHARE ROW EXCLUSIVE MODE`,
      );
      if (batch.deletedAdditive)
        await verifyDeletedDatasetAuthority(
          this.db,
          this.additiveSchema,
          batch,
        );
      if (batch.additive)
        await verifyAdditiveDatasetBase(this.db, this.additiveSchema, batch);
      for (const group of batch.sourceQueryRegistrations ?? [])
        await verifyMigrationSourceQueryAuthority(this.db, this.additiveSchema, batch, group);
      for (const binding of batch.metadata.bindings) {
        const compiled = await this.db.query(
          `SELECT 1 FROM ${this.names.runtime}.af_backend_versions v JOIN ${this.names.runtime}.af_page_backends p ON p.file_id=v.file_id AND p.version=v.version WHERE v.file_id=$1 AND v.version=$2 AND p.page_id=$3 AND p.page_version=$4`,
          [
            binding.backendId,
            binding.backendVersion,
            binding.page.id,
            binding.page.version,
          ],
        );
        if (!compiled.rows.length)
          throw new Error(
            "Dataset binding requires an existing compiled backend and page link",
          );
      }
      const missing: { plan: TablePlan; row: LegacyRow }[] = [];
      for (const p of plans) {
        const rows = (
          await this.db.query(
            `SELECT row_to_json(t) AS value FROM ${this.names.runtime}.${p.table} t WHERE source_namespace=$1`,
            [batch.metadata.sourceNamespace],
          )
        ).rows.map((r) => {
          const row = r.value as LegacyRow;
          if (p.table === "dataset_principals" && row.expires_at !== null)
            row.expires_at = new Date(String(row.expires_at)).toISOString();
          if (p.table === "dataset_page_joins" && row.joined_at !== null)
            row.joined_at = new Date(String(row.joined_at)).toISOString();
          return row;
        });
        const existing = new Map(rows.map((row) => [key(row, p.keys), row]));
        for (const row of p.rows) {
          const old = existing.get(key(row, p.keys));
          if (old) {
            if (canonical(old) !== canonical(row))
              throw new Error(`Existing dataset metadata differs (${p.table})`);
            result.unchanged++;
          } else missing.push({ plan: p, row });
        }
        if (p.table === "dataset_principals")
          for (const row of p.rows)
            if (
              row.kind === "user" &&
              rows.some(
                (old) =>
                  old.kind === "user" &&
                  old.actor === row.actor &&
                  old.legacy_id !== row.legacy_id,
              )
            )
              throw new Error("Existing dataset user identity differs");
        if (p.table === "dataset_page_joins") {
          const touched = new Set(batch.metadata.pages.map((r) => r.pageId));
          // Existing page metadata means its current joins must match exactly; never re-add a removed join.
          const priorPages = (
            await this.db.query(
              `SELECT page_id FROM ${this.names.runtime}.dataset_pages WHERE source_namespace=$1`,
              [batch.metadata.sourceNamespace],
            )
          ).rows;
          for (const page of priorPages)
            if (touched.has(String(page.page_id))) {
              const select = (items: LegacyRow[]) =>
                items
                  .filter((r) => r.page_id === page.page_id)
                  .map((r) => key(r, p.keys))
                  .sort();
              if (canonical(select(rows)) !== canonical(select(p.rows)))
                throw new Error("Existing dataset joins differ");
            }
        }
      }
      await this.db.query(
        `CREATE TABLE IF NOT EXISTS ${this.names.archive}.dataset_receipts (source_namespace text PRIMARY KEY, fingerprint text NOT NULL, base_manifest_sha256 text NOT NULL, relation_manifest_sha256 text NOT NULL, relation_exported_at text NOT NULL)`,
      );
      if (batch.additive)
        await this.db.query(
          `CREATE TABLE IF NOT EXISTS ${this.names.archive}.dataset_additive_receipts (source_namespace text NOT NULL,authority_sha256 text NOT NULL,fingerprint text NOT NULL,base_fingerprint text NOT NULL,PRIMARY KEY(source_namespace,authority_sha256))`,
        );
      if (batch.deletedAdditive)
        await this.db.query(
          `CREATE TABLE IF NOT EXISTS ${this.names.archive}.dataset_deleted_additive_receipts (source_namespace text NOT NULL,authority_sha256 text NOT NULL,fingerprint text NOT NULL,base_fingerprint text NOT NULL,PRIMARY KEY(source_namespace,authority_sha256))`,
        );
      const receipt = batch.deletedAdditive
        ? (
            await this.db.query(
              `SELECT fingerprint FROM ${this.names.archive}.dataset_deleted_additive_receipts WHERE source_namespace=$1 AND authority_sha256=$2`,
              [
                batch.metadata.sourceNamespace,
                deletedDatasetAuthoritySha256(batch.deletedAdditive),
              ],
            )
          ).rows[0]
        : batch.additive
          ? (
              await this.db.query(
                `SELECT fingerprint FROM ${this.names.archive}.dataset_additive_receipts WHERE source_namespace=$1 AND authority_sha256=$2`,
                [
                  batch.metadata.sourceNamespace,
                  additiveAuthoritySha256(batch.additive),
                ],
              )
            ).rows[0]
          : (
              await this.db.query(
                `SELECT fingerprint FROM ${this.names.archive}.dataset_receipts WHERE source_namespace=$1`,
                [batch.metadata.sourceNamespace],
              )
            ).rows[0];
      if (receipt && receipt.fingerprint !== digest)
        throw new Error("Dataset migration receipt differs");
      if (receipt && missing.length)
        throw new Error("Dataset migration metadata was removed after import");
      await persistMigrationOwnershipDatasetGrantAudit(
        this.db,
        this.names.archive,
        batch.metadata.sourceNamespace,
        batch.ownershipDatasetGrants ?? [],
        Boolean(receipt),
      );
      for (const { plan: p, row } of missing) {
        const columns = Object.keys(row);
        await this.db.query(
          `INSERT INTO ${this.names.runtime}.${p.table} (${columns.join(",")}) VALUES (${columns.map((c, i) => "$" + (i + 1) + (p.json.includes(c) ? "::jsonb" : "")).join(",")})`,
          columns.map((c) =>
            p.json.includes(c) ? JSON.stringify(row[c]) : row[c],
          ),
        );
        result.created++;
      }
      const operations = batch.metadata.operations ?? [];
      if (receipt)
        for (const { operation: o } of operations) {
          const existing = await this.db.query(
            `SELECT 1 FROM ${this.names.runtime}.dataset_mutation_operations WHERE backend_id=$1 AND backend_version=$2 AND page_id=$3 AND page_version=$4 AND name=$5`,
            [o.backendId, o.backendVersion, o.page.id, o.page.version, o.name],
          );
          if (!existing.rows.length)
            throw new Error(
              "Dataset migration operation was removed after import",
            );
        }
      await registerDatasetMutationOperations(
        {
          query: async (text, values) => {
            const r = await this.db.query(
              text,
              values ? [...values] : undefined,
            );
            return { ...r, rowCount: null };
          },
          release: () => {},
        },
        operations,
      );
      const sourceQueryClient = {
        query: async (text: string, values?: readonly unknown[]) => ({
          ...(await this.db.query(text, values ? [...values] : undefined)),
          rowCount: null,
        }),
      };
      for (const group of batch.sourceQueryRegistrations ?? []) {
        if (receipt)
          await verifySourceQueries(
            sourceQueryClient,
            group.receipt,
            batch.metadata.sourceNamespace,
            group.queries,
          );
        await registerSourceQueries(
          sourceQueryClient,
          group.receipt,
          batch.metadata.sourceNamespace,
          group.queries,
        );
      }
      for (const registration of batch.queryRegistrations ?? [])
        await registerSavedQueries(
          {
            query: async (text, values) => ({
              ...(await this.db.query(text, values ? [...values] : undefined)),
              rowCount: null,
            }),
            release: () => {},
          },
          registration,
        );
      await registerDatasetAttachments({
        client: {
          query: async (text, values) => ({
            ...(await this.db.query(text, values ? [...values] : undefined)),
            rowCount: null,
          }),
          release: () => {},
        },
        registrations: batch.metadata.attachments ?? [],
      });
      if (batch.deletedAdditive) {
        const authority = deletedDatasetAuthoritySha256(batch.deletedAdditive);
        await persistDeletedDatasetLifecycleLinks(
          this.db,
          this.additiveSchema,
          batch,
          Boolean(receipt),
        );
        await verifyDeletedDatasetAuthority(
          this.db,
          this.additiveSchema,
          batch,
          true,
        );
        if (!receipt)
          await this.db.query(
            `INSERT INTO ${this.names.archive}.dataset_deleted_additive_receipts VALUES ($1,$2,$3,$4)`,
            [
              batch.metadata.sourceNamespace,
              authority,
              digest,
              batch.deletedAdditive.base.inventory.datasetFingerprint,
            ],
          );
      }
      if (!receipt && batch.additive)
        await this.db.query(
          `INSERT INTO ${this.names.archive}.dataset_additive_receipts VALUES ($1,$2,$3,$4)`,
          [
            batch.metadata.sourceNamespace,
            additiveAuthoritySha256(batch.additive),
            digest,
            batch.additive.base.inventory.datasetFingerprint,
          ],
        );
      if (!receipt && !batch.additive && !batch.deletedAdditive)
        await this.db.query(
          `INSERT INTO ${this.names.archive}.dataset_receipts VALUES ($1,$2,$3,$4,$5)`,
          [
            batch.metadata.sourceNamespace,
            digest,
            batch.baseManifestSha256,
            batch.relationManifestSha256,
            batch.relationExportedAt,
          ],
        );
      await this.db.query("COMMIT");
      return result;
    } catch (error) {
      await this.db.query("ROLLBACK");
      throw error;
    }
  }
}
