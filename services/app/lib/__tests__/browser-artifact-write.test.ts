import {createDocumentGraph,graphSource} from '../story/document-graph';
import {applyGraphPatch} from '../story/document-graph-patch';
import {afterEach,expect,it,vi} from 'vitest';
import {writeBrowserArtifact,restoreBrowserArtifact} from '../browser-artifact-write';
import {createHttpBackend} from '../artifact-backend/http';
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
it('refuses, with the server’s reason, to restore a version written for the previous query engine that needs converting by hand',async()=>{
 const calls:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  calls.push(url);
  if(url.endsWith('/versions/1'))return Response.json({format:'markup',markup:'<p>old</p>',meta:{},previous_engine:'Version 1 was written for the previous query engine and needs converting by hand, so it cannot be restored as it stands.'});
  return Response.json({format:'markup',version:3,state:'a'.repeat(64),edit_id:'head',document:createDocumentGraph('<p>now</p>',3)});
 }));
 await expect(restoreBrowserArtifact(createHttpBackend('abc123'),1)).rejects.toThrow(/previous query engine.*cannot be restored as it stands/);
 expect(calls.some(url=>url.endsWith('/edits'))).toBe(false);
});
