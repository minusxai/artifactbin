import {render,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import ArtifactSurface,{type ArtifactSurfaceProps} from '../ArtifactSurface';
import type {StoryIslandDataflow} from '@/lib/story-runtime/contract';
const dataflow:StoryIslandDataflow={flow:{values:[{kind:'scalar',name:'region',type:'string',default:'west',start:0,end:0}],queries:[]}};
const props:ArtifactSurfaceProps={id:'story1',editId:'e1',format:'markup',title:'doc',source:'<p>Hello</p>',content:'',template:null,refs:[],version:1,columns:[],compiledCss:null,theme:null,colorMode:'light',dataflow,liveEnabled:false};
afterEach(()=>{vi.unstubAllGlobals();window.history.replaceState(null,'','/');});
it('keeps the page selection on the direct runtime address without an iframe navigation',async()=>{
 window.history.replaceState(null,'','/a/story1?keep=1#part'); vi.stubGlobal('fetch',vi.fn(async()=>Response.json({})));
 render(<ArtifactSurface {...props} search="?keep=1&$region=east"/>); await waitFor(()=>expect(document.querySelector('[data-artifact-story-host]')).toBeTruthy());
 expect(window.location.href).toContain('?keep=1#part');
 expect(document.querySelector('iframe[title="artifact"]')).toBeNull();
});
