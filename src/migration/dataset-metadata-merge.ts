import type { DatasetImportMetadata } from "../datasets/import-contracts.ts";
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? "[" + value.map(canonical).join(",") + "]"
    : value && typeof value === "object"
      ? "{" +
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
          .join(",") +
        "}"
      : (JSON.stringify(value) ?? "null");
/** Retains one copy of each identity while per-page plans can be released immediately. */
export function createDatasetMetadataAccumulator(namespace: string): {
  add(part: DatasetImportMetadata): void;
  finish(): DatasetImportMetadata;
} {
  if (!namespace) throw new Error("Dataset metadata namespace mismatch");
  const result: DatasetImportMetadata = {
    sourceNamespace: namespace,
    bindings: [],
    operations: [],
    profiles: [],
    personBindings: [],
    pages: [],
    resources: [],
    versions: [],
    principals: [],
    groups: [],
    acceptedJoins: [],
  };
  const keys = {
    profiles: (r: NonNullable<DatasetImportMetadata["profiles"]>[number]) => [
      r.legacyUserId,
    ],
    personBindings: (
      r: NonNullable<DatasetImportMetadata["personBindings"]>[number],
    ) => [r.backendId, r.backendVersion, r.pageId, r.pageVersion, r.valueName],
    operations: (
      r: NonNullable<DatasetImportMetadata["operations"]>[number],
    ) => [
      r.operation.backendId,
      r.operation.backendVersion,
      r.operation.page.id,
      r.operation.page.version,
      r.operation.name,
    ],
    bindings: (r: DatasetImportMetadata["bindings"][number]) => [
      r.backendId,
      r.backendVersion,
      r.page.id,
      r.page.version,
      r.name,
    ],
    pages: (r: DatasetImportMetadata["pages"][number]) => [
      r.pageId,
      r.pageVersion,
    ],
    resources: (r: DatasetImportMetadata["resources"][number]) => [r.legacyId],
    versions: (r: DatasetImportMetadata["versions"][number]) => [
      r.legacyId,
      r.version,
    ],
    principals: (r: DatasetImportMetadata["principals"][number]) => [
      r.kind,
      r.legacyId,
    ],
    groups: (r: DatasetImportMetadata["groups"][number]) => [r.legacyGroupId],
    acceptedJoins: (r: DatasetImportMetadata["acceptedJoins"][number]) => [
      r.pageId,
      r.legacyUserId,
    ],
  };
  const names = Object.keys(keys) as (keyof typeof keys)[];
  const tables = new Map(
    names.map((name) => [
      name,
      new Map<string, { value: unknown; digest: string }>(),
    ]),
  );
  return {
    add(part) {
      if (part.sourceNamespace !== namespace)
        throw new Error("Dataset metadata namespace mismatch");
      for (const name of names)
        for (const row of part[name] ?? []) {
          const rows = tables.get(name)!;
          const key = canonical((keys[name] as (r: unknown) => unknown)(row));
          const digest = canonical(row);
          const prior = rows.get(key);
          if (prior && prior.digest !== digest)
            throw new Error("Conflicting dataset metadata identity");
          if (!prior) rows.set(key, { value: row, digest });
        }
    },
    finish() {
      for (const name of names)
        (result[name] as unknown[]).splice(
          0,
          Infinity,
          ...[...tables.get(name)!.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, row]) => row.value),
        );
      return result;
    },
  };
}
/** Exact union; conflicts never depend on traversal order. */
export function mergeDatasetMetadata(
  parts: readonly DatasetImportMetadata[],
): DatasetImportMetadata {
  const accumulator = createDatasetMetadataAccumulator(
    parts[0]?.sourceNamespace ?? "",
  );
  for (const part of parts) accumulator.add(part);
  return accumulator.finish();
}
