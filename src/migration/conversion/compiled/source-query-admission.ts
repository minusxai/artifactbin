import type { CompiledSourceQueryBinding } from "./source-query-contracts.ts";
const types = new Set([
  "string",
  "number",
  "boolean",
  "date",
  "timestamp",
  "user",
]);
const record = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);
export function validCompiledSourceQueries(
  value: unknown,
): value is readonly CompiledSourceQueryBinding[] {
  return (
    Array.isArray(value) &&
    value.length <= 128 &&
    new Set(value.map((b) => b?.name)).size === value.length &&
    value.every(
      (b) =>
        record(b) &&
        Object.keys(b).sort().join(",") ===
          "backendHref,backendNamespace,columns,name,params,sourceRef,sqlSha256" &&
        typeof b.name === "string" &&
        /^[A-Za-z][A-Za-z0-9_]*$/.test(b.name) &&
        typeof b.sourceRef === "string" &&
        /^ref:[A-Za-z0-9]{6,12}$/.test(b.sourceRef) &&
        b.backendNamespace === "legacyData" &&
        typeof b.backendHref === "string" &&
        /^\/af\/v1\/ids\/[A-Za-z0-9]{6}$/.test(b.backendHref) &&
        typeof b.sqlSha256 === "string" &&
        /^[a-f0-9]{64}$/.test(b.sqlSha256) &&
        record(b.params) &&
        Object.keys(b.params).length <= 256 &&
        Object.entries(b.params).every(
          ([k, v]) =>
            /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) &&
            k !== "__proto__" &&
            types.has(String(v)),
        ) &&
        Array.isArray(b.columns) &&
        b.columns.length > 0 &&
        b.columns.length <= 256 &&
        new Set(b.columns.map((c) => c?.name)).size === b.columns.length &&
        b.columns.every(
          (c) =>
            record(c) &&
            Object.keys(c).sort().join(",") === "name,type" &&
            typeof c.name === "string" &&
            c.name.length > 0 &&
            c.name.length <= 256 &&
            c.name !== "__proto__" &&
            types.has(String(c.type)),
        ),
    )
  );
}
