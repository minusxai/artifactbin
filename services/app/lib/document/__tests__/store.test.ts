import {beforeEach, describe, expect, it} from 'vitest';
import type {DocumentEdit, RichDocument} from '@artifactbin/contracts';
import {getArtifactById,replaceArtifactFor,revertArtifactFor} from '@/lib/artifacts';
import {useAppHarness} from '@/__tests__/harness';
import {editDocument,createDocument} from '../store';
const harness=useAppHarness();
const actor={tokenId:'test-owner',userId:null};
const document:RichDocument={schemaVersion:1,rootId:'root',nodes:{root:{type:'document',props:{},children:['a','b']},a:{type:'paragraph',props:{},content:[]},b:{type:'paragraph',props:{},content:[]}}};
let serial=0;
const edit=(id='a',baseVersion=1):DocumentEdit=>({baseVersion,operationId:`operation-${serial++}`,changedIds:[id],ancestorIds:['root'],operations:[{kind:'set',nodeId:id,path:['props','className'],value:`v${serial}`}]});
beforeEach(async()=>{await (await harness.db()).query("INSERT INTO artifacts(id,token_id,title,content,document) VALUES ('doc123','test-owner','Test','',$1::jsonb)",[JSON.stringify(document)]);});
async function head(){return (await (await harness.db()).query<{document:RichDocument;version:number}>('SELECT document,version FROM artifacts WHERE id=$1',['doc123'])).rows[0]!;}
describe('atomic document edits',()=>{
 it('archives the previous snapshot with the outgoing metadata',async()=>{
  const request=edit();expect(await editDocument(actor,'doc123',request)).toMatchObject({updated:true,version:2});
  const rows=(await (await harness.db()).query('SELECT document,version,changed_ids,ancestor_ids,operation_id FROM artifact_versions')).rows;
  expect(rows).toEqual([{document,version:1,changed_ids:['a'],ancestor_ids:['root'],operation_id:request.operationId}]);
  expect((await head()).document.nodes.a.props.className).toBeTruthy();
 });
 it('accepts different paragraphs from the same base and rejects overlapping nodes',async()=>{
  expect((await editDocument(actor,'doc123',edit('a'))).updated).toBe(true);
  expect((await editDocument(actor,'doc123',edit('b'))).updated).toBe(true);
  expect(await editDocument(actor,'doc123',edit('a'))).toMatchObject({updated:false,reason:'conflict'});
 });
 it('checks all 23 intervening versions without rejecting common ancestors',async()=>{
  for(let version=1;version<=23;version++)expect((await editDocument(actor,'doc123',edit('a',version))).updated).toBe(true);
  expect(await editDocument(actor,'doc123',edit('b',1))).toMatchObject({updated:true,version:25});
  expect(await editDocument(actor,'doc123',edit('a',1))).toMatchObject({reason:'conflict'});
 });
 it('rejects ancestor and descendant overlaps in either direction',async()=>{
  const ancestor=edit('root');ancestor.ancestorIds=[];
  expect((await editDocument(actor,'doc123',ancestor)).updated).toBe(true);
  expect(await editDocument(actor,'doc123',edit('b'))).toMatchObject({reason:'conflict'});
 });
 it('does not commit partial operations or archive an invalid batch',async()=>{
  const request=edit();request.operations.push({kind:'remove',nodeId:'root',path:['children'],index:99});
  expect(await editDocument(actor,'doc123',request)).toMatchObject({reason:'invalid'});
  expect(await head()).toEqual({document,version:1});expect((await (await harness.db()).query('SELECT * FROM artifact_versions')).rows).toEqual([]);
 });
 it('deduplicates a retried request',async()=>{
  const request=edit();await editDocument(actor,'doc123',request);
  expect(await editDocument(actor,'doc123',request)).toMatchObject({updated:false,reason:'duplicate',version:2});expect((await head()).version).toBe(2);
 });
 it('preserves access checks and the trash gate',async()=>{
  expect(await editDocument({tokenId:'stranger',userId:null},'doc123',edit())).toEqual({updated:false,reason:'not_found'});
  await (await harness.db()).query("UPDATE artifacts SET deleted_at=now() WHERE id='doc123'");
  expect(await editDocument(actor,'doc123',edit())).toEqual({updated:false,reason:'not_found'});
 });
 it('rejects future bases and missing intervening history',async()=>{
  expect(await editDocument(actor,'doc123',edit('a',2))).toMatchObject({reason:'conflict'});
  await editDocument(actor,'doc123',edit());await (await harness.db()).query('DELETE FROM artifact_versions');
  expect(await editDocument(actor,'doc123',edit('b'))).toMatchObject({reason:'conflict'});
 });
});

it('creates canonical JSONB with the existing identity ledger',async()=>{
 const created=await createDocument(actor,'A document',document);
 expect(created.document).toEqual(document);
 const db=await harness.db();
 const row=(await db.query('SELECT document,source,content FROM artifacts WHERE id=$1',[created.id])).rows[0];
 expect(row).toEqual({document,source:null,content:''});
 expect((await db.query('SELECT source_id FROM artifact_source_ids WHERE artifact_id=$1 ORDER BY source_id',[created.id])).rows.map(r=>r.source_id)).toEqual(['a','b','root']);
});

it('returns the accepted canonical document so buffered typing can advance its base',async()=>{
 const result=await editDocument(actor,'doc123',edit());
 expect(result.updated&&result.document).toEqual((await head()).document);
});
it('retires deleted identities and reactivates them on undo in the same atomic commit',async()=>{
 await (await harness.db()).query("INSERT INTO artifact_source_ids(artifact_id,source_id,provenance,first_version) VALUES ('doc123','a','authored',1)");
 const removed:DocumentEdit={baseVersion:1,operationId:'remove-a',changedIds:['root','a'],ancestorIds:['root'],operations:[{kind:'remove',nodeId:'root',path:['children'],index:0},{kind:'removeNodes',ids:['a']}]};
 expect((await editDocument(actor,'doc123',removed)).updated).toBe(true);
 expect((await (await harness.db()).query("SELECT retired_version FROM artifact_source_ids WHERE artifact_id='doc123' AND source_id='a'")).rows[0].retired_version).toBe(2);
 const restored:DocumentEdit={baseVersion:2,operationId:'restore-a',changedIds:['root','a'],ancestorIds:['root'],operations:[{kind:'addNodes',nodes:{a:document.nodes.a}},{kind:'insert',nodeId:'root',path:['children'],index:0,value:'a'}]};
 expect((await editDocument(actor,'doc123',restored)).updated).toBe(true);
 expect((await (await harness.db()).query("SELECT retired_version FROM artifact_source_ids WHERE artifact_id='doc123' AND source_id='a'")).rows[0].retired_version).toBeNull();
});
it('derives render source from canonical JSONB without storing a second document',async()=>{
 const row=await getArtifactById('doc123');expect(row?.source).toContain('<p');
 expect((await (await harness.db()).query("SELECT source FROM artifacts WHERE id='doc123'")).rows[0].source).toBeNull();
});

it('refuses the old source-replacement path for canonical JSONB documents',async()=>{
 const result=await replaceArtifactFor(actor,'doc123',{format:'markup',source:'<p>wrong editor</p>',content:'',meta:{}});
 expect(result).toBeInstanceOf(Response);expect((result as Response).status).toBe(409);expect((await head()).document).toEqual(document);
});

it('refuses legacy source revert without corrupting JSONB snapshots',async()=>{
 await editDocument(actor,'doc123',edit());
 const result=await revertArtifactFor(actor,'doc123',1);
 expect(result).toMatchObject({notArchived:true});
 expect(result&&'refusal' in result&&result.refusal?.status).toBe(409);
 expect((await head()).version).toBe(2);
});
