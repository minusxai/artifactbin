import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {MemoryRouter,Route,Routes} from 'react-router';
import {HomePage} from '../pages/Home';
import {SessionProvider} from '../session';
vi.mock('@/components/viz/VegaChart',()=>({VegaChart:()=> <div/>}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function show(){render(<MemoryRouter><SessionProvider><Routes><Route path="/" element={<HomePage/>}/><Route path="/login" element={<h1>Log in</h1>}/></Routes></SessionProvider></MemoryRouter>);}
it('waits for session identity without showing a marketing page',()=>{
 vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(()=>{})));show();
 expect(screen.getByLabelText('Loading workspace')).toBeInTheDocument();
 expect(screen.queryByRole('region',{name:'About Artifactbin'})).not.toBeInTheDocument();
});
it.each(['none','anon'])('redirects %s sessions during client navigation, including held drafts',async kind=>{
 vi.stubGlobal('fetch',vi.fn((url:string)=>Promise.resolve(Response.json(url.includes('/session')?{kind,user:null}:{signedIn:false,drafts:[{id:'AbC123',title:'Private draft'}]}))));
 show();await screen.findByRole('heading',{name:'Log in'});
 expect(screen.queryByText('Private draft')).not.toBeInTheDocument();
});
