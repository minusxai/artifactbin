import type { CompiledPersonBinding } from "./person-contracts.ts";
/** Routing shape only. Admission must separately match trusted source-column proofs. */
export function validCompiledPersonBindings(
  value: unknown,
): value is readonly CompiledPersonBinding[] {
  return (
    Array.isArray(value) &&
    value.length <= 256 &&
    value.every(
      (b) =>
        b &&
        typeof b === "object" &&
        Object.keys(b).sort().join(",") === "backendNamespace,valueName" &&
        b.backendNamespace === "legacyData" &&
        typeof b.valueName === "string" &&
        /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(b.valueName) &&
        !["__proto__", "constructor", "prototype"].includes(b.valueName),
    ) &&
    new Set(value.map((b) => b.valueName)).size === value.length
  );
}
