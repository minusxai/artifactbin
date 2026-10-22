import type { CompiledDatasetBinding } from "./dataset-contracts.ts";
/** Offline schema compilation. Import contents are deliberately unavailable here. */
export async function prepareLocalFlow(
  archived: (relative: string) => Promise<any>,
  rawFlow: any,
  body: any,
  values: Record<string, unknown>,
  localTables: Record<string, unknown>,
  bindings: readonly CompiledDatasetBinding[],
): Promise<{ flow: any; results: any }> {
  if (rawFlow.values.some((v: any) => v.kind === "scalar" && v.source))
    throw Error("Sourced values unsupported");
  if (!rawFlow.queries.length) throw Error("A local query is required");
  const { prepareCompile, compileDataflow } = await archived(
    "lib/dataflow/compile-dataflow.ts",
  );
  const ctx = await prepareCompile(rawFlow, async (ref: string) => {
    const selected = bindings.filter((b) => b.legacyRef === `ref:${ref}`);
    if (!selected.length) return null;
    if (
      selected.some(
        (b) =>
          b.version !== selected[0]!.version ||
          JSON.stringify(b.tables) !== JSON.stringify(selected[0]!.tables),
      )
    )
      throw Error("Inconsistent import schema");
    return {
      kind: "dataset",
      tables: selected[0]!.tables.map((t) => ({
        name: t.table,
        columns: t.columns,
      })),
    };
  });
  const compiled = compileDataflow(rawFlow, ctx, body);
  if (!compiled.ok) throw Error("Local query compilation refused");
  const flow = compiled.compiled;
  if (
    flow.mutations.length ||
    flow.imports.length !== bindings.length ||
    flow.queries.some(
      (q: any) => q.engine !== "sqlite" || q.source || q.reads.builtins.length,
    ) ||
    flow.imports.some(
      (i: any) =>
        !bindings.some(
          (b) => b.name === i.name && b.legacyRef === `ref:${i.ref}`,
        ),
    )
  )
    throw Error("Unported query capability");
  // Protected imported rows and their query results are never captured in HTML.
  if (flow.imports.length) return { flow, results: { tables: {}, errors: {} } };
  const { createPageEngine } = await archived("lib/page-store/page-engine.ts");
  const engine = createPageEngine({
    load: async () => ctx.engine,
    fetch: async () => {
      throw Error("No import binding");
    },
  });
  engine.prepare(flow, []);
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (!engine.ready(flow, [])) throw Error("Local engine failed to prepare");
  const results = await engine.run(
    flow,
    flow.queries.map((q: any) => q.name),
    {
      values,
      localTables,
      userId: null,
      now: new Date().toISOString(),
      tz: "UTC",
    },
  );
  if (Object.keys(results.errors).length)
    throw Error("Default local queries failed");
  return { flow, results };
}
