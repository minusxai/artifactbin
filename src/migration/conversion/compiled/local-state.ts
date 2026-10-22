import type { LocalDeclaration } from "./local-contracts.ts";
/** Both the migration boundary and emitted boot validate the same viewer-state shape. */
export function validLocalValue(d: LocalDeclaration, value: unknown): boolean {
  function scalar(v: unknown, type: string): boolean {
    return (
      v === null ||
      (typeof v === type && (typeof v !== "number" || Number.isFinite(v)))
    );
  }
  if (d.type !== "table") return scalar(value, d.type);
  if (
    !Array.isArray(d.columns) ||
    d.columns.length > 256 ||
    d.columns.some((c) => !c || typeof c !== "object") ||
    new Set(d.columns.map((c) => c.name)).size !== d.columns.length ||
    d.columns.some(
      (c) =>
        !c ||
        typeof c.name !== "string" ||
        ["__proto__", "constructor", "prototype"].includes(c.name) ||
        !["string", "number", "boolean"].includes(c.type),
    )
  )
    return false;
  return (
    Array.isArray(value) &&
    value.length <= 10_000 &&
    value.every(
      (row) =>
        row &&
        typeof row === "object" &&
        !Array.isArray(row) &&
        Object.keys(row).every((key) =>
          d.columns.some((c) => c.name === key),
        ) &&
        d.columns.every((c) =>
          scalar(Object.hasOwn(row, c.name) ? row[c.name] : null, c.type),
        ),
    )
  );
}
