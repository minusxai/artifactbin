import {createDocumentGraph,graphSource} from '../../document/document-graph';
import {afterEach,expect,it,vi} from 'vitest';
import {writeBrowserArtifact,restoreBrowserArtifact} from '../browser-artifact-write';
import {createHttpBackend} from '../http';
afterEach(()=>vi.unstubAllGlobals());
it('does not replace a newer source when a mixed edit was based on an older edit id',async()=>{
 const request=vi.fn(async()=>Response.json({edit_id:'newer',version:2,state:'b'.repeat(64),markup:'<p>Remote</p>'}));vi.stubGlobal('fetch',request);
 const response=await writeBrowserArtifact('abc123',{source:'<p>Local</p>',title:'Local'},'older');expect(response.status).toBe(409);expect(request).toHaveBeenCalledTimes(1);
});
it('refuses unsupported document fields instead of silently discarding them',async()=>{
 const fetcher=vi.fn(async()=>Response.json({format:'markup',document:createDocumentGraph('<p id="a">X</p>',1),edit_id:'e',version:1,state:'a'.repeat(64)}));vi.stubGlobal('fetch',fetcher);
 const result=await writeBrowserArtifact('abc123',{access:'readwrite'});
 expect(result.status).toBe(400);expect(fetcher).toHaveBeenCalledTimes(1);
});
it('restores document history over a native format through a validated whole JSONB operation',async()=>{
 const calls:Array<{url:string;body:Record<string,any>}>=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  calls.push({url,body:JSON.parse(String(init?.body??'{}'))});
  if(url.endsWith('/versions/1'))return Response.json({format:'markup',markup:'<h1 id="old">Archived</h1>',title:'Old title',meta:{theme:'organic'}});
  return Response.json({format:'dataset',version:3,state:'a'.repeat(64),edit_id:'head',title:'New title'});
 }));
 await restoreBrowserArtifact(createHttpBackend('abc123'),1);
 const commit=calls.at(-1)!;expect(commit.url).toBe('/api/my/artifacts/abc123/edits');
 expect(commit.body.document_update).toMatchObject({whole:true,patch:{baseVersion:3},metadata:{title:'Old title',theme:'organic'}});
 expect(graphSource(commit.body.document_update.replacement)).toContain('Archived');
});
it('keeps native-format history on its conditional restore endpoint',async()=>{
 const calls:Array<{url:string;body:Record<string,any>}>=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  calls.push({url,body:JSON.parse(String(init?.body??'{}'))});
  if(url.endsWith('/versions/1'))return Response.json({format:'image',markup:null,meta:{}});
  return Response.json({format:'markup',version:3,state:'a'.repeat(64),edit_id:'head'});
 }));
 await restoreBrowserArtifact(createHttpBackend('abc123'),1);
 expect(calls.at(-1)).toEqual({url:'/api/my/artifacts/abc123/revert',body:{version:1,expectedVersion:3,expectedState:'a'.repeat(64)}});
});
it('publishes native social preview metadata once with the observed version and state',async()=>{
 const html='<!doctype html><html><head></head><body>Page</body></html>';
 const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>Response.json(init?.method==='PUT'?{version:5}:{format:'html',html,edit_id:'e4',version:4,state:'c'.repeat(64)}));vi.stubGlobal('fetch',fetcher);
 const saved=await writeBrowserArtifact('abc123',{source:html},'e4');expect(saved.status).toBe(200);
 expect(fetcher.mock.calls[1][0]).toBe('/api/my/artifacts/abc123');
 expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({html,expectedVersion:4,expectedState:'c'.repeat(64)});
});
it('reports the latest native source after a publication race without retrying the write',async()=>{
 let reads=0;const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
  if(init?.method==='PUT')return Response.json({error:'conflict'},{status:409});
  reads++;return Response.json({format:'html',html:reads===1?'original':'remote',edit_id:reads===1?'e4':'e5',version:reads===1?4:5,state:'c'.repeat(64)});
 });vi.stubGlobal('fetch',fetcher);
 const saved=await writeBrowserArtifact('abc123',{source:'local'},'e4');expect(saved.status).toBe(409);
 expect(await saved.json()).toMatchObject({source:'remote',edit_id:'e5',version:5});
 expect(fetcher.mock.calls.filter(([,init])=>init?.method==='PUT')).toHaveLength(1);
});
