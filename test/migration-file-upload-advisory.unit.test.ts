import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeUploadAdvisory} from '../src/migration/conversion/compiled/file-upload-advisory.ts';
test('native control distinguishes an available null advisory from a missing trusted adapter',()=>{
 let unavailable:string|null='Pending';const store={attachmentUnavailable(name:string){assert.equal(name,'files');return unavailable;}};
 assert.equal(nativeUploadAdvisory(store,'files'),'Pending');unavailable=null;assert.equal(nativeUploadAdvisory(store,'files'),'');unavailable='Denied';assert.equal(nativeUploadAdvisory(store,'files'),'Denied');
 for(const missing of[undefined,null,{}])assert.equal(nativeUploadAdvisory(missing,'files'),'File uploads are unavailable.');
});
