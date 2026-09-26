/**
 * THE DATA-SYNTAX MARKER on the publish path (lib/story/data-syntax): every
 * creation and every whole-document write carries `meta.dataSyntax = 2`; a
 * partial edit keeps whatever the document had, so an unmigrated document is
 * never marked as converted by an edit that validated only part of it.
 */
import {expect,it} from 'vitest';
import {useAppHarness,request} from './harness';
import {mintToken} from '@/lib/tokens';
import {editorScope,getArtifactById} from '@/lib/artifacts';
import {POST as createRoute} from '@/app/api/artifacts/route';
import {prepareClientDocumentReplacement,prepareClientDocumentUpdate} from '@/lib/story/document-update-client';
import {commitDocumentUpdate} from '@/lib/story/document-update-write';
import type {DocumentGraph} from '@/lib/story/document-graph';

const harness=useAppHarness();

async function created(markup:string){
 const token=await mintToken('mxmx_test_data_syntax'),actor={tokenId:token.id,userId:null};
 const res=await createRoute(request('/api/artifacts',{method:'POST',token:token.token,json:{markup}}));
 expect(res.status).toBe(201);
 return {actor,id:((await res.json()) as {id:string}).id};
}

/** A document as it stood before the marker existed. */
async function unmark(id:string){
 const db=await harness.db();
 await db.query("UPDATE artifacts SET meta=meta-'dataSyntax' WHERE id=$1",[id]);
 const row=(await getArtifactById(id))!;
 const document=(await db.query<{document:DocumentGraph}>('SELECT document FROM artifacts WHERE id=$1',[id])).rows[0]!.document;
 expect(row.meta.dataSyntax).toBeUndefined();
 return {row,base:{document,version:row.version,meta:row.meta}};
}

it('marks a created document',async()=>{
 const {id}=await created('<main id="root"><p id="a">Alpha</p></main>');
 expect((await getArtifactById(id))!.meta.dataSyntax).toBe(2);
});

it('marks a whole-document write of an unmarked document',async()=>{
 const {actor,id}=await created('<main id="root"><p id="a">Alpha</p></main>');
 const {row}=await unmark(id);
 const update=prepareClientDocumentReplacement('<main id="root"><p id="a">Whole</p></main>',row.version);
 const db=await harness.db();
 expect((await commitDocumentUpdate(db,actor,editorScope(actor),id,update))?.applied).toBe(true);
 expect((await getArtifactById(id))!.meta.dataSyntax).toBe(2);
});

it('keeps an unmarked document unmarked through a partial commit (the edit door converts first: unmigrated-document-serving)',async()=>{
 const {actor,id}=await created('<main id="root"><p id="a">Alpha</p></main>');
 const {base}=await unmark(id);
 const update=prepareClientDocumentUpdate(base,{operations:[{kind:'setText',path:[0,0,0],value:'Partial'}]});
 const db=await harness.db();
 expect((await commitDocumentUpdate(db,actor,editorScope(actor),id,update))?.applied).toBe(true);
 const after=(await getArtifactById(id))!;
 expect(after.source).toContain('Partial');
 expect(after.meta.dataSyntax).toBeUndefined();
});
