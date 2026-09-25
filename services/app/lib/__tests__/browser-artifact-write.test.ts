import {createDocumentGraph,graphSource} from '../story/document-graph';
import {applyGraphPatch} from '../story/document-graph-patch';
import {afterEach,expect,it,vi} from 'vitest';
import {writeBrowserArtifact} from '../browser-artifact-write';
afterEach(()=>vi.unstubAllGlobals());
it('prepares metadata and mixed edits locally for the same atomic JSONB endpoint',async()=>{
 const document=createDocumentGraph('<p id="a">Original</p>',1);
 const calls:Array<{url:string;init?:RequestInit}>=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{calls.push({url,init});return Response.json({id:'abc123',edit_id:'edit1',version:1,state:'a'.repeat(64),markup:'<p id="a">Original</p>',document});}));
 await writeBrowserArtifact('abc123',{title:'New',annotationOps:[]});
 expect(calls[1].url).toBe('/api/my/artifacts/abc123/edits');expect(calls[1].init?.method).toBe('POST');expect(JSON.parse(String(calls[1].init?.body)).document_update.metadata).toEqual({title:'New'});
 await writeBrowserArtifact('abc123',{title:'New',source:'<p id="a">Changed</p>'},'edit1');
 expect(calls[3].init?.method).toBe('POST');const body=JSON.parse(String(calls[3].init?.body));expect(body.edit_id).toBe('edit1');expect(body.document_update.metadata).toEqual({title:'New'});expect(graphSource(applyGraphPatch(document,1,body.document_update.patch)!)).toBe('<p id="a">Changed</p>');
});
it('does not replace a newer source when a mixed edit was based on an older edit id',async()=>{
 const request=vi.fn(async()=>Response.json({edit_id:'newer',version:2,state:'b'.repeat(64),markup:'<p>Remote</p>'}));vi.stubGlobal('fetch',request);
 const response=await writeBrowserArtifact('abc123',{source:'<p>Local</p>',title:'Local'},'older');expect(response.status).toBe(409);expect(request).toHaveBeenCalledTimes(1);
});
