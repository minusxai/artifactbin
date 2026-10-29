import {it,expect} from 'vitest';
import type {Queryable} from '@artifactbin/contracts';
import {attestSavedHtmlUpload,verifySavedHtmlUpload} from '../saved-html-upload';
import {verifyRegisteredHtmlMutation} from '../registered-html-mutation';
it('binds upload authority to exact document, version and dataset without becoming SQL authority',async()=>{
 const authority={id:'page',editId:'edit',version:1,datasetId:'dataset'},tx={} as Queryable,calls:Queryable[]=[];
 const proof=attestSavedHtmlUpload(authority,async db=>{calls.push(db);}),document={...authority,uploadProof:proof};
 expect(await verifySavedHtmlUpload(document,'dataset',tx)).toBe(true);expect(calls).toEqual([tx]);
 for(const changed of [{id:'other'},{editId:'other'},{version:2},{datasetId:'other'},{uploadProof:JSON.parse(JSON.stringify(proof))}])expect(await verifySavedHtmlUpload({...document,...changed},'dataset',tx)).toBe(false);
 expect(await verifySavedHtmlUpload(document,'other',tx)).toBe(false);
 expect(await verifyRegisteredHtmlMutation({...authority,registeredHtml:proof},tx)).toBe(false);
});
