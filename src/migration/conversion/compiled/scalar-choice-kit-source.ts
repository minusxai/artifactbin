/** Adapt the archived string-valued option boundary to its declared viewer scalar type. */
export function archivedScalarChoiceSource(source: string): string {
  const choice = "island.setValue(n,o.value,undefined)";
  if (source.split(choice).length !== 2)
    throw Error("Unsupported archived scalar choice boundary");
  return source.replace(
    choice,
    "island.setValue(n,o.value===null?null:coerceScalarInput(island.valueType(n),o.value),undefined)",
  );
}
