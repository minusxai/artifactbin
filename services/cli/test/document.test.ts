import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,writeDocument} from '../src/document';

test('fence parsing preserves authored bytes and distinguishes omission from null',()=>{
 const body='<Helmet><Query name="rows" source="ref:abc123">{`select * from public.rows`}</Query></Helmet>\n{/* keep */}<p> Text  </p>\n';
 const doc=parseDocument(`---\nid: abc123\ntitle: null\nhead_version: 4\nstate: ${'a'.repeat(64)}\n---\n${body}`);
 assert.equal(doc.body,body);assert.equal(doc.metadata.title,null);assert.ok(!('theme' in doc.metadata));
 const roundtrip=parseDocument(writeDocument(doc));assert.deepEqual(roundtrip,doc);
 assert.equal(parseDocument(body).body,body);
});
test('refuses ambiguous or unsupported fence state',()=>{
 for(const fence of ['id: abc123\nid: def456','visibility: null','link: owner','version: 0','head_version: "2"','id: not-an-id','token: secret','title: &x hi\ntheme: *x','title: !!js/function x'])assert.throws(()=>parseDocument(`---\n${fence}\n---\n<p />`),Error,fence);
 assert.throws(()=>parseDocument('---\ntitle: hi\n<p />'),/fence/);
});
