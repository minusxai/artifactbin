import test from "node:test";
import assert from "node:assert/strict";
import { analyzeNativeOperations } from "../src/migration/native-components/operations.ts";
import type {
  NativeOperationAnalysisInput,
  NativeOperationAdmission,
} from "../src/migration/native-components/operations-contracts.ts";
const sha = "a".repeat(64);
function input(): NativeOperationAnalysisInput {
  return {
    historical: false,
    sqlEngineSha256: sha,
    analysis: {
      key: { sourceNamespace: "synthetic", sourceId: "page", version: 1 },
      documentSha256: sha,
      sourceSha256: sha,
      analysisSha256: sha,
      compilerSourceSha256: sha,
      sourceSpans: [],
      nodes: [
        {
          type: "element",
          graphKey: "query-node",
          tag: "Query",
          isComponent: true,
          selfClosing: false,
          start: 0,
          end: 1,
          attributes: [
            {
              name: "name",
              value: { static: true, json: "summary" },
              start: 0,
              end: 1,
            },
          ],
          children: [],
        },
      ],
      flow: {
        imports: [],
        values: [],
        queries: [{ name: "summary", start: 0, end: 1 }],
        mutations: [],
      },
    },
    compilation: {
      sourceSha256: sha,
      compilerSourceSha256: sha,
      sqlEngineSha256: sha,
      imports: [],
      values: [],
      queries: [
        {
          name: "summary",
          engine: "sqlite",
          sql: "select 1 as total",
          params: [],
          columns: [{ name: "total", type: "number" }],
          reads: { imports: [], queries: [], values: [], builtins: [] },
          functions: [],
        },
      ],
      mutations: [],
    },
  };
}
function admit(i: NativeOperationAnalysisInput): NativeOperationAdmission[] {
  return analyzeNativeOperations(i).operations.map((op) => ({
    kind: op.kind,
    name: op.name,
    operationSha256: op.operationSha256,
    route: op.route,
    planSha256: sha,
    guarantees: op.requiredGuarantees,
    datasets: [],
  }));
}
test("SQL words in prose are never declarations; absent registration stays explicitly blocked", () => {
  const i = input();
  i.analysis.nodes.push({
    type: "text",
    graphKey: "prose",
    start: 2,
    end: 3,
    value: "select count(*) from examples; Mutation delete",
  });
  const result = analyzeNativeOperations(i);
  assert.equal(result.operations.length, 1);
  assert.equal(result.operations[0]?.sourceNode, "query-node");
  assert(
    result.blockers.some((b) => b.code === "operation-registration-missing"),
  );
  i.admissions = admit(i);
  assert.deepEqual(analyzeNativeOperations(i).blockers, []);
});
test("exact parameter/null/default and dependency semantics bind the receipt digest", () => {
  const i = input();
  i.compilation.values = [
    { name: "filter", type: "string", kind: "scalar", default: null },
  ];
  i.compilation.queries[0]!.reads.values = ["filter"];
  i.admissions = admit(i);
  assert.equal(
    analyzeNativeOperations(i).operations[0]?.status,
    "attested-plan",
  );
  i.compilation.values = [
    { name: "filter", type: "string", kind: "scalar", default: "" },
  ];
  assert(
    analyzeNativeOperations(i).blockers.some(
      (b) => b.code === "operation-registration-mismatch",
    ),
  );
});
test("rejects compiler/source drift and missing or cyclic typed query dependencies", () => {
  const i = input();
  i.compilation.sourceSha256 = "b".repeat(64);
  assert.throws(
    () => analyzeNativeOperations(i),
    /operation_compiler_identity_mismatch/,
  );
  i.compilation.sourceSha256 = sha;
  i.compilation.sqlEngineSha256 = "b".repeat(64);
  assert.throws(
    () => analyzeNativeOperations(i),
    /operation_compiler_identity_mismatch/,
  );
  i.compilation.sqlEngineSha256 = sha;
  i.compilation.queries[0]!.reads.queries = ["absent"];
  assert(
    analyzeNativeOperations(i).blockers.some(
      (b) => b.code === "query-dependency-missing",
    ),
  );
  i.compilation.queries[0]!.reads.queries = ["summary"];
  assert(
    analyzeNativeOperations(i).blockers.some(
      (b) => b.code === "query-dependency-cycle",
    ),
  );
});
test("refuses fabricated declaration coverage and does not infer graph identities from spans", () => {
  const i = input();
  i.analysis.nodes = [];
  assert(
    analyzeNativeOperations(i).blockers.some(
      (b) => b.code === "operation-source-node-missing",
    ),
  );
  i.compilation.queries = [];
  assert(
    analyzeNativeOperations(i).blockers.some(
      (b) => b.code === "compiled-operation-missing",
    ),
  );
});
test("historical page queries retain original live imports and refuse invented snapshot pins", () => {
  const i = input();
  i.historical = true;
  i.compilation.imports = [{ name: "records", ref: "source-ref", tables: [] }];
  i.compilation.queries[0]!.reads.imports = ["records"];
  i.admissions = admit(i);
  i.admissions[0]!.datasets = [
    {
      name: "records",
      ref: "source-ref",
      version: 4,
      catalogSha256: sha,
      policySha256: sha,
      selection: "pinned-version",
    },
  ];
  assert(
    analyzeNativeOperations(i).blockers.some(
      (b) => b.code === "dataset-binding-mode-mismatch",
    ),
  );
  i.admissions[0]!.datasets[0]!.selection = "live-current";
  assert.deepEqual(analyzeNativeOperations(i).blockers, []);
});
test("mutations require expected-affected, outcome and reset guarantees, with archived writes disabled", () => {
  const i = input();
  i.analysis.nodes.push({
    type: "element",
    graphKey: "mutation-node",
    tag: "Mutation",
    isComponent: true,
    selfClosing: false,
    start: 2,
    end: 3,
    attributes: [
      { name: "name", value: { static: true, json: "add" }, start: 2, end: 3 },
    ],
    children: [],
  });
  i.analysis.flow.mutations = [{ name: "add", start: 2, end: 3 }];
  i.compilation.values = [
    { name: "note", type: "string", kind: "scalar", default: "" },
  ];
  i.compilation.mutations = [
    {
      name: "add",
      sql: "insert into local_notes values ($note)",
      target: { local: "notes" },
      args: [{ name: "note", type: "string" }],
      reads: { imports: [], queries: [], values: ["note"], builtins: [] },
      expectedAffected: 1,
      reset: ["note"],
    },
  ];
  i.admissions = admit(i);
  const mutation = i.admissions.find((a) => a.kind === "mutation")!;
  mutation.guarantees = mutation.guarantees.filter(
    (g) => g !== "commit-only-reset",
  );
  assert(
    analyzeNativeOperations(i).blockers.some(
      (b) => b.code === "guarantee-commit-only-reset-missing",
    ),
  );
  i.historical = true;
  assert.equal(
    analyzeNativeOperations(i).operations.find((p) => p.kind === "mutation")
      ?.route,
    "historical-readonly",
  );
});
test("Question canonical Chart keeps an explicit spec/signal proof and query-result dependency", () => {
  const i = input();
  i.analysis.nodes.push({
    type: "element",
    graphKey: "chart-node",
    tag: "Chart",
    authoredTag: "Question",
    isComponent: true,
    selfClosing: true,
    start: 2,
    end: 3,
    attributes: [
      {
        name: "data",
        value: { static: true, json: "$summary" },
        start: 2,
        end: 3,
      },
      {
        name: "viz",
        value: { static: true, json: { mark: "bar" } },
        start: 2,
        end: 3,
      },
    ],
    children: [],
  });
  const result = analyzeNativeOperations(i);
  assert.equal(result.operations.length, 2);
  assert.deepEqual(result.operations[1]?.dependencies, ["summary"]);
  assert(
    result.operations[1]?.requiredGuarantees.includes("vega-spec-signals"),
  );
  i.admissions = admit(i);
  assert.deepEqual(analyzeNativeOperations(i).blockers, []);
});

test("analyzer is pure and a registered consumer cannot hide an uncovered upstream result", () => {
  const i = input();
  i.analysis.nodes.push({
    type: "element",
    graphKey: "derived-node",
    tag: "Query",
    isComponent: true,
    selfClosing: false,
    start: 2,
    end: 3,
    attributes: [
      {
        name: "name",
        value: { static: true, json: "derived" },
        start: 2,
        end: 3,
      },
    ],
    children: [],
  });
  i.analysis.flow.queries.push({ name: "derived", start: 2, end: 3 });
  i.compilation.queries = [
    ...i.compilation.queries,
    {
      name: "derived",
      engine: "sqlite",
      sql: "select * from summary",
      params: [],
      columns: [{ name: "total", type: "number" }],
      reads: { imports: [], queries: ["summary"], values: [], builtins: [] },
      functions: [],
    },
  ];
  i.admissions = admit(i).filter((a) => a.name === "derived");
  const before = structuredClone(i);
  const result = analyzeNativeOperations(i);
  assert.deepEqual(i, before);
  assert.deepEqual(result.queryOrder, ["summary", "derived"]);
  assert.equal(
    result.operations.find((p) => p.name === "derived")?.status,
    "blocked",
  );
  assert(
    result.blockers.some(
      (b) => b.code === "query-upstream-uncovered" && b.operation === "derived",
    ),
  );
});

test('direct PostgreSQL source has an explicit catalog route and exact source admission',()=>{
 const i=input(),query=i.compilation.queries[0]!;query.engine='postgres';query.source='source_dataset';
 const initial=analyzeNativeOperations(i);assert.equal(initial.operations[0]!.route,'registered-catalog-query');
 i.admissions=admit(i);i.admissions[0]!.source={sourceRef:'source_dataset',targetDatasetId:'target_dataset',version:3,catalogSha256:sha,policySha256:sha,selection:'live-current'};
 assert.equal(analyzeNativeOperations(i).operations[0]!.status,'attested-plan');assert.deepEqual(analyzeNativeOperations(i).blockers,[]);
 i.admissions[0]!.source.sourceRef='different_source';assert.ok(analyzeNativeOperations(i).blockers.some(b=>b.code==='catalog-source-binding-missing'));
});
test('catalog route rejects unknown engines, source dependencies, missing catalog receipt and source namespace confusion',()=>{
 for(const engine of ['postgres','unknown']){const i=input();i.compilation.queries[0]!.engine=engine;i.compilation.queries[0]!.source='source_dataset';i.admissions=admit(i);const answer=analyzeNativeOperations(i);assert.ok(answer.blockers.some(b=>b.code===(engine==='postgres'?'catalog-source-binding-missing':'query-engine-adapter-missing')));}
 const i=input(),query=i.compilation.queries[0]!;query.engine='postgres';query.source='source_dataset';query.reads.imports=['absent_namespace'];i.admissions=admit(i);assert.ok(analyzeNativeOperations(i).blockers.some(b=>b.code==='catalog-source-dependencies-unsupported'));
});

test('single-value visualizations attest DOM chart behavior without claiming Vega execution',()=>{
 const i=input();i.analysis.nodes.push({type:'element',graphKey:'single',tag:'Chart',isComponent:true,selfClosing:true,start:0,end:1,attributes:[{name:'data',value:{static:true,json:'$summary'},start:0,end:1},{name:'viz',value:{static:true,json:{kind:'single_value'}},start:0,end:1}],children:[]});
 const proof=analyzeNativeOperations(i).operations.find(operation=>operation.kind==='visualization')!;assert.equal(proof.route,'native-single-value');assert.ok(proof.requiredGuarantees.includes('single-value-dom'));assert.ok(!proof.requiredGuarantees.includes('vega-spec-signals'));
});
function staticChartInput(): NativeOperationAnalysisInput {
 const i=input(),node=i.analysis.nodes[0]!; if(node.type!=='element')throw Error('fixture');
 const rows=[{label:'first',amount:2},{label:'second',amount:1}],columns=[{name:'label',type:'string'},{name:'amount',type:'number'}];
 const element=(tag:string,key:string,props:Record<string,unknown>)=>({...structuredClone(node),tag,graphKey:key,attributes:Object.entries(props).map(([name,json])=>({name,value:{static:true as const,json:json as never},start:0,end:1}))});
 i.analysis.nodes=[element('Value','literal-source',{name:'items',type:'table',value:rows}),element('Chart','chart',{data:'$items',viz:{kind:'vega-lite',spec:{mark:'bar',encoding:{x:{field:'label',type:'nominal'},y:{field:'amount',type:'quantitative'}}}}})];
 i.analysis.flow={imports:[],values:[{name:'items',kind:'table',rows,columns,start:0,end:1}],queries:[],mutations:[]};i.compilation.queries=[];i.compilation.values=[{name:'items',kind:'table',type:'table',default:null,rows:structuredClone(rows),columns:structuredClone(columns)}];return i;
}
test('literal table visualization has a separate source-node and ordered-table proof, never invented query coverage',()=>{
 const i=staticChartInput();i.admissions=admit(i);const proof=analyzeNativeOperations(i);assert.deepEqual(proof.blockers,[]);assert.deepEqual(proof.queryOrder,[]);assert.deepEqual(proof.operations[0]!.dependencies,[]);const source=proof.operations[0]!.visualizationSource;assert.equal(source?.kind,'static-table-value');if(source?.kind!=='static-table-value')throw Error('source');assert.equal(source.sourceNode,'literal-source');for(const hash of [source.sourceNodeSha256,source.rowsSha256,source.columnsSha256])assert.match(hash,/^[a-f0-9]{64}$/);
 const moved=structuredClone(i);moved.analysis.nodes[0]!.graphKey='replacement-source';assert.ok(analyzeNativeOperations(moved).blockers.length);const reordered=structuredClone(i);(reordered.analysis.flow.values[0]!.rows as unknown[]).reverse();(reordered.analysis.nodes[0]as any).attributes.find((a:any)=>a.name==='value').value.json.reverse();(reordered.compilation.values[0]as any).rows.reverse();assert.ok(analyzeNativeOperations(reordered).blockers.length);
});
test('static visualization rejects missing/duplicate/scalar/dynamic or changed table sources and unresolved field/type contracts',()=>{
 const changes:Array<(i:NativeOperationAnalysisInput)=>void>=[
  i=>{i.analysis.flow.values=[]},i=>{(i.analysis.nodes[0]as any).attributes.pop()},i=>{delete(i.compilation.values[0]as any).rows},i=>{i.analysis.flow.values.push(structuredClone(i.analysis.flow.values[0]!))},i=>{i.compilation.values=[...i.compilation.values,structuredClone(i.compilation.values[0]!)]},
  i=>{(i.compilation.values[0]as any).kind='scalar'},i=>{(i.compilation.values[0]as any).rows[0].amount=99},i=>{(i.compilation.values[0]as any).columns[1].type='string'},
  i=>{(i.analysis.nodes[0]as any).attributes[2].value={static:false,exprType:'CallExpression',source:'loadRows()'}},i=>{(i.analysis.nodes[0]as any).attributes.push({name:'source',value:{static:true,json:'ref:external'}})},
  i=>{(i.analysis.nodes[1]as any).attributes[1].value.json.spec.encoding.x.field='unknown'},i=>{(i.analysis.nodes[1]as any).attributes[1].value.json.spec.encoding.y.type='nominal'},
  i=>{(i.analysis.nodes[1]as any).attributes[1].value.json.spec.transform=[{calculate:'datum.amount*2',as:'derived'}]},
 ];
 for(const change of changes){const i=staticChartInput();change(i);i.admissions=admit(i);assert.ok(analyzeNativeOperations(i).blockers.length,'unsupported static source must fail closed');}
});
