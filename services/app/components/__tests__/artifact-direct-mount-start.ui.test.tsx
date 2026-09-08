import {render,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {StoryDocumentUpdate,StoryIslandData} from '@/lib/story-runtime/contract';

const mounted=vi.hoisted(()=>({data:null as StoryIslandData|null,updates:[] as StoryDocumentUpdate[]}));
vi.mock('@/lib/story-runtime/mount',()=>({mountStory:vi.fn((options:{data:StoryIslandData})=>{
  mounted.data=options.data;
  return {adopt:(update:StoryDocumentUpdate)=>mounted.updates.push(update),dispose:vi.fn()};
})}));
import ArtifactSurface,{type ArtifactSurfaceProps} from '../ArtifactSurface';
import {STORY_HELLO_MESSAGE} from '@/lib/story-runtime/contract';

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

it('does not run framed hello retries against the same-window direct runtime',async()=>{
  const post=vi.spyOn(window,'postMessage');
  const direct:ArtifactSurfaceProps={id:'story1',editId:'e1',format:'markup',title:'Direct',source:'<p>direct</p>',content:'',template:null,refs:[],version:1,columns:[],compiledCss:null,theme:null,colorMode:'light',liveEnabled:false};
  render(<ArtifactSurface {...direct}/>);
  await new Promise(resolve=>setTimeout(resolve,600));
  expect(post.mock.calls.filter(([message])=>message===STORY_HELLO_MESSAGE)).toHaveLength(0);
});
