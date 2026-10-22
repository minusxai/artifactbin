import { createHash } from "node:crypto";
import type { DatasetTable } from "../contracts.ts";
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, v]) => JSON.stringify(key) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
/** Full physical descriptors, sorted by schema/name; object key, hash and byte length included. */
export function storedModelDependenciesSha256(
  tables: readonly DatasetTable[],
): string {
  return createHash("sha256")
    .update(
      canonical(
        [...tables].sort((a, b) => {
          const x = JSON.stringify([a.schema, a.name]),
            y = JSON.stringify([b.schema, b.name]);
          return x < y ? -1 : x > y ? 1 : 0;
        }),
      ),
    )
    .digest("hex");
}
