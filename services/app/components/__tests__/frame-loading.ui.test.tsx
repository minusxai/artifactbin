import {render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import ArtifactSurface,{type ArtifactSurfaceProps} from '../ArtifactSurface';
const props:ArtifactSurfaceProps={id:'story1',editId:'e1',format:'markup',title:'doc',source:'<p>direct prose</p>',content:'',template:null,refs:[],version:1,columns:[],compiledCss:null,theme:null,colorMode:'dark',liveEnabled:false};
afterEach(()=>vi.unstubAllGlobals());
it('replaces the transient loader with top-level prose on the document ground',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({})));
 render(<ArtifactSurface {...props}/>);
 await waitFor(()=>expect(screen.getByText('direct prose')).toBeVisible());
 await waitFor(()=>expect(screen.queryByLabelText('Loading document')).toBeNull());
 expect(screen.getByLabelText('Artifact viewport').style.background).toBeTruthy();
});
