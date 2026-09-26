import {it,expect,vi} from 'vitest';
import {observeFixtureWrite} from '../lib/fixture-http.mjs';
it('reads the fixture head for conditional replacement without replacing an explicit stale guard',async()=>{
 const raw=vi.fn(async(_url,init)=>init?.method==='GET'?Response.json({version:7,state:'fresh'}):Response.json({ok:true}));
 await observeFixtureWrite(raw,'https://example.test/api/artifacts/abc123',{method:'PUT',headers:{Authorization:'Bearer test'},body:JSON.stringify({markup:'<h1>next</h1>',expectedVersion:2})});
 expect(raw).toHaveBeenCalledTimes(2);
 expect(JSON.parse(raw.mock.calls[1][1].body)).toEqual({markup:'<h1>next</h1>',expectedVersion:2,expectedState:'fresh'});
 expect(raw.mock.calls[0][1].headers.Authorization).toBe('Bearer test');
});
it('does not intercept reads, edits, or already guarded writes',async()=>{
 const raw=vi.fn(async()=>Response.json({ok:true}));
 for(const [url,init] of [['https://example.test/api/artifacts/abc123',{}],['https://example.test/api/artifacts/abc123/edits',{method:'POST',body:'{}'}],['https://example.test/api/artifacts/abc123',{method:'PUT',body:JSON.stringify({expectedVersion:2,expectedState:'stale'})}]])await observeFixtureWrite(raw,url,init);
 expect(raw).toHaveBeenCalledTimes(3);
});
it('prepares document fixtures with the real authoring compiler and submits only JSONB operations',async()=>{
 const {createDocumentGraph}=await import('../../services/app/lib/story/document-graph');
 const source='<p id="a">Before</p>',document=createDocumentGraph(source,1);
 const raw=vi.fn(async(_url,init)=>init?.method==='GET'?Response.json({id:'abc123',format:'markup',version:1,edit_id:'before',markup:source,document}):Response.json({ok:true}));
 await observeFixtureWrite(raw,'https://example.test/api/artifacts/abc123',{method:'PUT',body:JSON.stringify({markup:'<p id="a">After</p>'})});
 const [url,init]=raw.mock.calls.at(-1);expect(url).toBe('https://example.test/api/artifacts/abc123/edits');expect(init.method).toBe('POST');
 const body=JSON.parse(init.body);expect(body.document_update.whole).toBe(true);expect(body).not.toHaveProperty('markup');expect(body).not.toHaveProperty('source');
});
