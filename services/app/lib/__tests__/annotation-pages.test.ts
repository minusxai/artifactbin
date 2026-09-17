import {it,expect,vi,afterEach} from 'vitest';
import {readAnnotationPages} from '../annotation-pages';
afterEach(()=>vi.unstubAllGlobals());
it('browser annotation reads include every page and preserve filters while deduplicating roots',async()=>{
 const urls:string[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string)=>{urls.push(url);return Response.json(url.includes('cursor=')?{annotations:[{id:'first',body:'updated'},{id:'second'}],next_cursor:null}:{annotations:[{id:'first'}],next_cursor:'opaque_cursor'});}));
 const annotations=await readAnnotationPages('/api/my/artifacts/abc123/annotations?status=resolved');
 expect(annotations).toEqual([{id:'first',body:'updated'},{id:'second'}]);expect(urls).toEqual(['/api/my/artifacts/abc123/annotations?status=resolved','/api/my/artifacts/abc123/annotations?status=resolved&cursor=opaque_cursor']);
});
it('a failed page never replaces the complete list with a partial result; repeated cursors stop',async()=>{
 let calls=0;vi.stubGlobal('fetch',vi.fn(async()=>++calls===1?Response.json({annotations:[{id:'first'}],next_cursor:'next'}):new Response(null,{status:403})));
 await expect(readAnnotationPages('/annotations')).rejects.toThrow(/403/);
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({annotations:[],next_cursor:'same'})));
 await expect(readAnnotationPages('/annotations')).rejects.toThrow(/cursor/);
});
