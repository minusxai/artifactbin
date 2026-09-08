import {render,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {StoryDocumentUpdate,StoryIslandData} from '@/lib/story-runtime/contract';

const mounted=vi.hoisted(()=>({data:null as StoryIslandData|null,updates:[] as StoryDocumentUpdate[]}));
vi.mock('@/lib/story-runtime/mount',()=>({mountStory:vi.fn((options:{data:StoryIslandData})=>{
  mounted.data=options.data;
  return {adopt:(update:StoryDocumentUpdate)=>mounted.updates.push(update),dispose:vi.fn()};
})}));
import ArtifactSurface,{type ArtifactSurfaceProps} from '../ArtifactSurface';

afterEach(()=>{mounted.data=null;mounted.updates=[];vi.unstubAllGlobals();});

it('passes URL values in the initial store payload without immediately re-adopting its flow',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({})));
  const props:ArtifactSurfaceProps={id:'story1',editId:'e1',format:'markup',title:'URL query',source:'<p>{$region}</p>',content:'',template:null,refs:[],version:1,columns:[],compiledCss:null,theme:null,colorMode:'light',liveEnabled:false,search:'?$region=west',
    dataflow:{flow:{values:[{kind:'scalar',name:'region',type:'string',default:'north',start:0,end:0}],queries:[{name:'sales',sql:'select $region',params:['region'],refs:[],start:0,end:0}]}}};
  render(<ArtifactSurface {...props}/>);
  await waitFor(()=>expect(mounted.data?.dataflow?.values).toEqual({region:'west'}));
  expect(mounted.updates).toHaveLength(1);
  expect(mounted.updates[0].dataflow).toBeUndefined();
});
