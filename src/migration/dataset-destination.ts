import { createHash } from "node:crypto";
import type { SqlReader, LegacyRow } from "./contracts.ts";
import type {
  DatasetMetadataDestination,
  DatasetMigrationBatch,
} from "./dataset-destination-contracts.ts";
import { destinationSchemas } from "./destination-schema.ts";

type TablePlan = {
  table: string;
  keys: readonly string[];
  rows: LegacyRow[];
  json: readonly string[];
};
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
function tablePlans(batch: DatasetMigrationBatch): TablePlan[] {
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
      })),
    ),
  ];
}
/** Strict compare-or-insert only. No upserts can restore revoked policy or change attribution. */
export class PostgresDatasetMetadataDestination
  implements DatasetMetadataDestination
{
  private readonly names: ReturnType<typeof destinationSchemas>;
  private readonly db: SqlReader;
  constructor(db: SqlReader, schema: string) {
    this.db = db;
    this.names = destinationSchemas(schema);
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
    const digest = createHash("sha256").update(canonical(batch)).digest("hex");
    const result = { created: 0, unchanged: 0 };
    await this.db.query("BEGIN");
    try {
      // Locks serialize migration reruns against live revocations while comparing current authority.
      await this.db.query(
        `LOCK TABLE ${plans.map((p) => this.names.runtime + "." + p.table).join(",")} IN SHARE ROW EXCLUSIVE MODE`,
      );
      for (const binding of batch.metadata.bindings) {
        const compiled = await this.db.query(
          `SELECT 1 FROM ${this.names.runtime}.af_backend_versions v JOIN ${this.names.runtime}.af_page_backends p ON p.file_id=v.file_id AND p.version=v.version WHERE v.file_id=$1 AND v.version=$2 AND p.page_id=$3 AND p.page_version=$4 AND p.name=$5`,
          [
            binding.backendId,
            binding.backendVersion,
            binding.page.id,
            binding.page.version,
            binding.name,
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
          return row;
        });
        const existing = new Map(rows.map((row) => [key(row, p.keys), row]));
        for (const row of p.rows) {
          const old = existing.get(key(row, p.keys));
          if (old) {
            if (canonical(old) !== canonical(row))
              throw new Error("Existing dataset metadata differs");
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
      const receipt = (
        await this.db.query(
          `SELECT fingerprint FROM ${this.names.archive}.dataset_receipts WHERE source_namespace=$1`,
          [batch.metadata.sourceNamespace],
        )
      ).rows[0];
      if (receipt && receipt.fingerprint !== digest)
        throw new Error("Dataset migration receipt differs");
      if (receipt && missing.length)
        throw new Error("Dataset migration metadata was removed after import");
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
      if (!receipt)
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
