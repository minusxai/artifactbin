import type { BoundValueColumnProof } from "./bound-value-contracts.ts";
const identifier = (v: unknown) =>
  typeof v === "string" &&
  /^[A-Za-z][A-Za-z0-9_]*$/.test(v) &&
  !["__proto__", "constructor", "prototype"].includes(v);
/** Exact bounded offline registry shape. This does not grant read or write access. */
export function validBoundValueProof(
  value: unknown,
): value is BoundValueColumnProof {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as BoundValueColumnProof;
  if (
    Object.keys(p).some(
      (k) =>
        ![
          "valueName",
          "sourceRef",
          "version",
          "bindingName",
          "schema",
          "table",
          "column",
          "type",
          "constraints",
        ].includes(k),
    ) ||
    !Number.isSafeInteger(p.version) ||
    p.version < 1 ||
    !identifier(p.valueName) ||
    !identifier(p.bindingName) ||
    typeof p.sourceRef !== "string" ||
    !/^ref:[A-Za-z0-9]{6,12}$/.test(p.sourceRef) ||
    typeof p.schema !== "string" ||
    !p.schema ||
    p.schema.length > 256 ||
    p.table !== "rows" ||
    typeof p.column !== "string" ||
    !p.column ||
    p.column.length > 256 ||
    ["__proto__", "constructor", "prototype"].includes(p.column) ||
    p.type !== "user"
  )
    return false;
  const c = p.constraints;
  if (c === undefined) return true;
  if (
    !c ||
    typeof c !== "object" ||
    Array.isArray(c) ||
    Object.keys(c).some((k) => !["self", "memberOf"].includes(k)) ||
    (c.self !== undefined && typeof c.self !== "boolean")
  )
    return false;
  return (
    c.memberOf === undefined ||
    (Array.isArray(c.memberOf) &&
      c.memberOf.length > 0 &&
      c.memberOf.length <= 256 &&
      new Set(c.memberOf).size === c.memberOf.length &&
      c.memberOf.every(
        (v) =>
          typeof v === "string" &&
          (v === "current" || /^ref:[A-Za-z0-9]{6,12}$/.test(v)),
      ))
  );
}
