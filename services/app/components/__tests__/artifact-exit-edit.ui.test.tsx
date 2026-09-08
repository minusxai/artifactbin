import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('@/components/ArtifactEditor',()=>({default:(p:{onExit:()=>void})=><button aria-label="Exit edit mode" onClick={p.onExit}>done</button>}));
import ArtifactShell from '../ArtifactShell';
import ArtifactSurface,{type ArtifactSurfaceProps} from '../ArtifactSurface';
import {RIGHT_RAIL_W} from '@/lib/story/edit-bar';
const props:ArtifactSurfaceProps={id:'story1',editId:'e1',format:'markup',title:'doc',source:'<p>Hello</p>',content:'',template:null,refs:[],version:1,columns:[],compiledCss:null,theme:null,colorMode:'light',liveEnabled:false};
afterEach(()=>vi.unstubAllGlobals());
it('reserves document space for the desktop comment rail and restores it on close',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({annotations:[]})));
 vi.stubGlobal('innerWidth',1200);
 render(<ArtifactShell role="owner"><ArtifactSurface {...props}/></ArtifactShell>);
 await screen.findByText('Hello');
 fireEvent.click(screen.getByLabelText('Toggle comments'));
 expect(screen.getByLabelText('Artifact viewport')).toHaveStyle({paddingRight:`${RIGHT_RAIL_W}px`});
 fireEvent.click(await screen.findByLabelText('Close comments'));
 expect(screen.getByLabelText('Artifact viewport')).toHaveStyle({paddingRight:'0px'});
});
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
