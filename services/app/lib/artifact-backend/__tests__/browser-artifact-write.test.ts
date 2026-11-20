import {afterEach,expect,it,vi} from 'vitest';
import {writeBrowserArtifact} from '../browser-artifact-write';
import {stubFetch} from '@/test/helpers/fetch-stub';
afterEach(()=>vi.unstubAllGlobals());
it('does not replace a newer source when a mixed edit was based on an older edit id',async()=>{
 const request=vi.fn(async()=>Response.json({edit_id:'newer',version:2,state:'b'.repeat(64),format:'html',html:'<p>Remote</p>'}));vi.stubGlobal('fetch',request);
 const response=await writeBrowserArtifact('abc123',{source:'<p>Local</p>',title:'Local'},'older');expect(response.status).toBe(409);expect(request).toHaveBeenCalledTimes(1);
});
it('publishes native social preview metadata once with the observed version and state',async()=>{
 const html='<!doctype html><html><head></head><body>Page</body></html>';
 const fetcher=stubFetch({'PUT *':{version:5}},{fallback:()=>Response.json({format:'html',html,edit_id:'e4',version:4,state:'c'.repeat(64)})});
 const saved=await writeBrowserArtifact('abc123',{source:html},'e4');expect(saved.status).toBe(200);
 expect(fetcher.mock.calls[1][0]).toBe('/api/my/artifacts/abc123');
 expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({html,expectedVersion:4,expectedState:'c'.repeat(64)});
});
it('reports the latest native source after a publication race without retrying the write',async()=>{
 let reads=0;const fetcher=stubFetch({'PUT *':()=>Response.json({error:'conflict'},{status:409})},{
  fallback:()=>{reads++;return Response.json({format:'html',html:reads===1?'original':'remote',edit_id:reads===1?'e4':'e5',version:reads===1?4:5,state:'c'.repeat(64)});},
 });
 const saved=await writeBrowserArtifact('abc123',{source:'local'},'e4');expect(saved.status).toBe(409);
 expect(await saved.json()).toMatchObject({source:'remote',edit_id:'e5',version:5});
 expect(fetcher.mock.calls.filter(([,init])=>init?.method==='PUT')).toHaveLength(1);
});
