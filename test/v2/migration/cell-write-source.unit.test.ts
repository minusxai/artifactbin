import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readLegacyCellWriteSites,
  typeLegacyCellWriteSites,
} from "../../../src/migration/conversion/compiled/cell-write-source.ts";
const source =
  '<DataTable data="$rows" rowKey="id"><Column col="title"><input value="$_row.title" run="$save" type="text"/></Column><Column col="tags"><Select value="$_row.tags" run="$tags" options="$choices" multiple={true} valueFormat="json" allowCreate={true}/></Column></DataTable>';
test("editing-cell sites bind exact authored table, column, key and immutable scalar type", () => {
  const sites = readLegacyCellWriteSites(source);
  assert.deepEqual(sites, [
    {
      mutationName: "save",
      dataName: "rows",
      column: "title",
      rowKey: "id",
      tag: "input",
    },
    {
      mutationName: "tags",
      dataName: "rows",
      column: "tags",
      rowKey: "id",
      tag: "Select",
      optionsQuery: "choices",
    },
  ]);
  assert.deepEqual(
    typeLegacyCellWriteSites(sites, {
      rows: [
        { name: "id", type: "string" },
        { name: "title", type: "string" },
        { name: "tags", type: "string" },
      ],
    }).map((s) => s.type),
    ["string", "string"],
  );
  assert.throws(() =>
    typeLegacyCellWriteSites(sites, { rows: [{ name: "id", type: "string" }] }),
  );
});
test("editing cells refuse missing row identity, mismatched fields, ambient user options and conflicting types", () => {
  for (const input of [
    source.replace(' rowKey="id"', ""),
    source.replace("$_row.title", "$_row.other"),

    '<input value="$_row.title" run="$save"/>',
  ])
    assert.throws(() => readLegacyCellWriteSites(input));
  const sites = readLegacyCellWriteSites(source);
  assert.throws(() =>
    typeLegacyCellWriteSites(
      sites.map((s) => ({ ...s, mutationName: "same" })),
      {
        rows: [
          { name: "id", type: "string" },
          { name: "title", type: "number" },
          { name: "tags", type: "string" },
        ],
      },
    ),
  );
});
test("offline compiled column inference must agree with every registered cell value type", async () => {
  const { validateCompiledCellWriteContexts } = await import(
    "../../../src/migration/conversion/compiled/cell-write-context.ts"
  );
  const flow = {
    queries: [
      {
        name: "rows",
        columns: [
          { name: "id", type: "string" as const },
          { name: "title", type: "string" as const },
          { name: "tags", type: "string" as const },
        ],
      },
    ],
    values: [],
  };
  const bindings = ["save", "tags"].map((name) => ({
    name,
    backendNamespace: "legacyData",
    recoveryScope: "a".repeat(64),
    paramTypes: {},
    valueParam: { param: "cell__value", type: "string" as const },
  }));
  assert.doesNotThrow(() =>
    validateCompiledCellWriteContexts(source, flow, bindings),
  );
  assert.throws(() =>
    validateCompiledCellWriteContexts(
      source,
      {
        ...flow,
        queries: [
          {
            name: "rows",
            columns: flow.queries[0]!.columns.map((c) => ({
              ...c,
              type: null,
            })),
          },
        ],
      },
      bindings,
    ),
  );
  assert.throws(() =>
    validateCompiledCellWriteContexts(
      source,
      flow,
      bindings.map((b) => ({
        ...b,
        valueParam: { ...b.valueParam, type: "number" as const },
      })),
    ),
  );
  assert.throws(() =>
    validateCompiledCellWriteContexts("<p>None</p>", flow, bindings),
  );
});
test("explicit cell option source port never adds an ambient user listing", async () => {
  const { archivedExplicitCellOptionsSource } = await import(
    "../../../src/migration/conversion/compiled/cell-kit-source.ts"
  );
  const source =
    "const [userOptions, setUserOptions] = createSignal(store?.getState().userOptions);\nif (store && !isServer) onCleanup(store.subscribe(() => setUserOptions(() => store.getState().userOptions)));";
  const output = archivedExplicitCellOptionsSource(source);
  assert.doesNotMatch(output, /getState|store.subscribe/);
  assert.match(output, /createSignal\(undefined\)/);
  assert.throws(() => archivedExplicitCellOptionsSource("changed source"));
});

test("unrelated read-only dynamic tables do not acquire editing scope restrictions", () => {
  assert.deepEqual(
    readLegacyCellWriteSites(
      "<DataTable data={chooseRows()}><Column col={chooseColumn()}/></DataTable>" +
        source,
    ),
    readLegacyCellWriteSites(source),
  );
});
test("editing Selects retain finite authored option validation and do not drop authored children", () => {
  for (const options of ["[{}]", JSON.stringify(Array(10001).fill("a"))])
    assert.throws(() =>
      readLegacyCellWriteSites(
        source.replace('options="$choices"', "options={" + options + "}"),
      ),
    );
  assert.throws(() =>
    readLegacyCellWriteSites(
      source.replace(
        'type="text"/>',
        'type="text"><span>Hidden</span></input>',
      ),
    ),
  );
});
test("checkbox editing remains explicit unsupported because archived native cells emit text rather than checked state", () => {
  assert.throws(() =>
    readLegacyCellWriteSites(source.replace('type="text"', 'type="checkbox"')),
  );
});
test('native editing input constraints preserve fixed mutation scope and reject executable bounds',()=>{
 const cell=(attributes:string)=>'<DataTable data="$rows" rowKey="id"><Column col="amount"><input type="number" value="$_row.amount" run="$save" '+attributes+'/></Column></DataTable>';
 const expected=[{mutationName:'save',dataName:'rows',column:'amount',rowKey:'id',tag:'input'}];
 for(const attrs of ['min={0}','min="-1" max={100} step="any"','min={-2} max={2} step={0.25}'])assert.deepEqual(readLegacyCellWriteSites(cell(attrs)),expected);
 for(const attrs of ['min={window.limit}','max={()=>1}','step={{value:1}}','min={true}','step={1e999}'])assert.throws(()=>readLegacyCellWriteSites(cell(attrs)));
});
test('prototype cell scope ignores compiler-owned presentation but preserves exact mutation authority',()=>{
 const cell=(extra:string)=>'<DataTable data="$rows" rowKey="id"><Column col="title"><input type="text" value="$_row.title" run="$save" '+extra+'/></Column></DataTable>';
 const source=cell('style={{width:"12rem"}} title="Edit title" placeholder={$hint} data-extra="presentation"');
 assert.throws(()=>readLegacyCellWriteSites(source));
 assert.deepEqual(readLegacyCellWriteSites(source,undefined,'offline-prototype'),[{mutationName:'save',dataName:'rows',column:'title',rowKey:'id',tag:'input',wireType:'string'}]);
 for(const bad of [source.replace('run="$save"','run={$name}'),source.replace('value="$_row.title"','value="$_row.other"'),source.replace('rowKey="id"',''),cell('{...attrs}')])assert.throws(()=>readLegacyCellWriteSites(bad,undefined,'offline-prototype'));
});
test('dialog submission is separate from editing-cell mutation scope',()=>{
 const dialog='<DialogContent run="$create"><input name="title"/></DialogContent>';
 assert.deepEqual(readLegacyCellWriteSites(dialog),[]);
 assert.deepEqual(readLegacyCellWriteSites(dialog+source),readLegacyCellWriteSites(source));
 assert.throws(()=>readLegacyCellWriteSites('<Unknown run="$create"/>'));
});
test('prototype wire typing requires exact query columns and a parsed native control protocol',()=>{
 const sites=readLegacyCellWriteSites(source,undefined,'offline-prototype');
 const unknown={rows:[{name:'id',type:null},{name:'title',type:null},{name:'tags',type:null}]};
 assert.throws(()=>typeLegacyCellWriteSites(sites,unknown));
 assert.deepEqual(typeLegacyCellWriteSites(sites,unknown,'offline-prototype').map(s=>s.type),['string','string']);
 assert.throws(()=>typeLegacyCellWriteSites(sites,{rows:[{name:'id',type:null}]},'offline-prototype'));
 assert.throws(()=>typeLegacyCellWriteSites(sites.map(({wireType,...site})=>site),unknown,'offline-prototype'));
});
test('prototype Select keeps custom trigger presentation with the same mutation authority',()=>{
 const source='<DataTable data="$rows" rowKey="id"><Column col="title"><Select value="$_row.title" run="$save" options="$choices"><button type="button">Choose</button></Select></Column></DataTable>';
 assert.throws(()=>readLegacyCellWriteSites(source));
 const sites=readLegacyCellWriteSites(source,undefined,'offline-prototype');
 assert.equal(sites.length,1);assert.equal(sites[0]!.mutationName,'save');assert.equal(sites[0]!.column,'title');
 assert.throws(()=>readLegacyCellWriteSites(source.replace('type="button"','run="$other"'),undefined,'offline-prototype'));
});
test("implicit Select choices require proven user column, never string or computed fallback",()=>{
 const source='<DataTable data="$rows" rowKey="id"><Column col="owner"><Select value="$_row.owner" run="$save_owner"/></Column></DataTable>';
 const sites=readLegacyCellWriteSites(source);
 assert.equal(sites[0]?.implicitUserOptions,true);
 for(const mode of ["strict","offline-prototype"] as const){
  assert.equal(typeLegacyCellWriteSites(sites,{rows:[{name:"id",type:"string"},{name:"owner",type:"user"}]},mode)[0]?.type,"user");
  for(const type of ["string",null] as const)assert.throws(()=>typeLegacyCellWriteSites(sites,{rows:[{name:"id",type:"string"},{name:"owner",type}]},mode));
 }
});
