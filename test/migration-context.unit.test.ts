import test from 'node:test';
import assert from 'node:assert/strict';
import {Parser} from 'acorn';
import jsx from 'acorn-jsx';
import {readContextReferences} from '../src/migration/conversion/compiled/context-source.ts';
import {contextMetadata} from '../src/migration/conversion/compiled/context-output.ts';
import {rewriteMigrationLinks} from '../src/migration/links.ts';
const read=(source:string)=>readContextReferences(Parser.extend(jsx()).parseExpressionAt('<>'+source+'</>',0,{ecmaVersion:'latest'}));
test('supporting document metadata preserves exact frozen reference and has no body or fetch program',()=>{
 const refs=read('<Helmet><Context src="ref:Ab1234"/> </Helmet><p id="body">Saved</p>');
 assert.deepEqual(refs,[{legacyId:'Ab1234'}]);
 assert.deepEqual(contextMetadata(refs),{head:'<link rel="related" href="ref:Ab1234" data-migration-context="supporting-document">',provenance:refs});
 assert.deepEqual(read('<p>None</p>'),[]);
});
test('context rejects nonliteral, URL, child, duplicate and misplaced references',()=>{
 for(const source of ['<Context src="ref:Ab1234"/>','<div><Helmet><Context src="ref:Ab1234"/></Helmet></div>','<Helmet><div><Context src="ref:Ab1234"/></div></Helmet>','<Helmet><Context src={"ref:Ab1234"}/></Helmet>','<Helmet><Context src="https://example.test/a/Ab1234"/></Helmet>','<Helmet><Context src="ref:Ab1234" extra="x"/></Helmet>','<Helmet><Context src="ref:Ab1234">Text</Context></Helmet>','<Helmet><Context src="ref:Ab1234"/>{true&&<Context src="ref:Cd5678"/>}</Helmet>','<Helmet><Context src="ref:short"/></Helmet>','<Helmet/><Helmet><Context src="ref:Ab1234"/></Helmet>'])assert.throws(()=>read(source),source);
 assert.throws(()=>contextMetadata([{legacyId:'"><script>'}]));
});
test('supporting references follow ready target mapping, explicit legacy fallback and fail closed without origin',()=>{
 const html=contextMetadata([{legacyId:'Ab1234'}]).head;
 const maps={pages:{Ab1234:'new123'},users:{},groups:{},tokens:{}};
 const options={legacyOrigins:['https://legacy.test'],targetOrigin:'https://new.test'};
 const ready=rewriteMigrationLinks(html,maps,options);
 assert.equal(rewriteMigrationLinks(ready,maps,options),ready);
 assert.match(ready,/href="\/a\/new123"/);
 for(const mapped of [true,false]){
  const diagnostics:unknown[]=[];
  const activeMaps=mapped?maps:{...maps,pages:{}};
  const result=rewriteMigrationLinks(html,activeMaps,{...options,readyPages:new Set(),onDiagnostic:d=>diagnostics.push(d)});
  assert.match(result,/href="https:\/\/legacy.test\/a\/Ab1234"/);
  assert.equal(diagnostics.length,1);
  assert.equal((diagnostics[0] as any).disposition,mapped?'legacy-target-blocked':'legacy-target-unmapped');
  assert.throws(()=>rewriteMigrationLinks(html,activeMaps,{...options,legacyOrigins:[],readyPages:new Set()}),/Supporting document requires legacy origin/);
 }
});
