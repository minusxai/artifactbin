import type { CompiledMutationIntent } from "./dataset-mutations-contracts.ts";
const identifier = (value: string) =>
  typeof value === "string" &&
  /^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(value) &&
  !["constructor", "prototype", "__proto__"].includes(value);
const scalar = (value: unknown) =>
  value === null ||
  typeof value === "string" ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value));
const record = (value: unknown): value is Record<string, any> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(
    (d) => "value" in d,
  );
};
export const validCompiledMutationIntent = (
  value: unknown,
): value is CompiledMutationIntent => {
  if (
    !record(value) ||
    Object.keys(value).sort().join() !==
      "authorizationContext,name,params,requestId,resetValues,scope,version" ||
    value.version !== 1 ||
    typeof value.scope !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.scope) ||
    typeof value.authorizationContext !== "string" ||
    !value.authorizationContext ||
    value.authorizationContext.length > 256 ||
    !identifier(value.name) ||
    typeof value.requestId !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(value.requestId) ||
    !record(value.params) ||
    !record(value.resetValues)
  )
    return false;
  for (const values of [value.params, value.resetValues])
    if (
      Object.keys(values).length > 240 ||
      Object.entries(values).some(([key, v]) => !identifier(key) || !scalar(v))
    )
      return false;
  return JSON.stringify(value).length <= 16384;
};

/** Apply the identical whole-record bound on restore and every proposed durable CAS. */
export function validatedCompiledMutationIntents(
  value: unknown,
): Record<string, CompiledMutationIntent> {
  if (!record(value) || Object.keys(value).length > 64)
    throw Error("Invalid stored mutation intents");
  for (const [name, intent] of Object.entries(value))
    if (!validCompiledMutationIntent(intent) || intent.name !== name)
      throw Error("Invalid stored mutation intent");
  if (JSON.stringify(value).length > 131072)
    throw Error("Invalid stored mutation intents");
  return value as Record<string, CompiledMutationIntent>;
}
