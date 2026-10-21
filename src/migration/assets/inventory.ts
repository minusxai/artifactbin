import type { LegacyRow } from "../contracts.ts";
import {
  planAssets,
  type AssetPlan,
  type AssetObject,
  type AssetSnapshot,
  type AssetReference,
} from "./index.ts";

export interface AssetArchiveRow {
  readonly table: "artifacts" | "artifact_versions";
  readonly row: LegacyRow;
}
export type AssetInventoryWarningCode =
  | "invalid_identity"
  | "invalid_metadata"
  | "missing_object_key"
  | "invalid_asset_metadata"
  | "conflicting_object_metadata";
export interface AssetInventoryWarning {
  readonly code: AssetInventoryWarningCode;
  readonly artifactId?: string;
  readonly version?: number;
  readonly objectKey?: string;
}
export interface AssetInventory {
  readonly plan: AssetPlan;
  readonly warnings: readonly AssetInventoryWarning[];
  readonly summary: {
    readonly rowsScanned: number;
    readonly assetHeads: number;
    readonly assetVersions: number;
    readonly acceptedSnapshots: number;
    readonly objects: number;
    readonly references: number;
    readonly knownBytes: number;
    readonly objectsWithoutAuthoritativeSize: number;
    readonly warnings: Readonly<
      Partial<Record<AssetInventoryWarningCode, number>>
    >;
  };
}
/** Only asset metadata survives this pass; source documents and unrelated rows are released. */
export async function inventoryAssets(
  rows: AsyncIterable<AssetArchiveRow>,
): Promise<AssetInventory> {
  const objects = new Map<
    string,
    {
      objectKey: string;
      contentType: string;
      expectedBytes?: number;
      references: AssetReference[];
    }
  >();
  const conflicted = new Set<string>();
  const warnings: AssetInventoryWarning[] = [];
  const counts: Partial<Record<AssetInventoryWarningCode, number>> = {};
  let rowsScanned = 0,
    assetHeads = 0,
    assetVersions = 0,
    acceptedSnapshots = 0;
  const warn = (warning: AssetInventoryWarning) => {
    warnings.push(Object.freeze(warning));
    counts[warning.code] = (counts[warning.code] ?? 0) + 1;
  };
  for await (const { table, row } of rows) {
    rowsScanned++;
    if (row.format !== "image" && row.format !== "file" && row.format !== "pdf")
      continue;
    if (table === "artifacts") assetHeads++;
    else assetVersions++;
    const artifactId = table === "artifacts" ? row.id : row.artifact_id;
    const version = row.version;
    if (
      typeof artifactId !== "string" ||
      !artifactId ||
      typeof version !== "number" ||
      !Number.isSafeInteger(version) ||
      version < 1
    ) {
      warn({ code: "invalid_identity" });
      continue;
    }
    const identity = { artifactId, version };
    const meta = row.meta;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
      warn({ code: "invalid_metadata", ...identity });
      continue;
    }
    if (
      !("objectKey" in meta) ||
      meta.objectKey === null ||
      meta.objectKey === ""
    ) {
      warn({ code: "missing_object_key", ...identity });
      continue;
    }
    let planned: AssetPlan;
    try {
      planned = planAssets([
        {
          ...identity,
          format: row.format,
          meta: meta as AssetSnapshot["meta"],
        },
      ]);
    } catch {
      warn({ code: "invalid_asset_metadata", ...identity });
      continue;
    }
    acceptedSnapshots++;
    for (const object of planned.objects) {
      if (conflicted.has(object.objectKey)) {
        for (const reference of object.references)
          warn({
            code: "conflicting_object_metadata",
            artifactId: reference.artifactId,
            version: reference.version,
            objectKey: object.objectKey,
          });
        continue;
      }
      const prior = objects.get(object.objectKey);
      if (
        prior &&
        (prior.contentType !== object.contentType ||
          (prior.expectedBytes !== undefined &&
            object.expectedBytes !== undefined &&
            prior.expectedBytes !== object.expectedBytes))
      ) {
        for (const reference of [...prior.references, ...object.references])
          warn({
            code: "conflicting_object_metadata",
            artifactId: reference.artifactId,
            version: reference.version,
            objectKey: object.objectKey,
          });
        objects.delete(object.objectKey);
        conflicted.add(object.objectKey);
        continue;
      }
      if (prior) {
        prior.references.push(...object.references);
        if (object.expectedBytes !== undefined)
          prior.expectedBytes = object.expectedBytes;
      } else
        objects.set(object.objectKey, {
          ...object,
          references: [...object.references],
        });
    }
  }
  const planned = Object.freeze(
    [...objects.values()].map((object) =>
      Object.freeze({
        ...object,
        references: Object.freeze(object.references),
      }),
    ),
  ) as readonly AssetObject[];
  return Object.freeze({
    plan: Object.freeze({ objects: planned }),
    warnings: Object.freeze(warnings),
    summary: Object.freeze({
      rowsScanned,
      assetHeads,
      assetVersions,
      acceptedSnapshots,
      objects: planned.length,
      references: planned.reduce(
        (total, object) => total + object.references.length,
        0,
      ),
      knownBytes: planned.reduce(
        (total, object) => total + (object.expectedBytes ?? 0),
        0,
      ),
      objectsWithoutAuthoritativeSize: planned.filter(
        (object) => object.expectedBytes === undefined,
      ).length,
      warnings: Object.freeze(counts),
    }),
  });
}
