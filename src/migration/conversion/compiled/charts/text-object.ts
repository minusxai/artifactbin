/** Trusted expression primitive for compiler-generated tooltip keys; no prototype setters. */
export function chartTextObject(
  keys: unknown,
  values: unknown,
): Record<string, unknown> {
  if (
    !Array.isArray(keys) ||
    !Array.isArray(values) ||
    keys.length !== values.length ||
    keys.length > 64
  )
    throw Error("Chart tooltip exceeds limit");
  return Object.fromEntries(
    keys.map((key, index) => {
      if (typeof key !== "string" || key.length > 4096)
        throw Error("Chart tooltip key unsupported");
      return [key, values[index]];
    }),
  );
}
