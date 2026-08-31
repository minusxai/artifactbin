/**
 * Helper for creating immutable module-level collections.
 *
 * Use this instead of `new Set()` for constants. TypeScript enforces
 * immutability via ReadonlySet — .add(), .delete(), .clear() are compile
 * errors on the returned type.
 *
 * The ESLint rule that guards module-level Maps/Sets only fires on `new Map/Set` —
 * not on this helper — so no eslint-disable comment is needed at call sites.
 */

export function immutableSet<T>(values: Iterable<T>): ReadonlySet<T> {
  return new Set(values);
}
