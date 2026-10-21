/** Validate, defensively copy and deeply freeze JSON without invoking accessors.
 * The generic preserves the input shape; invalid values throw before returning.
 */
export function jsonCopy<T>(value: T): T {
  return copy(value, new Set(), 0) as T;
}
function copy(value: unknown, seen: Set<object>, depth: number): unknown {
  if (depth > 256) throw Error("state_too_deep");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object") throw Error("state_must_be_JSON");
  if (seen.has(value)) throw Error("cyclic_state");
  const array = Array.isArray(value);
  if (
    !array &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw Error("non_JSON_object");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length) throw Error("symbol_state");
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (array && key === "length") continue;
    if (!("value" in descriptor) || !descriptor.enumerable)
      throw Error("non_JSON_property");
  }
  seen.add(value);
  let out: unknown[] | Record<string, unknown>;
  if (array) {
    if (Object.keys(value).length !== (value as unknown[]).length)
      throw Error("sparse_or_extended_array");
    out = [];
    for (let i = 0; i < (value as unknown[]).length; i++) {
      if (!Object.hasOwn(descriptors, i)) throw Error("sparse_array");
      (out as unknown[]).push(copy(descriptors[i]!.value, seen, depth + 1));
    }
  } else {
    out = {};
    for (const [key, descriptor] of Object.entries(descriptors))
      Object.defineProperty(out, key, {
        value: copy(descriptor.value, seen, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
  }
  seen.delete(value);
  return Object.freeze(out);
}
