import {render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router';
import {expect,it,vi} from 'vitest';
const surface=vi.hoisted(()=>vi.fn(()=> <div aria-label="Forbidden author surface"/>));
vi.mock('@/components/ArtifactSurface',()=>({default:surface}));
vi.mock('@/web/api-origin',()=>({isControlsClient:()=>false,isFolderClient:()=>true,appNavigate:vi.fn(),appFetch:vi.fn(async()=>Response.json({canonical:'/a/Ab1234',role:'viewer',kind:'account',surface:{}}))}));
import {ArtifactPage} from '../pages/Artifact';
it('fails closed if a folder becomes author content after frame admission',async()=>{
  render(<MemoryRouter><ArtifactPage id="Ab1234"/></MemoryRouter>);
  await waitFor(()=>expect(screen.queryByLabelText('Loading page')).toBeNull());
  expect(surface).not.toHaveBeenCalled();
});
