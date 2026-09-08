import {render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import ArtifactSurface,{type ArtifactSurfaceProps} from '../ArtifactSurface';
import {storyBodyFor} from '@/lib/story/body';
let stream:FakeEventSource|null=null;
class FakeEventSource {onmessage:((event:MessageEvent)=>void)|null=null;onerror:null=null;constructor(){stream=this;}addEventListener(){}removeEventListener(){}close(){}emit(value:unknown){this.onmessage?.({data:JSON.stringify(value)} as MessageEvent);}}
const props:ArtifactSurfaceProps={id:'story1',editId:'e1',format:'markup',title:'doc',source:'<p>First</p>',content:'',template:null,refs:[],version:1,columns:[],compiledCss:null,theme:null,colorMode:'light',liveEnabled:true};
afterEach(()=>{vi.unstubAllGlobals();stream=null;});
it('adopts a live version in the existing top-level runtime host',async()=>{
 const split=storyBodyFor('<p>Second</p>')!;
 const next={editId:'e2',version:2,format:'markup',title:'doc',source:'<p>Second</p>',content:null,theme:null,colorMode:'light',template:null,nodes:split.body};
 vi.stubGlobal('EventSource',FakeEventSource); vi.stubGlobal('fetch',vi.fn(async()=>Response.json(next)));
 render(<ArtifactSurface {...props}/>); await waitFor(()=>expect(screen.getByText('First')).toBeVisible());
 const host=document.querySelector('[data-artifact-story-host]'); await new Promise(resolve=>setTimeout(resolve,20));
 stream!.emit({editId:'e2',version:2,by:null});
 await waitFor(()=>expect(screen.getByText('Second')).toBeVisible());
 expect(document.querySelector('[data-artifact-story-host]')).toBe(host);
});
