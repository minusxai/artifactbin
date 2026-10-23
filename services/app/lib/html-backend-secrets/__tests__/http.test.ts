import {it,expect,vi,beforeEach} from 'vitest';
const state=vi.hoisted(()=>({owner:'owner',owned:true,names:[] as string[],writes:[] as unknown[]}));
vi.mock('@/lib/accounts',()=>({requestOrSessionActor:async()=>({userId:state.owner,tokenId:null}),refusesCrossSite:()=>false,accountOf:(actor:{userId:string})=>actor.userId}));
vi.mock('@/lib/artifacts',()=>({getOwnedArtifactFor:async()=>state.owned?{}:null}));
vi.mock('@/lib/html-backends',()=>({getHtmlBackendVersion:async()=>({ownerId:'owner',backendId:'backend',pageId:'page',secretBindings:['TOKEN']})}));
vi.mock('@/lib/html-backend-secrets',()=>({backendSecrets:{names:async()=>state.names,put:async(...args:unknown[])=>{state.writes.push(args);state.names=['TOKEN'];},remove:async()=>{state.names=[];}}}));
import {GET,PUT,DELETE} from '@/app/api/my/backends/[id]/[version]/secrets/route';
const context={params:Promise.resolve({id:'backend',version:'v1'})};
beforeEach(()=>{state.owner='owner';state.owned=true;state.names=[];state.writes=[];});
it('configures owner bindings without returning values, supports revocation',async()=>{
 const response=await PUT(new Request('https://example.com/api',{method:'PUT',body:JSON.stringify({name:'TOKEN',value:'private-value'})}),context);
 expect(response.status).toBe(200);expect(await response.json()).toEqual({names:['TOKEN']});expect(state.writes).toEqual([[{ownerId:'owner',backendId:'backend'},'TOKEN','private-value']]);
 expect(await(await GET(new Request('https://example.com/api'),context)).json()).toEqual({names:['TOKEN']});
 expect(await(await DELETE(new Request('https://example.com/api',{method:'DELETE',body:JSON.stringify({name:'TOKEN'})}),context)).json()).toEqual({names:[]});
});
it('refuses other owners, lost ownership and undeclared names before writing',async()=>{
 const request=()=>new Request('https://example.com/api',{method:'PUT',body:JSON.stringify({name:'TOKEN',value:'private-value'})});
 state.owner='other';expect((await PUT(request(),context)).status).toBe(404);
 state.owner='owner';state.owned=false;expect((await PUT(request(),context)).status).toBe(404);
 state.owned=true;expect((await PUT(new Request('https://example.com/api',{method:'PUT',body:JSON.stringify({name:'OTHER',value:'private-value'})}),context)).status).toBe(400);expect(state.writes).toEqual([]);
});
