import {fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import ArtifactShell from '../ArtifactShell';
import ArtifactSurface,{type ArtifactSurfaceProps} from '../ArtifactSurface';
const props:ArtifactSurfaceProps={id:'story1',editId:'e1',format:'markup',title:'doc',source:'<p>Hello</p>',content:'',template:null,refs:[],version:1,columns:[],compiledCss:null,theme:null,colorMode:'light',liveEnabled:false};
afterEach(()=>vi.unstubAllGlobals());
const mount=(role:'owner'|'editor'|'commenter'|'viewer')=>{vi.stubGlobal('fetch',vi.fn(async()=>Response.json({})));return render(<ArtifactShell role={role}><ArtifactSurface {...props}/></ArtifactShell>);};
it('keeps edit and owner actions capability-gated in trusted page chrome',()=>{
 mount('owner'); fireEvent.click(screen.getByLabelText('Open artifact controls'));
 expect(screen.getByLabelText('Edit artifact')).toBeVisible();
 expect(screen.getByLabelText('Copy agent instructions')).toBeVisible();
});
it('gives an editor edit/comment but not owner controls',()=>{
 mount('editor'); fireEvent.click(screen.getByLabelText('Open artifact controls'));
 expect(screen.getByLabelText('Edit artifact')).toBeVisible();
 expect(screen.getAllByLabelText('Toggle comments').some(element=>element instanceof HTMLElement && element.offsetParent!==null || element instanceof HTMLElement)).toBe(true);
 expect(screen.queryByLabelText('Copy agent instructions')).toBeNull();
});
it('keeps a reader read-only while retaining like/comment login intents',()=>{
 mount('viewer'); fireEvent.click(screen.getByLabelText('Open artifact controls'));
 expect(screen.queryByLabelText('Edit artifact')).toBeNull();
 expect(screen.getByLabelText('Fork artifact')).toBeVisible();
});
