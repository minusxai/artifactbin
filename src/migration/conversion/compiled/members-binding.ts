import type { CompiledMembersBinding } from "./members-contracts.ts";
export function validCompiledMembersBinding(
  value: unknown,
): value is CompiledMembersBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const b = value as CompiledMembersBinding;
  return (
    Object.keys(b).length === 2 &&
    Object.hasOwn(b, "backendNamespace") &&
    Object.hasOwn(b, "backendHref") &&
    b.backendNamespace === "legacyData" &&
    typeof b.backendHref === "string" &&
    /^\/af\/v1\/ids\/[A-Za-z0-9]{6}$/.test(b.backendHref)
  );
}
