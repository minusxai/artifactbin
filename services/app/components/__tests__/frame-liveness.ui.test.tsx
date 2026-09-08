import {render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import ArtifactSurface,{type ArtifactSurfaceProps} from '../ArtifactSurface';
const props:ArtifactSurfaceProps={id:'story1',editId:'e1',format:'markup',title:'doc',source:'<p>Hello</p>',content:'',template:null,refs:[],version:1,columns:[],compiledCss:null,theme:null,colorMode:'light',liveEnabled:false};
afterEach(()=>vi.unstubAllGlobals());
it('keeps the direct runtime host across visibility and bfcache lifecycle events',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({})));
 render(<ArtifactSurface {...props}/>);
 await waitFor(()=>expect(screen.getByText('Hello')).toBeVisible());
 const host=document.querySelector('[data-artifact-story-host]');
 document.dispatchEvent(new Event('visibilitychange'));
 window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
 expect(document.querySelector('[data-artifact-story-host]')).toBe(host);
});
