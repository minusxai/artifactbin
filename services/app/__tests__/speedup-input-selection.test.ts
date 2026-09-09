import {expect,it} from 'vitest';
import {useAppHarness} from './harness';
import {runDocumentDataflow} from '@/lib/artifacts';

useAppHarness();
const source='<Helmet><Value name="local" type="table" value={[{n:9}]}/><Query name="first">{`select * from ref_ABC123`}</Query><Query name="top">{`select * from first`}</Query><Query name="unrelated">{`select * from ref_DEF456`}</Query></Helmet><p>Selection</p>';

it('partial query execution resolves only the transitive input closure',async()=>{
  const resolved:string[]=[];
  const state=await runDocumentDataflow(source,async id=>{resolved.push(id);return {rows:[{n:5}],columns:[{name:'n',type:'number'}]};},{only:['top']});
  expect(resolved).toEqual(['ABC123']);
  expect(state!.state.tables.top.rows).toEqual([{n:5}]);
  expect(state!.state.tables.local.rows).toEqual([{n:9}]);
});

it('empty selection performs no dataset reads while preserving local tables',async()=>{
  const resolved:string[]=[];
  const state=await runDocumentDataflow(source,async id=>{resolved.push(id);return null;},{only:[]});
  expect(resolved).toEqual([]);expect(state!.state.tables.local.rows).toEqual([{n:9}]);
});

it('paged query keeps upstream input but excludes unrelated dataset resolution',async()=>{
  const resolved:string[]=[];
  const state=await runDocumentDataflow(source,async id=>{resolved.push(id);return {rows:[{n:5},{n:7}],columns:[{name:'n',type:'number'}]};},{page:{name:'top',offset:1,limit:1}});
  expect(resolved).toEqual(['ABC123']);
  expect(state!.state.tables.top.rows).toEqual([{n:7}]);
});
