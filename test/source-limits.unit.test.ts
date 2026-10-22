import test from 'node:test';import assert from 'node:assert/strict';
import {MAX_PAGE_SOURCE,MAX_BACKEND_SOURCE_CHARACTERS,MAX_REQUEST_BODY_BYTES,utf8ByteLength} from '../src/af-contracts.ts';
import {readRequestText} from '../src/server/request.ts';
test('page size is UTF8 bytes, including multibyte scalars and isolated surrogate replacement',()=>{
 assert.equal(MAX_PAGE_SOURCE,6_000_000);assert.equal(MAX_BACKEND_SOURCE_CHARACTERS,4_000_000);assert.equal(MAX_REQUEST_BODY_BYTES,8_000_000);
 for(const s of ['abc','☃','😀','\ud800','\udc00','a\ud800z'])assert.equal(utf8ByteLength(s),new TextEncoder().encode(s).byteLength);
 assert.equal(utf8ByteLength('☃'.repeat(2_000_000)),MAX_PAGE_SOURCE);
 assert.equal(utf8ByteLength('☃'.repeat(2_000_000)+'x'),MAX_PAGE_SOURCE+1);
});
test('HTTP request cap counts bytes across split UTF8 chunks before retaining oversized data',async()=>{
 const bytes=new TextEncoder().encode('☃😀');async function* chunks(){yield bytes.subarray(0,2);yield bytes.subarray(2,5);yield bytes.subarray(5);}
 assert.equal(await readRequestText(chunks(),7),'☃😀');
 await assert.rejects(readRequestText(chunks(),6),e=>(e as {status?:number}).status===413);
 let read=0;async function* oversized(){read++;yield new Uint8Array(9);read++;yield new Uint8Array(1);}
 await assert.rejects(readRequestText(oversized(),8),/Request too large/);assert.equal(read,1);
});
