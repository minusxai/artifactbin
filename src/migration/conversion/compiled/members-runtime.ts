import type {
  CompiledMembersAdapter,
  CompiledMembersOptions,
  CompiledMembersSnapshot,
} from "./members-contracts.ts";
function snapshot(value: unknown): CompiledMembersSnapshot {
  const fail = (): never => {
    throw Error("Page members unavailable");
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  const s = value as CompiledMembersSnapshot;
  if (
    Object.keys(s).some((k) => !["generation", "rows"].includes(k)) ||
    typeof s.generation !== "string" ||
    !/^[a-f0-9]{64}$/.test(s.generation) ||
    !Array.isArray(s.rows) ||
    s.rows.length > 10000 ||
    new TextEncoder().encode(JSON.stringify(s)).length > 4_000_000
  )
    return fail();
  const ids = new Set<string>();
  for (const row of s.rows) {
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      Object.keys(row).length !== 2 ||
      !Object.hasOwn(row, "user_id") ||
      !Object.hasOwn(row, "joined_at") ||
      typeof row.user_id !== "string" ||
      !row.user_id ||
      row.user_id.length > 256 ||
      ids.has(row.user_id) ||
      typeof row.joined_at !== "string" ||
      row.joined_at.length > 128 ||
      !Number.isFinite(Date.parse(row.joined_at))
    )
      return fail();
    ids.add(row.user_id);
  }
  return structuredClone(s);
}
/** The only retained state is this viewer's transient, validated server snapshot. */
export function createCompiledMembers(
  options: CompiledMembersOptions,
): CompiledMembersAdapter {
  let current: CompiledMembersSnapshot | null = null,
    epoch = 0,
    disposed = false,
    inflight: Promise<CompiledMembersSnapshot> | null = null;
  const unavailable = () => Error("Page members unavailable");
  const refresh = (): Promise<CompiledMembersSnapshot> => {
    if (disposed) return Promise.reject(unavailable());
    const ticket = ++epoch;
    current = null;
    const work = Promise.resolve()
      .then(() => options.read())
      .then((value) => {
        if (disposed || ticket !== epoch) throw unavailable();
        const next = snapshot(value);
        current = next;
        options.changed(structuredClone(next));
        return structuredClone(next);
      })
      .catch(() => {
        if (ticket === epoch) current = null;
        throw unavailable();
      })
      .finally(() => {
        // Validation/publication failures must release this request too. An
        // obsolete completion must never clear a replacement request.
        if (ticket === epoch) inflight = null;
      });
    inflight = work;
    options.changed(null);
    return work;
  };
  const stop = options.watch((value) => {
    if (disposed || value === undefined) return;
    let next: CompiledMembersSnapshot | null = null;
    try {
      next = snapshot(value);
    } catch {
      /* A failed watch invalidates, never reuses the former members. */
    }
    if (next && current?.generation === next.generation) return;
    epoch++;
    inflight = null;
    current = next;
    options.changed(next ? structuredClone(next) : null);
  });
  return {
    read: () =>
      disposed
        ? Promise.reject(unavailable())
        : current
          ? Promise.resolve(structuredClone(current))
          : (inflight ?? refresh()),
    refresh,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      epoch++;
      current = null;
      inflight = null;
      stop();
    },
  };
}
