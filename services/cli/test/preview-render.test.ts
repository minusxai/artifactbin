/**
 * `afbin export <file>`'s render request (src/preview-render): a script document gets the server exporter's policy
 * (app/lib/export/script-origins) — its module hosts admitted and its component mounts waited for — and a document
 * without a script asks for neither. The fixtures are app/lib/__tests__/export-verdicts.test.ts's.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {previewRenderRequest} from '../src/preview-render';

const SCRIPTED=[
 '<Helmet><script>{`',
 "  import confetti from 'canvas-confetti';",
 "  import { scale } from 'https://cdn.example.com/scale.js';",
 '  export function Spark(props) { return <svg />; }',
 '`}</script></Helmet>',
 '<Spark><p>Loading…</p></Spark>',
].join('\n');

test('a script document\'s local export loads its modules and waits for its components to mount, as the server exporter does',()=>{
 const request=previewRenderRequest({url:'http://127.0.0.1:4100',source:SCRIPTED,format:'png'});
 assert.equal(request.sameOriginOnly,true);
 // The ESM CDN bare names resolve to, and the host a full-URL import names; nothing else.
 assert.deepEqual(request.allowedOrigins,['https://esm.sh','https://cdn.example.com']);
 assert.equal(request.waitForMountsMs,5000);
 assert.equal(request.url,'http://127.0.0.1:4100/?capture=1');
 assert.equal(request.capture,'full');
});

test('a document without a script has no mounts to wait for and no module host to admit',()=>{
 const request=previewRenderRequest({url:'http://127.0.0.1:4100',source:'<h1>Plain</h1>',format:'jpg',page:2});
 assert.equal(request.waitForMountsMs,undefined);
 assert.equal(request.allowedOrigins,undefined);
 assert.deepEqual(request.capture,{slide:2});
});
