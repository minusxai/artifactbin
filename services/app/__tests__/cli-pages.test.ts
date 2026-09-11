import {expect,it} from 'vitest';
import {request,useAppHarness} from './harness';
import {mintToken} from '@/lib/tokens';
import {createArtifact,replaceArtifactFor} from '@/lib/artifacts';
import {GET as versions} from '@/app/api/artifacts/[id]/versions/route';
import {GET as list} from '@/app/api/artifacts/route';
useAppHarness();
it('paginates artifacts with an opaque cursor without duplicates or leaking another account',async()=>{
 const token=await mintToken('pages');const other=await mintToken('other');
 for(let i=0;i<5;i++)await createArtifact(token.id,null,{title:String(i),format:'markup',content:'',source:'<p />',meta:{}});
 await createArtifact(other.id,null,{title:'secret',format:'markup',content:'',source:'<p />',meta:{}});
 const ids:string[]=[];let cursor:string|undefined;
 do{const response=await list(request('/api/artifacts?limit=2'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{token:token.token}));expect(response.status).toBe(200);const page=await response.json();expect(page.artifacts.length).toBeLessThanOrEqual(2);ids.push(...page.artifacts.map((row:{id:string})=>row.id));cursor=page.next_cursor;}while(cursor);
 expect(ids).toHaveLength(5);expect(new Set(ids).size).toBe(5);
 const invalid=await list(request('/api/artifacts?limit=0',{token:token.token}));expect(invalid.status).toBe(400);
});

it('lists the current head in version history and refuses foreign or malformed cursors', async()=>{
 const token=await mintToken('history');
 const artifact=await createArtifact(token.id,null,{title:'head',format:'markup',content:'',source:'<p />',meta:{}});
 const response=await versions(request(`/api/artifacts/${artifact.id}/versions?limit=1`,{token:token.token}),{params:Promise.resolve({id:artifact.id})});
 expect(response.status).toBe(200);const page=await response.json();expect(page.versions.map((v:{version:number})=>v.version)).toEqual([1]);expect(page.next_cursor).toBeNull();
 const bad=await list(request('/api/artifacts?cursor=garbage',{token:token.token}));expect(bad.status).toBe(400);
});

it('version history can begin at a selected historical version',async()=>{
 const token=await mintToken('selected-history');const actor={tokenId:token.id,userId:null};
 const artifact=await createArtifact(token.id,null,{title:'one',format:'markup',content:'',source:'<p />',meta:{}});
 for(const title of ['two','three'])await replaceArtifactFor(actor,artifact.id,{title,format:'markup',content:'',source:`<p>${title}</p>`,meta:{}});
 const response=await versions(request(`/api/artifacts/${artifact.id}/versions?version=2&limit=1`,{token:token.token}),{params:Promise.resolve({id:artifact.id})});
 expect(response.status).toBe(200);const page=await response.json();expect(page.versions.map((v:{version:number})=>v.version)).toEqual([2]);expect(page.next_cursor).toBeTruthy();
 const next=await versions(request(`/api/artifacts/${artifact.id}/versions?version=2&cursor=${encodeURIComponent(page.next_cursor)}`,{token:token.token}),{params:Promise.resolve({id:artifact.id})});expect((await next.json()).versions.map((v:{version:number})=>v.version)).toEqual([1]);
});
