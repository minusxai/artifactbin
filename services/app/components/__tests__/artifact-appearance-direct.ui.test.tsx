import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import ArtifactShell from '../ArtifactShell';
import ArtifactSurface,{type ArtifactSurfaceProps} from '../ArtifactSurface';

afterEach(()=>{vi.unstubAllGlobals();localStorage.removeItem('mx_theme');document.documentElement.removeAttribute('data-theme');document.documentElement.className='';});
const props:ArtifactSurfaceProps={id:'story1',editId:'edit1',format:'markup',title:'Appearance',source:'<h1>Appearance fixture</h1>',content:'',template:null,refs:[],version:1,columns:[],compiledCss:null,theme:'modernist',colorMode:'light',liveEnabled:false};
it('changes document color mode without replacing its theme and retains the app choice on departure',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({})));
  const view=render(<ArtifactShell role="viewer"><ArtifactSurface {...props}/></ArtifactShell>);
  await waitFor(()=>expect(screen.getByText('Appearance fixture')).toBeVisible());
  fireEvent.click(screen.getByLabelText('Open artifact controls'));
  fireEvent.click(screen.getByLabelText('Dark mode'));
  await waitFor(()=>expect(document.documentElement).toHaveClass('dark'));
  expect(document.documentElement).toHaveAttribute('data-theme','modernist');
  expect(localStorage.getItem('mx_theme')).toBe('dark');
  view.unmount();
  expect(document.documentElement).toHaveAttribute('data-theme','dark');
});
