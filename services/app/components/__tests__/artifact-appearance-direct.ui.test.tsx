import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import ArtifactShell from '../ArtifactShell';
import ArtifactSurface,{type ArtifactSurfaceProps} from '../ArtifactSurface';

afterEach(()=>{vi.unstubAllGlobals();localStorage.removeItem('mx_theme');document.documentElement.removeAttribute('data-theme');document.documentElement.className='';});
const props:ArtifactSurfaceProps={id:'story1',editId:'edit1',format:'markup',title:'Appearance',source:'<h1>Appearance fixture</h1>',content:'',template:null,refs:[],version:1,columns:[],compiledCss:null,theme:'modernist',colorMode:'light',liveEnabled:false};
it.each(['dark','light'] as const)('changes document color mode to %s without replacing its theme and retains the app choice on departure',async(mode)=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({})));
  const view=render(<ArtifactShell role="viewer"><ArtifactSurface {...props} colorMode={mode==='dark'?'light':'dark'}/></ArtifactShell>);
  await waitFor(()=>expect(screen.getByText('Appearance fixture')).toBeVisible());
  fireEvent.click(screen.getByLabelText('Open artifact controls'));
  fireEvent.click(screen.getByLabelText(mode==='dark'?'Dark mode':'Light mode'));
  await waitFor(()=>expect(document.documentElement).toHaveClass(mode));
  expect(document.documentElement).toHaveAttribute('data-theme','modernist');
  expect(localStorage.getItem('mx_theme')).toBe(mode);
  view.unmount();
  if(mode==='dark')expect(document.documentElement).toHaveAttribute('data-theme','dark');
  else expect(document.documentElement).not.toHaveAttribute('data-theme');
});
