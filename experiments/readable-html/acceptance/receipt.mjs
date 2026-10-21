import assert from 'node:assert/strict';
/** @param {import('./contracts.ts').AcceptanceReceipt} r */
export function validateReceipt(r) {
 assert.ok(['chromium','firefox','webkit'].includes(r.engine));
 assert.notEqual(r.localRevision,r.editedRevision);
 assert.equal(r.editedRevision,r.offlineRevision);
 assert.equal(r.tlsVerified,true);
 assert.ok(r.samplesMs.length>=5 && r.samplesMs.every(n=>Number.isFinite(n)&&n>=0));
 assert.ok(r.runtimeBytes>r.gzipBytes && r.gzipBytes>0);
 for(const stage of ['local','hosted','edited','downloaded','offline','history','unauthorized','conflict']) assert.ok(r.assertions.includes(stage));
 return true;
}
