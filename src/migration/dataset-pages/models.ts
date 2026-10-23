import { validateTable } from "../../datasets/rows.ts";
import { createHash } from "node:crypto";
import { storedModelDependenciesSha256 } from "../../datasets/stored-model/attestation.ts";
import type { StoredModelAttestation } from "../../datasets/stored-model/contracts.ts";
import type { DatasetImportMetadata } from "../../datasets/import-contracts.ts";
import type { LegacyRow } from "../contracts.ts";
import { canonicalMigrationValue } from "../verification-values.ts";
import { canonical, record } from "../datasets/catalog.ts";
/** Original catalog SQL alone is never admission. Every model requires exact operator attestation. */
export function attestStandaloneDatasetModels(
  row: LegacyRow,
  version: DatasetImportMetadata["versions"][number],
  approved: readonly StoredModelAttestation[],
): readonly StoredModelAttestation[] {
  const catalog =
    record(row.meta) && record(row.meta.catalog) ? row.meta.catalog : null;
  if (
    !catalog ||
    catalog.kind !== "stored" ||
    !Array.isArray(catalog.tables) ||
    row.version !== version.version ||
    (row.artifact_id ?? row.id) !== version.legacyId
  )
    throw Error("Stored model source identity differs");
  const models = version.unavailableTables;
  if (approved.length && !version.tables.length)
    throw Error("Stored model physical dependencies required");
  for (const model of approved)
    validateTable({
      schema: model.schema,
      name: model.table,
      columns: model.columns,
      object: version.tables[0]!.object,
    });
  if (
    models.some((t) => t.reason !== "model") ||
    models.length !== approved.length ||
    new Set(approved.map((m) => JSON.stringify([m.schema, m.table]))).size !==
      approved.length
  )
    throw Error("Stored model admission incomplete");
  const artifactSha256 = createHash("sha256")
      .update(canonical(row))
      .digest("hex"),
    dependenciesSha256 = storedModelDependenciesSha256(version.tables);
  for (const unavailable of models) {
    const original = catalog.tables.find(
      (t) =>
        record(t) &&
        t.schema === unavailable.schema &&
        t.name === unavailable.name,
    );
    const expected = approved.find(
      (t) => t.schema === unavailable.schema && t.table === unavailable.name,
    );
    if (
      !record(original) ||
      typeof original.sql !== "string" ||
      !original.sql.trim() ||
      original.modelCellId !== undefined ||
      original.source !== undefined ||
      !Array.isArray(original.columns) ||
      !expected ||
      expected.sourceArtifactSha256 !== artifactSha256 ||
      expected.dependencyDescriptorSha256 !== dependenciesSha256 ||
      expected.modelSqlSha256 !==
        createHash("sha256").update(original.sql).digest("hex") ||
      canonicalMigrationValue(expected.columns) !==
        canonicalMigrationValue(
          original.columns.map((c) => {
            if (!record(c)) throw Error("Invalid model columns");
            return { name: c.name, type: c.type };
          }),
        )
    )
      throw Error("Stored model source or dependencies changed");
  }
  return structuredClone(approved);
}
