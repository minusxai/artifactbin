import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('@/components/ArtifactEditor',()=>({default:(p:{onExit:()=>void})=><button aria-label="Exit edit mode" onClick={p.onExit}>done</button>}));
import ArtifactShell from '../ArtifactShell';
import ArtifactSurface,{type ArtifactSurfaceProps} from '../ArtifactSurface';
const props:ArtifactSurfaceProps={id:'story1',editId:'e1',format:'markup',title:'doc',source:'<p>Hello</p>',content:'',template:null,refs:[],version:1,columns:[],compiledCss:null,theme:null,colorMode:'light',liveEnabled:false};
afterEach(()=>vi.unstubAllGlobals());
it('edits the mounted document in place and retains the same host on exit',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({})));
 render(<ArtifactShell role="owner"><ArtifactSurface {...props}/></ArtifactShell>);
 await waitFor(()=>expect(screen.getByText('Hello')).toBeVisible());
 const host=document.querySelector('[data-artifact-story-host]');
 fireEvent.click(screen.getByLabelText('Open artifact controls')); fireEvent.click(screen.getByLabelText('Edit artifact'));
 fireEvent.click(await screen.findByLabelText('Exit edit mode'));
 expect(document.querySelector('[data-artifact-story-host]')).toBe(host);
 expect(screen.getByText('Hello')).toBeVisible();
});
