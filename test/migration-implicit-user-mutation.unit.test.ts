import test from "node:test";
import assert from "node:assert/strict";
import {extractLegacyMutations} from "../src/migration/conversion/mutations.ts";
const source='<Helmet><Import name="data" src="ref:Abcd12"/><Query name="base">{`select id,owner as assignee from data.rows`}</Query><Query name="items">{`select id,assignee from base`}</Query><Mutation name="assign" expectedAffected={1}>{`update data.rows set owner=$_value where id=$_row.id`}</Mutation></Helmet><DataTable data="$items" rowKey="id"><Column col="assignee"><Select value="$_row.assignee" run="$assign"/></Column></DataTable>';
const catalog=(type:"user"|"string")=>[{name:"data",datasetLegacyId:"Abcd12",tables:[{schema:"public",name:"rows",columns:[{name:"id",type:"string" as const},{name:"owner",type}]}]}];
test("implicit person edits publish exact source-column authority through aliased query dependencies",async()=>{
 const result=await extractLegacyMutations(source,catalog("user"));
 assert.deepEqual(result.issues,[]);assert.equal(result.mutations.length,1);
 assert.deepEqual(result.mutations[0]?.cellUserChoice,{name:"items",column:"assignee",bindingName:"data",schema:"public",table:"rows",sourceColumn:"owner"});
 assert.deepEqual(result.mutations[0]?.valueParam,{param:"cell__value",type:"user"});
 for(const mode of ["strict","offline-prototype"] as const){
  const refused=await extractLegacyMutations(source,catalog("string"),[],mode);assert.equal(refused.mutations.length,0);assert.equal(refused.issues.length,1);
 }
 const computed=await extractLegacyMutations(source.replace("owner as assignee","cast(owner as text) as assignee"),catalog("user"),[],"offline-prototype");
 assert.equal(computed.mutations.length,0);assert.equal(computed.issues.length,1);
});

test("implicit choices refuse ambiguous reuse and missing field/table origins",async()=>{
 const ambiguous=source.replace('id,owner as assignee','id,owner as assignee,owner as second').replace('select id,assignee from base','select id,assignee,second from base').replace('</DataTable>','<Column col="second"><Select value="$_row.second" run="$assign"/></Column></DataTable>');
 for(const text of [ambiguous,source.replace('col="assignee"','col="missing"').replace('value="$_row.assignee"','value="$_row.missing"'),source.replace('from data.rows','from data.missing')]){
  const result=await extractLegacyMutations(text,catalog("user"));assert.equal(result.mutations.length,0);assert.equal(result.issues.length,1);
 }
});
