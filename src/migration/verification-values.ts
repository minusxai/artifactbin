export function canonicalMigrationValue(value: unknown): string {
  if (Array.isArray(value))
    return "[" + value.map(canonicalMigrationValue).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonicalMigrationValue(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
export function requireMigrationEquality(
  actual: unknown,
  expected: unknown,
  label: string,
): void {
  if (canonicalMigrationValue(actual) !== canonicalMigrationValue(expected))
    throw Error("Migration verification failed: " + label);
}
