/**
 * Helper for creating immutable module-level collections.
 *
 * Use this instead of `new Set()` for constants. TypeScript enforces
 * immutability via ReadonlySet — .add(), .delete(), .clear() are compile
 * errors on the returned type.
 */

export function immutableSet<T>(values: Iterable<T>): ReadonlySet<T> {
  return new Set(values);
}
