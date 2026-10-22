export interface CompiledOutputIdentities {
  readonly ids: readonly string[];
  readonly sourceOwned: ReadonlySet<string>;
  readonly source: string;
  /** Serialized compiler HTML with only id attribute values cleared. */
  readonly htmlReferences: string;
  readonly javascript: string;
  readonly css: string;
}
export type ReconcileCompiledOutputIdentities = (
  input: CompiledOutputIdentities,
) => readonly string[] | null;
/** Repair only compiler-created, unreferenced duplicates. Source identities and
 * any identity used by behavior or presentation remain authoritative. */
export const reconcileCompiledOutputIdentities: ReconcileCompiledOutputIdentities =
  (input) => {
    const counts = new Map<string, number>();
    for (const id of input.ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, count] of counts) {
      if (count < 2) continue;
      if (
        !id ||
        input.sourceOwned.has(id) ||
        [input.source, input.javascript, input.css, input.htmlReferences].some(
          (s) => s.includes(id),
        )
      )
        return null;
    }
    const occupied = new Set(input.ids),
      seen = new Set<string>();
    return input.ids.map((id) => {
      if (!seen.has(id)) {
        seen.add(id);
        return id;
      }
      let n = 2,
        replacement = `${id}--af-occurrence-${n}`;
      while (occupied.has(replacement))
        replacement = `${id}--af-occurrence-${++n}`;
      occupied.add(replacement);
      return replacement;
    });
  };
