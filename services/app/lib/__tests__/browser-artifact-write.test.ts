import {afterEach,expect,it,vi} from 'vitest';
import {writeBrowserArtifact} from '../browser-artifact-write';
afterEach(()=>vi.unstubAllGlobals());
it('uses conditional metadata and conditional full replacement for a mixed edit',async()=>{
 const calls:Array<{url:string;init?:RequestInit}>=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{calls.push({url,init});return Response.json({id:'abc123',edit_id:'edit1',version:1,state:'a'.repeat(64),markup:'<p>Original</p>'});}));
 await writeBrowserArtifact('abc123',{title:'New',annotationOps:[]});
 expect(calls[1].init?.method).toBe('PATCH');expect(JSON.parse(String(calls[1].init?.body))).toEqual({title:'New',expectedState:'a'.repeat(64)});
 await writeBrowserArtifact('abc123',{title:'New',source:'<p>Changed</p>'},'edit1');
 expect(calls[3].init?.method).toBe('PUT');expect(JSON.parse(String(calls[3].init?.body))).toEqual({title:'New',markup:'<p>Changed</p>',expectedVersion:1,expectedState:'a'.repeat(64)});
});
it('does not replace a newer source when a mixed edit was based on an older edit id',async()=>{
 const request=vi.fn(async()=>Response.json({edit_id:'newer',version:2,state:'b'.repeat(64),markup:'<p>Remote</p>'}));vi.stubGlobal('fetch',request);
 const response=await writeBrowserArtifact('abc123',{source:'<p>Local</p>',title:'Local'},'older');expect(response.status).toBe(409);expect(request).toHaveBeenCalledTimes(1);
});
