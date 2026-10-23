import {expect,it} from 'vitest';
import {changedHtmlSharedRevisions,htmlLiveLinks} from '../live';
it('reconnect refetches all committed revisions; duplicate wakeups do not replay or invalidate again',()=>{
 const current=[{name:'counter',revision:'backend:b1:7'},{name:'rows',revision:'dataset:d1:2:e2:true'}];
 expect(changedHtmlSharedRevisions(new Map(),current)).toEqual(current);
 const previous=new Map(current.map(mark=>[mark.name,mark.revision]));
 expect(changedHtmlSharedRevisions(previous,current)).toEqual([]);
 expect(changedHtmlSharedRevisions(previous,[{name:'counter',revision:'backend:b1:9'},current[1]!])).toEqual([{name:'counter',revision:'backend:b1:9'}]);
 // Reconnecting never trusts an in-memory mark from the lost connection.
 expect(changedHtmlSharedRevisions(new Map(),current)).toEqual(current);
});
it('pinned datasets never become live subscriptions',()=>{
 expect(htmlLiveLinks({htmlLinks:[{kind:'dataset',name:'old',datasetId:'d1',mode:'pinned',revision:'1'},{kind:'dataset',name:'live',datasetId:'d2',mode:'live'},{kind:'backend',name:'counter',backendId:'b1',version:'v1'}]}).map(link=>link.name)).toEqual(['live','counter']);
});
