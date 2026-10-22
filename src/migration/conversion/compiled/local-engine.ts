import{validCompiledViewerBinding}from"./viewer-binding.ts";
import type{CompiledViewerBinding}from"./viewer-contracts.ts";
import { validCompiledMembersBinding } from "./members-binding.ts";
import type { CompiledMembersBinding } from "./members-contracts.ts";
import type { BoundValueColumnProof } from "./bound-value-contracts.ts";
import { validateBoundFlow, publicBoundFlow } from "./bound-flow.ts";
import type { CompiledDatasetBinding } from "./dataset-contracts.ts";
/** Offline schema compilation. Import contents are deliberately unavailable here. */
export async function prepareLocalFlow(
  archived: (relative: string) => Promise<any>,
  rawFlow: any,
  body: any,
  values: Record<string, unknown>,
  localTables: Record<string, unknown>,
  bindings: readonly CompiledDatasetBinding[],
  boundProofs: readonly BoundValueColumnProof[] = [],
  membersBinding?: CompiledMembersBinding,
  viewerBinding?:CompiledViewerBinding,
): Promise<{ flow: any; results: any }> {
  validateBoundFlow(rawFlow, bindings, boundProofs);
  if(viewerBinding!==undefined&&!validCompiledViewerBinding(viewerBinding))throw Error("Invalid viewer binding");
  if (
    membersBinding !== undefined &&
    !validCompiledMembersBinding(membersBinding)
  )
    throw Error("Invalid members binding");
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
        columns: t.columns.map((c) => {
          const proof = boundProofs.find(
            (p) =>
              p.sourceRef === `ref:${ref}` &&
              p.schema === t.schema &&
              p.table === t.table &&
              p.column === c.name,
          );
          return {
            ...c,
            ...(proof?.constraints === undefined
              ? {}
              : { constraints: structuredClone(proof.constraints) }),
          };
        }),
      })),
    };
  });
  const compiled = compileDataflow(rawFlow, ctx, body);
  if (!compiled.ok) throw Error("Local query compilation refused");
  const flow = publicBoundFlow(compiled.compiled, boundProofs);
  if (
    flow.mutations.length ||
    flow.imports.length !== bindings.length ||
    flow.queries.some(
      (q: any) =>
        q.engine !== "sqlite" ||
        q.source ||
        q.reads.builtins.some(
          (b: string) => !(b === "_members" && membersBinding) && !(["_me","_me.id"].includes(b) && viewerBinding),
        ),
    ) ||
    flow.imports.some(
      (i: any) =>
        !bindings.some(
          (b) => b.name === i.name && b.legacyRef === `ref:${i.ref}`,
        ),
    )
  )
    throw Error("Unported query capability");
  if (
    membersBinding &&
    !flow.queries.some((q: any) => q.reads.builtins.includes("_members"))
  )
    throw Error("Unused members binding");
  // Protected imported rows and their query results are never captured in HTML.
  if (flow.imports.length || membersBinding || viewerBinding)
    return { flow, results: { tables: {}, errors: {} } };
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
