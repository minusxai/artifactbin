import { test } from "node:test";
import assert from "node:assert/strict";
import { admitLocalSource } from "../../../src/migration/conversion/compiled/source-admission.ts";
const source =
  '<Helmet><Import name="items" src="ref:Abcd12"/><Query name="rows">{`select id,title from items.rows`}</Query><Query name="choices">{`select title from items.rows`}</Query><Mutation name="save" expectedAffected={1}>{`update items.rows set title = $_value where id = $_row.id`}</Mutation></Helmet><DataTable id="table" data="$rows" rowKey="id"><Column col="title"><input id="edit" aria-label="Title" type="text" value="$_row.title" run="$save"/></Column></DataTable>';
const input = {
  source,
  coreUrl: "/af/v1/core.js",
  datasetBindings: [
    {
      name: "items",
      legacyRef: "ref:Abcd12",
      backendNamespace: "legacyData",
      backendHref: "/af/v1/ids/Bac123",
      version: 1,
      mode: "live" as const,
      tables: [
        {
          schema: "main",
          table: "rows",
          columns: [
            { name: "id", type: "string" },
            { name: "title", type: "string" },
          ],
        },
      ],
    },
  ],
  datasetMutations: [
    {
      name: "save",
      backendNamespace: "legacyData",
      recoveryScope: "a".repeat(64),
      paramTypes: {},
      rowParams: { id: { param: "row__id", type: "string" as const } },
      valueParam: { param: "cell__value", type: "string" as const },
    },
  ],
};
test("exact registered editing controls admit only their authored row column and explicit options", () => {
  assert.equal(admitLocalSource(input).ok, true);
  assert.equal(
    admitLocalSource({
      ...input,
      source: source.replace(
        '<input id="edit" aria-label="Title" type="text" value="$_row.title" run="$save"/>',
        '<Select id="edit" label="Title" value="$_row.title" run="$save" options="$choices" multiple={true} valueFormat="json" allowCreate={true}/>',
      ),
    }).ok,
    true,
  );
});
test("cell source gate refuses standalone, mismatched, implicit options and Button generated-value use", () => {
  for (const text of [
    source.replace("$_row.title", "$_row.other"),
    source.replace(' rowKey="id"', ""),
    source.replace(
      '<input id="edit" aria-label="Title" type="text" value="$_row.title" run="$save"/>',
      '<Select value="$_row.title" run="$save"/>',
    ),
    source.replace(
      '<input id="edit" aria-label="Title" type="text" value="$_row.title" run="$save"/>',
      '<Button run="$save">Save</Button>',
    ),
    source.replace('<Column col="title">', '<Column col="title"><script/>'),
  ])
    assert.equal(admitLocalSource({ ...input, source: text }).ok, false);
  const { valueParam, ...ordinary } = input.datasetMutations[0]!;
  assert.equal(
    admitLocalSource({ ...input, datasetMutations: [ordinary] }).ok,
    false,
  );
});
test("implicit person choices require exact registered routes and user-valued mutation",()=>{
 const source=input.source.replace('<input id="edit" aria-label="Title" type="text" value="$_row.title" run="$save"/>','<Select value="$_row.title" run="$save"/>');
 const selected={...input,source,datasetBindings:input.datasetBindings.map(b=>({...b,tables:b.tables.map(t=>({...t,columns:t.columns.map(c=>c.name==="title"?{...c,type:"user"}:c)}))})),datasetMutations:input.datasetMutations.map(m=>({...m,valueParam:{param:"cell__value",type:"user" as const}})),cellUserChoiceBindings:[{queryName:"rows",column:"title",backendNamespace:"legacyData"}]};
 assert.equal(admitLocalSource(selected).ok,true);
 for(const routes of [[],[{queryName:"rows",column:"other",backendNamespace:"legacyData"}],[{queryName:"rows",column:"title",backendNamespace:"other"}],selected.cellUserChoiceBindings.concat(selected.cellUserChoiceBindings)])assert.equal(admitLocalSource({...selected,cellUserChoiceBindings:routes}).ok,false);
 assert.equal(admitLocalSource({...selected,datasetMutations:input.datasetMutations}).ok,false);
});
