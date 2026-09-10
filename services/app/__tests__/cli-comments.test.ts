import {expect,it} from 'vitest';
import {useAppHarness,request} from './harness';
import {mintToken} from '@/lib/tokens';
import {createArtifact,getArtifactFor} from '@/lib/artifacts';
import * as route from '@/app/api/artifacts/[id]/annotations/route';
useAppHarness();
it('creates agent comments by unambiguous quote without editing the document, and refuses ambiguous quotes',async()=>{
 const token=await mintToken('comments');const actor={tokenId:token.id,userId:null};
 const row=await createArtifact(token.id,null,{title:'comments',format:'markup',content:'',source:'<div id="container"><p id="first">One unique sentence.</p><p id="second">Repeated</p><p id="third">Repeated</p></div>',meta:{}});
 const post=(route as unknown as {POST:typeof route.GET}).POST;expect(post).toBeTypeOf('function');
 const call=(body:Record<string,unknown>)=>post(request(`/api/artifacts/${row.id}/annotations`,{method:'POST',token:token.token,json:body}),{params:Promise.resolve({id:row.id})});
 const made=await call({quote:'unique sentence',body:'Clarify this'});expect(made.status).toBe(201);expect((await made.json()).anchor.nodeId).toBe('first');
 const after=await getArtifactFor(actor,row.id);expect(after?.source).toBe(row.source);expect(after?.version).toBe(row.version);
 const ambiguous=await call({quote:'Repeated',body:'Which one?'});expect(ambiguous.status).toBe(400);expect((await ambiguous.json()).error).toBe('ambiguous_quote');
 const outsider=await mintToken('outsider');const denied=await post(request(`/api/artifacts/${row.id}/annotations`,{method:'POST',token:outsider.token,json:{node_id:'first',body:'No'}}),{params:Promise.resolve({id:row.id})});expect(denied.status).toBe(404);
});
it('pages comment threads in creation order with a bounded database read',async()=>{
 const token=await mintToken('comment-pages');
 const row=await createArtifact(token.id,null,{title:'pages',format:'markup',content:'',source:'<p id="paragraph">Text</p>',meta:{}});
 const ctx={params:Promise.resolve({id:row.id})};
 for(let i=0;i<3;i++)expect((await route.POST(request(`/api/artifacts/${row.id}/annotations`,{method:'POST',token:token.token,json:{node_id:'paragraph',body:String(i)}}),ctx)).status).toBe(201);
 let cursor:string|undefined;const bodies:string[]=[];
 do{
  const response=await route.GET(request(`/api/artifacts/${row.id}/annotations?limit=1`+(cursor?'&cursor='+cursor:''),{token:token.token}),ctx);
  expect(response.status).toBe(200);const page=await response.json();expect(page.annotations).toHaveLength(1);bodies.push(page.annotations[0].thread[0].body);cursor=page.next_cursor;
 }while(cursor);
 expect(bodies).toEqual(['0','1','2']);
});
