import {prepareNativeStaticDataTables} from './static-data-table.ts';
import { createHash } from "node:crypto";
import { canonicalMigrationValue } from "../verification-values.ts";
import type { RetainedJsxNode } from "./analyze-contracts.ts";
import type {
  NativeOperationAnalysisInput,
  NativeOperationCoverage,
  NativeOperationProof,
  NativeOperationGuarantee,
  NativeOperationReads,
  NativeOperationRoute,
  NativeVisualizationSourceBinding,
} from "./operations-contracts.ts";

const digest = (value: unknown) =>
  createHash("sha256").update(canonicalMigrationValue(value)).digest("hex");
const validDigest = (value: string) => /^[a-f0-9]{64}$/.test(value);
const attr = (node: RetainedJsxNode, name: string) =>
  node.type === "element"
    ? node.attributes.find((a) => a.name === name)?.value
    : undefined;
const literal = (node: RetainedJsxNode, name: string) => {
  const value = attr(node, name);
  return value?.static ? value.json : undefined;
};
function elements(nodes: readonly RetainedJsxNode[]): RetainedJsxNode[] {
  return nodes.flatMap((node) =>
    node.type === "element" ? [node, ...elements(node.children)] : [],
  );
}

/** Only a literal, fully typed source Value can replace a query dependency. */
function staticTableSource(input:NativeOperationAnalysisInput,nodes:readonly RetainedJsxNode[],name:string,viz:unknown):NativeVisualizationSourceBinding|undefined {
 const declared=input.analysis.flow.values.filter(v=>v.name===name),compiled=input.compilation.values.filter(v=>v.name===name),sources=nodes.filter(n=>n.type==='element'&&n.tag==='Value'&&literal(n,'name')===name);
 if(declared.length!==1||compiled.length!==1||sources.length!==1)return;
 const value=declared[0]!,actual=compiled[0]!,node=sources[0]!;
 if(value.kind!=='table'||actual.kind!=='table'||value.source!==undefined||node.type!=='element'||node.children.length||node.attributes.some(a=>!['name','type','value'].includes(a.name)||!a.value.static)||new Set(node.attributes.map(a=>a.name)).size!==node.attributes.length||literal(node,'type')!=='table')return;
 const rows=value.rows,columns=value.columns;
 if(!Array.isArray(rows)||!Array.isArray(columns)||!columns.length||!Array.isArray(actual.rows)||!Array.isArray(actual.columns)||!Array.isArray(literal(node,'value'))||digest(rows)!==digest(literal(node,'value'))||digest(rows)!==digest(actual.rows)||digest(columns)!==digest(actual.columns))return;
 const schema=new Map<string,string>();
 for(const col of columns){if(!col||typeof col!=='object'||Array.isArray(col)||typeof col.name!=='string'||!col.name||typeof col.type!=='string'||!['string','number','boolean'].includes(col.type)||schema.has(col.name))return;schema.set(col.name,col.type);}
 for(const row of rows){if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).length!==schema.size||[...schema].some(([key,type])=>!Object.hasOwn(row,key)||typeof row[key]!==type||type==='number'&&!Number.isFinite(row[key])))return;}
 if(!viz||typeof viz!=='object'||Array.isArray(viz)||!('kind'in viz)||viz.kind!=='vega-lite'||!('spec'in viz)||!viz.spec||typeof viz.spec!=='object'||Array.isArray(viz.spec))return;
 let valid=true;
 const inspect=(item:unknown):void=>{if(!item||typeof item!=='object')return;if(Array.isArray(item)){item.forEach(inspect);return;}const obj=item as Record<string,unknown>;
 if(Object.keys(obj).some(key=>['transform','calculate','expr','params','selection','data','datasets','signals','condition'].includes(key)||/expr$/i.test(key)))valid=false;
 if(Object.hasOwn(obj,'field')){const type=typeof obj.field==='string'?schema.get(obj.field):undefined;if(!type||!['nominal','ordinal','quantitative'].includes(String(obj.type))||(obj.type==='quantitative'?type!=='number':type!=='string'&&type!=='boolean'))valid=false;}
 Object.values(obj).forEach(inspect);};inspect(viz.spec);if(!valid)return;
 return {kind:'static-table-value',name,sourceNode:node.graphKey,sourceNodeSha256:digest(node),rowsSha256:digest(rows),columnsSha256:digest(columns)};
}

/** Pure preparation evidence. No SQL execution, registration, destination write, or native runtime is produced. */
export function analyzeNativeOperations(
  input: NativeOperationAnalysisInput,
): NativeOperationCoverage {
  const { analysis, compilation, historical } = input;
  if (
    !validDigest(analysis.sourceSha256) ||
    !validDigest(analysis.compilerSourceSha256) ||
    compilation.sourceSha256 !== analysis.sourceSha256 ||
    compilation.compilerSourceSha256 !== analysis.compilerSourceSha256 ||
    !validDigest(input.sqlEngineSha256) ||
    compilation.sqlEngineSha256 !== input.sqlEngineSha256
  )
    throw Error("operation_compiler_identity_mismatch");
  const blockers: NativeOperationCoverage["blockers"][number][] = [],
    operations: NativeOperationProof[] = [];
  const nodes = elements(analysis.nodes),
    queries = new Map(compilation.queries.map((q) => [q.name, q]));
  const block = (code: string, name: string, node: string) =>
    blockers.push({ code, operation: name, sourceNode: node });
  const source = (kind: "query" | "mutation", name: string) => {
    const matches = nodes.filter(
      (node) =>
        node.type === "element" &&
        node.tag === (kind === "query" ? "Query" : "Mutation") &&
        literal(node, "name") === name,
    );
    if (matches.length !== 1) {
      block("operation-source-node-missing", name, "");
      return "";
    }
    return matches[0]!.graphKey;
  };
  for (const [kind, decls, compiled] of [
    ["query", analysis.flow.queries, compilation.queries],
    ["mutation", analysis.flow.mutations, compilation.mutations],
  ] as const) {
    for (const decl of decls)
      if (!compiled.some((c) => c.name === decl.name))
        block("compiled-operation-missing", decl.name, source(kind, decl.name));
    if (new Set(compiled.map((c) => c.name)).size !== compiled.length)
      block("compiled-operation-duplicate", kind, "");
    for (const op of compiled)
      if (!decls.some((d) => d.name === op.name))
        block("compiled-operation-undeclared", op.name, source(kind, op.name));
  }
  const order: string[] = [],
    active = new Set<string>(),
    visited = new Set<string>();
  function visit(name: string): void {
    if (active.has(name)) {
      block("query-dependency-cycle", name, source("query", name));
      return;
    }
    if (visited.has(name)) return;
    const query = queries.get(name);
    if (!query) {
      block("query-dependency-missing", name, "");
      return;
    }
    active.add(name);
    for (const dependency of query.reads.queries) {
      if (!queries.has(dependency))
        block("query-dependency-missing", name, source("query", name));
      else visit(dependency);
    }
    active.delete(name);
    visited.add(name);
    order.push(name);
  }
  for (const query of compilation.queries) visit(query.name);
  function add(
    kind: NativeOperationProof["kind"],
    name: string,
    sourceNode: string,
    body: unknown,
    reads: NativeOperationReads,
    route: NativeOperationRoute,
    requiredGuarantees: NativeOperationGuarantee[],
    catalogSource?:string,
    visualizationSource?:NativeVisualizationSourceBinding,
  ): void {
    const operationSha256 = digest({
      key: analysis.key,
      sourceSha256: analysis.sourceSha256,
      compilerSourceSha256: analysis.compilerSourceSha256,
      sqlEngineSha256: input.sqlEngineSha256,
      kind,
      name,
      body,
      values: compilation.values,
      imports: compilation.imports,
    });
    const proof: NativeOperationProof = {
      kind,
      name,
      sourceNode,
      operationSha256,
      route,
      dependencies: [...reads.queries],
      requiredGuarantees,
      status: "blocked",
      ...(visualizationSource?{visualizationSource}:{}),
    };
    operations.push(proof);
    for (const value of reads.values)
      if (!compilation.values.some((v) => v.name === value))
        block("value-dependency-missing", name, sourceNode);
    const candidates = (input.admissions ?? []).filter(
      (a) => a.kind === kind && a.name === name,
    );
    if (candidates.length !== 1) {
      block(
        candidates.length
          ? "operation-registration-ambiguous"
          : "operation-registration-missing",
        name,
        sourceNode,
      );
      return;
    }
    const admission = candidates[0]!;
    if (
      admission.operationSha256 !== operationSha256 ||
      admission.route !== route ||
      !validDigest(admission.planSha256)
    ) {
      block("operation-registration-mismatch", name, sourceNode);
      return;
    }
    if(catalogSource!==undefined){
      const bound=admission.source;
      if(!bound||bound.sourceRef!==catalogSource||typeof bound.targetDatasetId!=='string'||!bound.targetDatasetId||bound.targetDatasetId.length>512||bound.targetDatasetId.startsWith('ref:')||!Number.isSafeInteger(bound.version)||bound.version<1||!validDigest(bound.catalogSha256)||!validDigest(bound.policySha256)||bound.selection!=='live-current')block('catalog-source-binding-missing',name,sourceNode);
    }else if(admission.source!==undefined)block('catalog-source-binding-extraneous',name,sourceNode);
    for (const guarantee of requiredGuarantees)
      if (!admission.guarantees.includes(guarantee))
        block(`guarantee-${guarantee}-missing`, name, sourceNode);
    const imports = [...new Set(reads.imports)];
    for (const bindingName of imports) {
      const declared = compilation.imports.find((i) => i.name === bindingName);
      const bindings = admission.datasets.filter((d) => d.name === bindingName);
      if (
        !declared ||
        bindings.length !== 1 ||
        bindings[0]!.ref !== declared.ref ||
        !Number.isSafeInteger(bindings[0]!.version) ||
        bindings[0]!.version < 1 ||
        !validDigest(bindings[0]!.catalogSha256) ||
        !validDigest(bindings[0]!.policySha256)
      ) {
        block("dataset-binding-missing", name, sourceNode);
        continue;
      }
      if (bindings[0]!.selection !== "live-current")
        block("dataset-binding-mode-mismatch", name, sourceNode);
    }
    if (admission.datasets.some((d) => !imports.includes(d.name)))
      block("dataset-binding-extraneous", name, sourceNode);
    proof.status = blockers.some((b) => b.operation === name)
      ? "blocked"
      : "attested-plan";
  }
  const readGuarantees: NativeOperationGuarantee[] = [
    "typed-null-parameters",
    "full-source-results",
    "dependency-order",
    "cancel-stale-results",
    "revision-authority-fence",
  ];
  for (const query of compilation.queries) {
    const node = source("query", query.name);
    const direct=query.source!==undefined;
    if(direct?(query.engine!=="postgres"||typeof query.source!=="string"||!query.source||query.source.length>512):query.engine!=="sqlite")block("query-engine-adapter-missing",query.name,node);
    if(direct&&(query.reads.imports.length||query.reads.queries.length))block("catalog-source-dependencies-unsupported",query.name,node);
    add(
      "query",
      query.name,
      node,
      query,
      query.reads,
      direct?"registered-catalog-query":"registered-sqlite-query",
      [
        ...readGuarantees,
        ...(direct?["catalog-source-authority" as const]:[]),
        ...(query.reads.builtins.length
          ? ["actor-clock-bindings" as const]
          : []),
      ],
      direct?query.source:undefined,
    );
  }
  for (const mutation of compilation.mutations) {
    const node = source("mutation", mutation.name);
    if (
      mutation.reset?.some(
        (name) =>
          !compilation.values.some(
            (v) => v.name === name && v.kind === "scalar",
          ),
      )
    )
      block("mutation-reset-value-missing", mutation.name, node);
    if (
      mutation.expectedAffected !== undefined &&
      (!Number.isSafeInteger(mutation.expectedAffected) ||
        mutation.expectedAffected < 0)
    )
      block("mutation-expected-affected-invalid", mutation.name, node);
    const targets =
      Number(!!mutation.target.import) + Number(!!mutation.target.local);
    if (targets !== 1) block("mutation-target-invalid", mutation.name, node);
    const reads = {
      ...mutation.reads,
      imports: [
        ...new Set([
          ...mutation.reads.imports,
          ...(mutation.target.import ? [mutation.target.import] : []),
        ]),
      ],
    };
    const route: NativeOperationRoute = historical
      ? "historical-readonly"
      : mutation.target.import
        ? "registered-dataset-mutation"
        : "apollo-local-mutation";
    const guarantees: NativeOperationGuarantee[] = historical
      ? ["revision-authority-fence"]
      : [
          "typed-null-parameters",
          "revision-authority-fence",
          "outcome-no-retry",
          ...(mutation.expectedAffected !== undefined
            ? ["expected-affected" as const]
            : []),
          ...(mutation.reset?.length ? ["commit-only-reset" as const] : []),
          ...(mutation.reads.builtins.length
            ? ["actor-clock-bindings" as const]
            : []),
        ];
    add("mutation", mutation.name, node, mutation, reads, route, guarantees);
  }
  for (const node of nodes.filter(
    (n) => n.type === "element" && (n.tag === "Chart" || n.tag === "Question"),
  )) {
    const name = node.graphKey,
      data = literal(node, "data"),
      viz = literal(node, "viz");
    const dependency =
      typeof data === "string" && /^\$[A-Za-z_]\w*$/.test(data)
        ? data.slice(1)
        : null;
    const staticSource=dependency&&!queries.has(dependency)?staticTableSource(input,nodes,dependency,viz):undefined;
    const sourceBinding:NativeVisualizationSourceBinding|undefined=staticSource??(dependency&&queries.has(dependency)?{kind:'query-result',name:dependency}:undefined);
    if (!sourceBinding||sourceBinding.kind==='query-result'&&analysis.flow.values.some(v=>v.name===dependency))
      block("visualization-query-binding-missing", name, node.graphKey);
    if (viz === undefined || viz === null)
      block("visualization-spec-admission-missing", name, node.graphKey);
    add(
      "visualization",
      name,
      node.graphKey,
      {
        attributes: node.type === "element" ? node.attributes : [],
        dependency,
        ...(staticSource?{sourceBinding:staticSource}:{}),
      },
      {
        imports: [],
        queries: dependency&&!staticSource ? [dependency] : [],
        values: staticSource&&dependency ? [dependency] : [],
        builtins: [],
      },
      viz&&typeof viz==='object'&&!Array.isArray(viz)&&viz.kind==='single_value'?"native-single-value":"native-vega",
      [viz&&typeof viz==='object'&&!Array.isArray(viz)&&viz.kind==='single_value'?"single-value-dom":"vega-spec-signals", "cancel-stale-results"],
      undefined,sourceBinding,
    );
  }
  const staticDataTables=prepareNativeStaticDataTables({analysis,compilation});
  blockers.push(...staticDataTables.blockers);
  // A registered downstream operation cannot conceal an uncovered prerequisite.
  for (const name of [
    ...order,
    ...operations.filter((o) => o.kind !== "query").map((o) => o.name),
  ]) {
    const proof = operations.find((o) => o.name === name);
    if (!proof) continue;
    if (
      proof.dependencies.some(
        (dep) =>
          operations.find((o) => o.kind === "query" && o.name === dep)
            ?.status !== "attested-plan",
      )
    ) {
      block("query-upstream-uncovered", name, proof.sourceNode);
      proof.status = "blocked";
    }
  }
  return {
    sourceSha256: analysis.sourceSha256,
    compilerSourceSha256: analysis.compilerSourceSha256,
    sqlEngineSha256: input.sqlEngineSha256,
    ...(staticDataTables.proofs.length?{staticDataTables:staticDataTables.proofs}:{}),
    operations,
    queryOrder: order,
    blockers,
  };
}
