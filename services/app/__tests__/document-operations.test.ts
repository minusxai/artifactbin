import {expect,it} from 'vitest';
import {useAppHarness} from './harness';
import {getDb} from '@/lib/db';
import {encodeDocument,decodeDocument,type StoredDocument} from '@/lib/story/document-codec';
import {prepareDocumentPatch,documentPatchSql} from '@/lib/story/document-patch';
useAppHarness();
it('composes nested text, attributes, insertion, removal and reordering in one JSONB update',async()=>{
 const before=encodeDocument('<section id="root"><p id="a">Alpha</p><p id="b">Beta</p></section>');
 const after=encodeDocument('<section id="root" className="p-4"><p id="b">Beta!</p><div id="new"><p id="a">Alpha</p></div></section>');
 const db=await getDb();await db.query('CREATE TEMP TABLE document_patch_test (id int primary key, document jsonb)');
 await db.query('INSERT INTO document_patch_test VALUES(1,$1::jsonb)',[JSON.stringify(before)]);
 const plan=prepareDocumentPatch(before,after),sql=documentPatchSql('document',plan,[]);
 const result=await db.query<{document:StoredDocument}>(`UPDATE document_patch_test SET document=${sql.expression} WHERE id=1 RETURNING document`,sql.params);
 expect(decodeDocument(result.rows[0].document)).toBe(decodeDocument(after));
});
it('patches one leaf without sending the unchanged document in SQL parameters',()=>{
 const source='<section id="root"><p id="a">Alpha</p><p id="b">'+ 'unchanged '.repeat(10000)+'</p></section>';
 const before=encodeDocument(source),after=encodeDocument(source.replace('Alpha','Bravo'));
 const patch=prepareDocumentPatch(before,after),sql=documentPatchSql('document',patch,[]);
 expect(JSON.stringify(sql.params).length).toBeLessThan(200);
 expect(patch).toHaveLength(1);
});
it('handles literal nulls, removed properties, arrays and whole representation transitions',async()=>{
 const db=await getDb();
 for(const [before,after] of [[{a:[1,2],b:null},{a:[3],c:{value:null}}],[{schema:1,kind:'source',source:'old'},{schema:1,kind:'jsx',roots:[]}]]){
  const sql=documentPatchSql('$1::jsonb',prepareDocumentPatch(before,after),[JSON.stringify(before)]);
  expect((await db.query(`SELECT ${sql.expression} AS value, $1::jsonb AS baseline`,sql.params)).rows[0].value).toEqual(after);
 }
});
it.each([
 {before:{large:'unchanged '.repeat(10000)},after:{large:'unchanged '.repeat(10000),title:'Small addition'}},
 {before:[{large:'unchanged '.repeat(10000)}],after:['new',{large:'unchanged '.repeat(10000)}]},
 {before:{text:'👩 β '.repeat(10000)},after:{text:'👩 β '.repeat(5000)+'changed '+'👩 β '.repeat(5000)}},
])('keeps a deep edit payload small without retransmitting its unchanged surroundings',async({before,after})=>{
 const db=await getDb(),patch=prepareDocumentPatch(before,after),sql=documentPatchSql('$1::jsonb',patch,[JSON.stringify(before)]);
 expect(JSON.stringify(sql.params.slice(1)).length).toBeLessThan(500);
 expect((await db.query(`SELECT ${sql.expression} AS value`,sql.params)).rows[0].value).toEqual(after);
});
it('bounds SQL expression size when composing several text splices',async()=>{
 const before=Array.from({length:8},()=> 'unchanged '.repeat(1000)),after=before.map((text,index)=>text+' '+index);
 const sql=documentPatchSql('$1::jsonb',prepareDocumentPatch(before,after),[JSON.stringify(before)]);
 expect(sql.expression.length).toBeLessThan(20_000);
 const db=await getDb();expect((await db.query(`SELECT ${sql.expression} AS value`,sql.params)).rows[0].value).toEqual(after);
});
