/**
 * The one check for a name that is interpolated into SQL text (a schema or table a store is bound to): only a plain
 * lowercase identifier is admitted, so it can never carry quoting, a dot or another statement. Used by the code store
 * (./codes) and auth's bearer read and OAuth store.
 */

/** `value` if it is a plain lowercase identifier; otherwise throws, naming `what` it was meant to be. */
export function plainIdentifier(value: string, what: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`${what} must be a plain lowercase identifier, got "${value}"`);
  return value;
}
