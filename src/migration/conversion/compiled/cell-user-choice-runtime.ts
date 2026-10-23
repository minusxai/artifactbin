import type {
  CompiledCellUserChoice,
  CompiledCellUserChoiceBinding,
  CompiledCellUserChoicePorts,
} from "./cell-user-choice-contracts.ts";
export function validCellUserChoiceBindings(
  value: unknown,
): value is readonly CompiledCellUserChoiceBinding[] {
  if (!Array.isArray(value) || value.length > 256) return false;
  const keys = new Set<string>();
  return value.every((b) => {
    if (
      !b ||
      typeof b !== "object" ||
      Object.keys(b).some(
        (k) => !["queryName", "column", "backendNamespace"].includes(k),
      ) ||
      !["queryName", "column", "backendNamespace"].every(
        (k) =>
          typeof b[k] === "string" &&
          /^[A-Za-z_][A-Za-z_0-9]{0,127}$/.test(b[k]) &&
          !["constructor", "prototype", "__proto__"].includes(b[k]),
      )
    )
      return false;
    const key = b.queryName + "." + b.column;
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}
/** Every live result replaces this registered column's choices. Loading/error never
 * reuses old membership, and callbacks after disposal cannot republish a directory. */
export function createCompiledCellUserChoices(
  bindings: readonly CompiledCellUserChoiceBinding[],
  ports: CompiledCellUserChoicePorts,
): { dispose(): void } {
  if (!validCellUserChoiceBindings(bindings))
    throw Error("Invalid cell user choice routes");
  let active = true;
  const options: Record<string, readonly CompiledCellUserChoice[]> =
      Object.create(null),
    stops: (() => void)[] = [];
  const publish = () => {
    if (active) ports.changed({ ...options });
  };
  for (const binding of bindings) {
    const key = binding.queryName + "." + binding.column;
    options[key] = [];
    const clear = () => {
      if (active) {
        options[key] = [];
        publish();
      }
    };
    stops.push(
      ports.watch(
        binding,
        (value) => {
          if (!active) return;
          try {
            const rows = typeof value === "string" ? JSON.parse(value) : null;
            if (!Array.isArray(rows) || rows.length > 10000) throw Error();
            const seen = new Set<string>();
            const parsed = rows.map((row: unknown) => {
              if (!row || typeof row !== "object" || Array.isArray(row))
                throw Error();
              const r = row as Record<string, unknown>;
              if (
                Object.keys(r).some((k) => !["value", "label"].includes(k)) ||
                typeof r.value !== "string" ||
                !r.value ||
                r.value.length > 256 ||
                typeof r.label !== "string" ||
                r.label.length > 4096 ||
                seen.has(r.value)
              )
                throw Error();
              seen.add(r.value);
              return { value: r.value, label: r.label };
            });
            options[key] = parsed;
            publish();
          } catch {
            clear();
          }
        },
        clear,
      ),
    );
  }
  publish();
  return {
    dispose() {
      if (!active) return;
      active = false;
      for (const stop of stops) stop();
    },
  };
}
