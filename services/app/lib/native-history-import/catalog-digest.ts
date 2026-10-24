import { createHash } from "node:crypto";
export const nativeCatalogBytes = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
/** Canonical JSON proof; non-JSON values must never collapse to another receipt. */
export function nativeCatalogDigest(value: unknown): string {
  const canonical = (v: unknown): string => {
    if (v === null) return "null";
    if (typeof v === "string" || typeof v === "boolean")
      return JSON.stringify(v);
    if (typeof v === "number" && Number.isFinite(v)) return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + Array.from(v, canonical).join(",") + "]";
    if (
      v &&
      typeof v === "object" &&
      (Object.getPrototypeOf(v) === Object.prototype ||
        Object.getPrototypeOf(v) === null)
    )
      return (
        "{" +
        Object.entries(v)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => JSON.stringify(k) + ":" + canonical(x))
          .join(",") +
        "}"
      );
    throw Error("native_catalog_non_json");
  };
  return nativeCatalogBytes(canonical(value));
}
