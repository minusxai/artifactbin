import { nativeCatalogBytes, nativeCatalogDigest } from "./catalog-digest";
import type {
  NativeCatalogUserTable,
  NativeCatalogUserDerivation,
  NativeCatalogUserRemap,
} from "./catalog-user-remap-contracts";
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export const nativeUserBindingKey = (
  t: Pick<NativeCatalogUserTable, "sourceId" | "version" | "schema" | "table">,
) => JSON.stringify([t.sourceId, t.version, t.schema, t.table]);
/** Only authoritative catalog types select identity-bearing cells. */
export function nativeCatalogUserTables(
  meta: Record<string, unknown>,
  sourceId: string,
  version: number,
): NativeCatalogUserTable[] {
  const catalog = record(meta.catalog) ? meta.catalog : null;
  const tables = catalog
    ? Array.isArray(catalog.tables)
      ? catalog.tables
      : []
    : [
        {
          schema: "public",
          name: "rows",
          columns: meta.columns,
          objectKey: meta.objectKey,
        },
      ];
  const out: NativeCatalogUserTable[] = [];
  for (const raw of tables) {
    if (!record(raw) || !Array.isArray(raw.columns)) continue;
    const columns = raw.columns
      .filter((c) => record(c) && c.type === "user")
      .map((c) => c.name);
    if (!columns.length) continue;
    if (
      columns.some((c) => typeof c !== "string" || !c) ||
      new Set(columns).size !== columns.length
    )
      throw Error("native_catalog_user_columns");
    if (typeof raw.objectKey !== "string")
      throw Error("native_catalog_unmaterialized_user_table");
    if (typeof raw.schema !== "string" || typeof raw.name !== "string")
      throw Error("native_catalog_user_table");
    out.push({
      sourceId,
      version,
      schema: raw.schema,
      table: raw.name,
      sourceMetaSha256: nativeCatalogDigest(meta),
      sourceObjectKey: raw.objectKey,
      userColumns: columns as string[],
    });
  }
  return out;
}
export function deriveNativeUserObject(
  table: NativeCatalogUserTable,
  bytes: Buffer,
  users: Readonly<Record<string, string>>,
  identityPlanSha256: string,
): NativeCatalogUserDerivation | null {
  const sourceSha256 = nativeCatalogBytes(bytes);
  if (table.sourceObjectKey !== "dataset/" + sourceSha256.slice(0, 32))
    throw Error("native_catalog_user_source_key");
  const rows: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (!Array.isArray(rows)) throw Error("native_catalog_user_rows");
  let changedCells = 0;
  for (const row of rows) {
    if (!record(row)) throw Error("native_catalog_user_row");
    for (const column of table.userColumns) {
      const value = Object.hasOwn(row, column) ? row[column] : null;
      if (value === null || value === "") continue;
      if (
        typeof value !== "string" ||
        !Object.hasOwn(users, value) ||
        typeof users[value] !== "string" ||
        !users[value]
      )
        throw Error("native_catalog_user_identity_unmapped");
      const target = users[value]!;
      if (target !== value) {
        row[column] = target;
        changedCells++;
      }
    }
  }
  if (!changedCells) return null;
  if (!/^[a-f0-9]{64}$/.test(identityPlanSha256))
    throw Error("native_catalog_user_identity_plan_required");
  const targetBytes = Buffer.from(JSON.stringify(rows)),
    targetSha256 = nativeCatalogBytes(targetBytes),
    body = {
      ...table,
      sourceSha256,
      sourceBytes: bytes.length,
      identityPlanSha256,
      usersSha256: nativeCatalogDigest(users),
      targetKey: "dataset/" + targetSha256.slice(0, 32),
      targetSha256,
      targetBytes: targetBytes.length,
      changedCells,
    };
  return {
    receipt: { ...body, receiptSha256: nativeCatalogDigest(body) },
    bytes: targetBytes,
  };
}
/** Reconstruct the sole permitted metadata difference from the canonical source, not a caller-supplied column claim. */
export function remapNativeCatalogMetadata(
  original: Record<string, unknown>,
  mapped: Record<string, unknown>,
  sourceId: string,
  version: number,
  remaps: readonly NativeCatalogUserRemap[],
): Record<string, unknown> {
  const copy = structuredClone(mapped),
    tables = nativeCatalogUserTables(original, sourceId, version),
    seen = new Set<string>();
  for (const receipt of remaps) {
    const key = nativeUserBindingKey(receipt);
    if (seen.has(key)) throw Error("native_catalog_duplicate_user_remap");
    seen.add(key);
    const table = tables.find((t) => nativeUserBindingKey(t) === key);
    if (
      !table ||
      nativeCatalogDigest(table) !==
        nativeCatalogDigest(
          Object.fromEntries(
            Object.keys(table).map((k) => [
              k,
              receipt[k as keyof NativeCatalogUserTable],
            ]),
          ),
        )
    )
      throw Error("native_catalog_user_table_proof");
    if (receipt.targetKey !== "dataset/" + receipt.targetSha256.slice(0, 32))
      throw Error("native_catalog_user_target_key");
    if (record(copy.catalog) && Array.isArray(copy.catalog.tables)) {
      const target = copy.catalog.tables.find(
        (t) => record(t) && t.schema === table.schema && t.name === table.table,
      );
      if (!record(target) || target.objectKey !== table.sourceObjectKey)
        throw Error("native_catalog_user_catalog_changed");
      target.objectKey = receipt.targetKey;
    }
    if (
      table.schema === "public" &&
      table.table === "rows" &&
      copy.objectKey === table.sourceObjectKey
    )
      copy.objectKey = receipt.targetKey;
  }
  return copy;
}
