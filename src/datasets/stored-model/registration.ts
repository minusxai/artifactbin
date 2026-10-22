import { createHash } from "node:crypto";
import type { DatasetResolvedBinding } from "../contracts.ts";
import type {
  RegisteredStoredModel,
  StoredModelAttestation,
} from "./contracts.ts";
import { storedModelDependenciesSha256 } from "./attestation.ts";
import { record } from "../sql/read-job.ts";
/** Decode only a server snapshot marker and the exact original version catalog. */
export function resolveStoredModelRegistration(
  binding: DatasetResolvedBinding,
  requested: { schema: string; table: string },
  snapshot: unknown,
  sourceCatalog: unknown,
): RegisteredStoredModel | null {
  if (
    !record(snapshot) ||
    !record(snapshot.standaloneDataset) ||
    !record(sourceCatalog)
  )
    return null;
  const marker = snapshot.standaloneDataset;
  if (binding.revision.version !== binding.dataset.version) return null;
  if (
    snapshot.id !== binding.page.legacyId ||
    snapshot.editId !== binding.page.editId ||
    snapshot.format !== "dataset" ||
    marker.kind !== "dataset-self-read-v1" ||
    marker.datasetId !== binding.dataset.id ||
    marker.version !== binding.page.version ||
    !Array.isArray(marker.models) ||
    marker.models.length > 64 ||
    sourceCatalog.kind !== "stored" ||
    !Array.isArray(sourceCatalog.tables)
  )
    return null;
  const matches = marker.models.filter(
    (m) =>
      record(m) && m.schema === requested.schema && m.table === requested.table,
  );
  const originals = sourceCatalog.tables.filter(
    (t) =>
      record(t) && t.schema === requested.schema && t.name === requested.table,
  );
  if (matches.length !== 1 || originals.length !== 1) return null;
  const attestation = matches[0] as StoredModelAttestation;
  const original = originals[0] as Record<string, unknown>;
  if (
    !Array.isArray(attestation.columns) ||
    attestation.columns.some((c) => !record(c))
  )
    return null;
  if (
    ![
      attestation.modelSqlSha256,
      attestation.sourceArtifactSha256,
      attestation.dependencyDescriptorSha256,
    ].every((x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x)) ||
    typeof original.sql !== "string" ||
    original.modelCellId !== undefined ||
    original.objectKey !== undefined ||
    !Array.isArray(original.columns)
  )
    return null;
  const columns = original.columns.map((c) =>
    record(c) ? { name: c.name, type: c.type } : null,
  );
  if (
    JSON.stringify(columns) !==
      JSON.stringify(
        attestation.columns.map((c) => ({ name: c.name, type: c.type })),
      ) ||
    createHash("sha256").update(original.sql).digest("hex") !==
      attestation.modelSqlSha256 ||
    storedModelDependenciesSha256(binding.tables) !==
      attestation.dependencyDescriptorSha256
  )
    return null;
  return {
    datasetVersion: binding.revision.version,
    sourceSha256: attestation.sourceArtifactSha256,
    schema: requested.schema,
    table: requested.table,
    columns: attestation.columns,
    sql: original.sql,
    dependencies: binding.tables,
  };
}
