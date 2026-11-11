import {it,expect,vi} from 'vitest';
import { ANONYMOUS_ACTOR } from '@/lib/accounts';
import {planHtmlClone} from '../clone';
it('retains dataset bindings only after checking the receiving principal and preserves pinning',async()=>{
 const binding={kind:'dataset' as const,name:'data',datasetId:'dataset',mode:'pinned' as const,revision:'2'};
 const authorizeDataset=vi.fn(async()=>{});
 expect((await planHtmlClone(ANONYMOUS_ACTOR,[binding],{authorizeDataset})).htmlDatasets).toEqual([binding]);
 // A stored link's retired keys (the old per-link api) are not copied into the fork.
 const stored={...binding,api:'legacy'} as typeof binding;
 expect((await planHtmlClone(ANONYMOUS_ACTOR,[stored],{authorizeDataset})).htmlDatasets).toEqual([binding]);expect(authorizeDataset).toHaveBeenCalledWith(ANONYMOUS_ACTOR,binding);
 await expect(planHtmlClone(ANONYMOUS_ACTOR,[binding],{authorizeDataset:async()=>{throw Error('forbidden');}})).rejects.toThrow('forbidden');
});
it('copies nothing but dataset links: a stored link of another kind is dropped, never authorized',async()=>{
 const authorizeDataset=vi.fn(async()=>{});
 const stale={kind:'backend',name:'db',backendId:'b',version:'v'} as never;
 expect(await planHtmlClone(ANONYMOUS_ACTOR,[stale],{authorizeDataset})).toEqual({htmlDatasets:[]});
 expect(authorizeDataset).not.toHaveBeenCalled();
});
