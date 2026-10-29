import {it,expect,vi} from 'vitest';
import { ANONYMOUS_ACTOR } from '@/lib/accounts';
import {planHtmlClone} from '../clone';
it('copies an explicit immutable code allowlist without credentials, owner authority or state',async()=>{
 const record={backendId:'b',version:'v',pageId:'p',name:'db',source:'code',compiled:'compiled',typeDefs:'type Query { ok: Boolean }',ownerId:'original',secretBindings:['API_KEY'],value:{private:'hidden'}};
 const result=await planHtmlClone(ANONYMOUS_ACTOR,'p',[{kind:'backend',name:'db',backendId:'b',version:'v'}],{backend:async()=>record,authorizeDataset:vi.fn()});
 expect(result).toEqual({htmlBackends:[{name:'db',source:'code',compiled:'compiled',typeDefs:'type Query { ok: Boolean }',secretBindings:['API_KEY']}],htmlDatasets:[]});
});
it('retains dataset bindings only after checking the receiving principal and preserves pinning',async()=>{
 const binding={kind:'dataset' as const,name:'data',datasetId:'dataset',mode:'pinned' as const,revision:'2'};
 const authorizeDataset=vi.fn(async()=>{});
 expect((await planHtmlClone(ANONYMOUS_ACTOR,'p',[binding],{backend:vi.fn(),authorizeDataset})).htmlDatasets).toEqual([binding]);expect(authorizeDataset).toHaveBeenCalledWith(ANONYMOUS_ACTOR,binding);
 await expect(planHtmlClone(ANONYMOUS_ACTOR,'p',[binding],{backend:vi.fn(),authorizeDataset:async()=>{throw Error('forbidden');}})).rejects.toThrow('forbidden');
});
it('rejects missing and foreign backend snapshots instead of copying their authority',async()=>{
 const binding={kind:'backend' as const,name:'db',backendId:'b',version:'v'};
 await expect(planHtmlClone(ANONYMOUS_ACTOR,'p',[binding],{backend:async()=>null,authorizeDataset:vi.fn()})).rejects.toThrow('backend_link_mismatch');
});
