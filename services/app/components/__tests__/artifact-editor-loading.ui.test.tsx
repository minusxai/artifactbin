import {fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('@/lib/dynamic',()=>({default:(_load:unknown,options:{loading:()=>unknown})=>options.loading}));
import ArtifactShell from '../ArtifactShell';
import ArtifactSurface,{type ArtifactSurfaceProps} from '../ArtifactSurface';
afterEach(()=>vi.unstubAllGlobals());
it('keeps a cold editor loading indicator out of the reading flow',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({})));
 const props:ArtifactSurfaceProps={id:'cold1',editId:'e1',format:'markup',title:'Cold',source:'<p>Keep reading</p>',content:'',template:null,refs:[],version:1,columns:[],compiledCss:null,theme:null,colorMode:'light',liveEnabled:false};
 const view=render(<ArtifactShell role="owner"><ArtifactSurface {...props}/></ArtifactShell>);
 await screen.findByText('Keep reading');
 fireEvent.click(screen.getByLabelText('Open artifact controls'));
 fireEvent.click(screen.getByLabelText('Edit artifact'));
 const loading=await screen.findByText('loading the editor…');
 expect(loading).toHaveClass('fixed');
 expect(loading).toHaveAttribute('role','status');
 view.unmount();
 expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
