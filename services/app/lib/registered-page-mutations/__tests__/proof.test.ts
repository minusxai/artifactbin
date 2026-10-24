import {it,expect} from 'vitest';
import type {Queryable} from '@artifactbin/contracts';
import {attestRegisteredHtmlMutation,verifyRegisteredHtmlMutation} from '@/lib/artifacts/registered-html-mutation';
it('registered HTML proof is process-local and binds exact page/edit with a transaction recheck',async()=>{
 const calls:Queryable[]=[],tx={} as Queryable,proof=attestRegisteredHtmlMutation('page','edit',async transaction=>{calls.push(transaction);});
 expect(await verifyRegisteredHtmlMutation({id:'page',editId:'edit',registeredHtml:proof},tx)).toBe(true);expect(calls).toEqual([tx]);
 for(const document of [{id:'page',editId:'changed',registeredHtml:proof},{id:'other',editId:'edit',registeredHtml:proof},{id:'page',editId:'edit',registeredHtml:JSON.parse(JSON.stringify(proof))}])expect(await verifyRegisteredHtmlMutation(document,tx)).toBe(false);
 const revoked=attestRegisteredHtmlMutation('page','edit',async()=>{throw Error('source_changed');});await expect(verifyRegisteredHtmlMutation({id:'page',editId:'edit',registeredHtml:revoked},tx)).rejects.toThrow('source_changed');
});
it('original grant context preserves markup and refuses ordinary or serialized-proof HTML',async()=>{
 const {grantContext}=await import('@/lib/artifacts');
 const actor={userId:null,tokenId:'creator',email:null,documentEditor:false};
 const base={id:'page',edit_id:'edit',format:'markup',user_id:null,token_id:'creator',group_id:null,visibility:'private',meta:{}};
 const dataset={id:'dataset',user_id:null,token_id:'creator',group_id:null} as unknown as import('@/lib/artifacts').ArtifactRow;
 const tx=(row:object)=>({query:async()=>({rows:[row]})}) as unknown as Queryable;
 expect((await grantContext(dataset,actor,{id:'page',editId:'edit'},tx(base))).artifact?.id).toBe('page');
 const html={...base,format:'html'};
 await expect(grantContext(dataset,actor,{id:'page',editId:'edit'},tx(html))).rejects.toThrow('Document access or action changed');
 await expect(grantContext(dataset,actor,{id:'page',editId:'edit',registeredHtml:{}},tx(html))).rejects.toThrow('Document access or action changed');
 let checks=0;const proof=attestRegisteredHtmlMutation('page','edit',async()=>{checks++;});
 expect((await grantContext(dataset,actor,{id:'page',editId:'edit',registeredHtml:proof},tx(html))).artifact?.id).toBe('page');expect(checks).toBe(1);
});
