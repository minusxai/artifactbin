import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReceipt } from './receipt.mjs';
const receipt = {engine:'chromium',localRevision:'a',editedRevision:'b',offlineRevision:'b',samplesMs:[1,2,3,4,5],runtimeBytes:100,gzipBytes:50,tlsVerified:true,assertions:['local','hosted','edited','downloaded','offline','history','unauthorized','conflict']};
test('receipt rejects missing lifecycle, broken revision continuity, TLS bypass and invalid timings',()=>{
 assert.equal(validateReceipt(receipt),true);
 for(const patch of [{offlineRevision:'a'},{editedRevision:'a'},{tlsVerified:false},{samplesMs:[1,NaN]},{assertions:['local']},{gzipBytes:200}]) assert.throws(()=>validateReceipt({...receipt,...patch}));
});
