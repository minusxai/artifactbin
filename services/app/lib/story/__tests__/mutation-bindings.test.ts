import {describe,expect,it} from 'vitest';
import {compiledOf} from '@/test/helpers/compiled';
import {bindMutationRequest} from '../mutation-request';

describe('saved mutation bindings',()=>{
 it('saves normalized defaults and trusted platform values even when SQL does not reference them',async()=>{
  const flow=await compiledOf('<Import name="items" src="ref:abc123" /><Value name="n" type="number" default={7} /><Mutation name="add">{`insert into items.rows(n) values ($n)`}</Mutation>',{abc123:[{name:'n',type:'number'}]});
  const platform={userId:'user-one',now:'2026-09-28T00:00:00.000Z',tz:'UTC'};
  const bound=bindMutationRequest(flow,flow.mutations[0]!,{mutation:'add',args:{}},platform);
  expect(bound).toMatchObject({ok:true,bindings:{values:{n:7,'_me.id':'user-one',_now:platform.now,_tz:'UTC'},types:{n:'number','_me.id':'user',_now:'timestamp',_tz:'string'},...platform}});
  const cleared=bindMutationRequest(flow,flow.mutations[0]!,{mutation:'add',args:{n:''}},platform);
  expect(cleared).toMatchObject({ok:true,bindings:{values:{n:null}}});
 });
});
