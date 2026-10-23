import {readLegacyScalarOperation} from "./scalar-mutations.ts";
import{createHash}from"node:crypto";
import{validCompiledSourceQueries}from"./source-query-admission.ts";
import type{CompiledSourceQueryBinding}from"./source-query-contracts.ts";
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
  sourceAdmission?:import("./local-contracts.ts").CompiledSourceAdmission,
  sourceQueries:readonly CompiledSourceQueryBinding[]=[],
): Promise<{ flow: any; results: any }> {
  const scalarPlans = new Map<string, import("./scalar-mutation-contracts.ts").LegacyScalarOperation>();
  const scalarDeclarations = rawFlow.values.filter((v:any)=>v.kind==="scalar").map((v:any)=>({name:v.name,type:v.type,default:v.default}));
  for(const m of rawFlow.mutations??[]){
    const operation=readLegacyScalarOperation(m.sql,scalarDeclarations);
    if(operation){
      if(sourceAdmission!=="offline-prototype"||bindings.length||rawFlow.imports.length||m.expectedAffected!==undefined||m.reset?.length)throw Error("Unsupported legacy scalar mutation composition");
      scalarPlans.set(m.name,operation);
    }
  }
  const scalarTable="migrationScalarSnapshot";
  if(scalarPlans.size){
    if(rawFlow.values.some((v:any)=>v.name.toLowerCase()===scalarTable.toLowerCase()))throw Error("Reserved scalar conversion name");
    rawFlow={...rawFlow,values:[...rawFlow.values,{kind:"table",name:scalarTable,rows:[Object.fromEntries(scalarDeclarations.map((v:any)=>[v.name,v.default]))],columns:scalarDeclarations.map((v:any)=>({name:v.name,type:v.type}))}],mutations:rawFlow.mutations.map((m:any)=>scalarPlans.has(m.name)?{...m,sql:m.sql.replace(/_signals/i,scalarTable)}:m)};
  }
  validateBoundFlow(rawFlow, bindings, boundProofs);
  if(!validCompiledSourceQueries(sourceQueries))throw Error("Invalid source query proof");
  const remote=rawFlow.queries.filter((q:any)=>q.source);
  if(remote.length||sourceQueries.length){
   if(sourceAdmission!=="offline-prototype"||remote.length!==rawFlow.queries.length||remote.length!==sourceQueries.length||rawFlow.imports.length||bindings.length||rawFlow.mutations.length||viewerBinding||membersBinding)throw Error("Unsupported source query composition");
   for(const q of remote){const b=sourceQueries.find(b=>b.name===q.name&&b.sourceRef===`ref:${q.source}`&&b.sqlSha256===createHash("sha256").update(q.sql).digest("hex"));if(!b)throw Error("Source query proof mismatch");}
  }
  if(viewerBinding!==undefined&&!validCompiledViewerBinding(viewerBinding))throw Error("Invalid viewer binding");
  if (
    membersBinding !== undefined &&
    !validCompiledMembersBinding(membersBinding)
  )
    throw Error("Invalid members binding");
  if (!rawFlow.queries.length && !(sourceAdmission==="offline-prototype"&&rawFlow.mutations.length)) throw Error("A local query is required");
  const { prepareCompile, compileDataflow } = await archived(
    "lib/dataflow/compile-dataflow.ts",
  );
  const ctx = await prepareCompile(rawFlow, async (ref: string) => {
    const selected = bindings.filter((b) => b.legacyRef === `ref:${ref}`);
    if (!selected.length) {
     const proofs=sourceQueries.filter(b=>b.sourceRef===`ref:${ref}`);if(!proofs.length)return null;
     const {rewriteBuiltinFields}=await archived("lib/dataflow/compile-dataflow.ts");
     return {kind:"postgres",tables:[],probe:async(sql:string)=>{const matches=remote.filter((q:any)=>q.source===ref&&rewriteBuiltinFields(q.sql).sql===sql);if(matches.length!==1)throw Error("Ambiguous source query proof");const proof=proofs.find(b=>b.name===matches[0].name)!;return{columns:proof.columns,params:Object.keys(proof.params)};}};
    }
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
  if(scalarPlans.size){
    flow.values=flow.values.filter((v:any)=>v.name!==scalarTable);
    flow.mutations=flow.mutations.map((m:any)=>scalarPlans.has(m.name)?{...m,scalarOperation:scalarPlans.get(m.name)}:m);
  }
  if(sourceQueries.length){
   if(flow.queries.some((q:any)=>!q.source||q.engine!=="postgres"||q.reads.queries.length||q.reads.imports.length))throw Error("Unsupported source query dependencies");
   return{flow,results:{tables:{},errors:{}}};
  }
  if (
    (flow.mutations.length && !(sourceAdmission==="offline-prototype" && !flow.imports.length && flow.mutations.every((m:any)=>m.scalarOperation || m.target && typeof m.target.local==="string" && flow.values.some((v:any)=>v.kind==="table"&&v.name===m.target.local) && !m.reads.imports.length && !m.reads.queries?.length && !m.reads.builtins.some((b:string)=>!["_now","_tz","_row","_value"].includes(b)&&!b.startsWith("_row."))))) ||
    flow.imports.length !== bindings.length ||
    flow.queries.some(
      (q: any) =>
        q.engine !== "sqlite" ||
        q.source ||
        q.reads.builtins.some(
          (b: string) => !(b === "_members" && membersBinding) && !(["_me","_me.id"].includes(b) && viewerBinding) && !(sourceAdmission==="offline-prototype" && ["_now","_tz"].includes(b)),
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
    sourceAdmission!=="offline-prototype" && membersBinding &&
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
