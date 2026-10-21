import test from 'node:test';import assert from 'node:assert/strict';
import {readBoundedJSON} from '../src/browser/bounded-response.ts';
test('bounded response rejects UTF8 byte overflow and cancels unread stream',async()=>{
 let cancelled=false;let i=0;const response=new Response(new ReadableStream({pull(controller){controller.enqueue(new TextEncoder().encode(i++?'éé':'{"a":"'));},cancel(){cancelled=true;}}));
 await assert.rejects(readBoundedJSON(response,8),/too large/);assert.equal(cancelled,true);
 assert.deepEqual(await readBoundedJSON(new Response('{"a":1}'),20),{a:1});
 await assert.rejects(readBoundedJSON(new Response('bad'),20));
});
