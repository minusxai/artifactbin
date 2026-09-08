import {StrictMode} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {MemoryRouter,Route,Routes} from 'react-router';
import {renderToStaticMarkup} from 'react-dom/server';

const account={kind:'account',user:{id:'qa_account',email:'qa@example.com'},mixpanel:{token:null,host:''}};
const none={kind:'none',user:null,mixpanel:{token:null,host:''}};
function seed(session:unknown=account,path='/'){
 const script=document.createElement('script');script.id='mx-page-data';script.type='application/json';script.textContent=JSON.stringify({path,session,presentation:session===none?'public':'workspace',ssr:false});document.head.append(script);
}
afterEach(()=>{cleanup();document.querySelectorAll('#mx-page-data').forEach(el=>el.remove());vi.useRealTimers();vi.unstubAllGlobals();vi.resetModules();});

it('keeps the captured validated session through StrictMode and ignores later forged DOM',async()=>{
 vi.resetModules();seed();vi.stubGlobal('fetch',vi.fn(()=>new Promise(()=>{})));
 const {SessionProvider,useSession}=await import('../session');
 document.getElementById('mx-page-data')!.textContent=JSON.stringify({path:'/',session:none});
 function Probe(){return <p aria-label="Identity">{useSession().session?.user?.id??'pending'}</p>;}
 render(<StrictMode><SessionProvider><Probe/></SessionProvider></StrictMode>);
 expect(screen.getByLabelText('Identity').textContent).toBe('qa_account');
});

it('shows a real workspace skeleton without a public landing flash while Home is delayed',async()=>{
 vi.resetModules();seed();vi.stubGlobal('fetch',vi.fn(()=>new Promise(()=>{})));
 const {SessionProvider}=await import('../session');const {HomePage}=await import('../pages/Home');
 render(<MemoryRouter><SessionProvider><HomePage/></SessionProvider></MemoryRouter>);
 expect(screen.getByLabelText('Loading workspace')).toHaveTextContent('Loading workspace');
 expect(screen.queryByLabelText('What artifactbin is')).toBeNull();
});

it('renders public Landing immediately from a validated none session, even while Home waits',async()=>{
 vi.resetModules();seed(none);vi.stubGlobal('fetch',vi.fn(()=>new Promise(()=>{})));
 const {SessionProvider}=await import('../session');const {HomePage}=await import('../pages/Home');
 render(<MemoryRouter><SessionProvider><HomePage/></SessionProvider></MemoryRouter>);
 expect(screen.getByLabelText('What artifactbin is')).toBeInTheDocument();
});

it('keeps Account actions absent until identity resolves and makes session failure retryable',async()=>{
 vi.resetModules();vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:503})));
 const {SessionProvider}=await import('../session');const {AccountPage}=await import('../pages/Account');
 render(<MemoryRouter><SessionProvider><AccountPage/></SessionProvider></MemoryRouter>);
 expect(screen.queryByLabelText('Claim token')).toBeNull();
 expect(await screen.findByLabelText('Retry loading account')).toBeEnabled();
});

it('makes a failed Home load recoverable without replacing it with public marketing',async()=>{
 vi.resetModules();seed();vi.stubGlobal('fetch',vi.fn(async(url)=>String(url).includes('/home')?new Response('{}',{status:503}):new Response('{}')));
 const {SessionProvider}=await import('../session');const {HomePage}=await import('../pages/Home');
 render(<MemoryRouter><SessionProvider><HomePage/></SessionProvider></MemoryRouter>);
 expect(await screen.findByLabelText('Retry loading workspace')).toBeEnabled();
 expect(screen.queryByLabelText('What artifactbin is')).toBeNull();
});

it('awaits a fresh session after authentication and invalidates old bootstrap data',async()=>{
 vi.resetModules();seed();let answer:(response:Response)=>void=()=>{};
 vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{answer=resolve;})));
 const {SessionProvider,useSession}=await import('../session');const {pageBootstrap}=await import('../bootstrap');
 function Probe(){const {session,refreshAuth}=useSession();return <><p aria-label="Identity">{session?.kind??'pending'}</p><button aria-label="Refresh auth" onClick={()=>void refreshAuth()}/></>;}
 render(<SessionProvider><Probe/></SessionProvider>);
 fireEvent.click(screen.getByLabelText('Refresh auth'));
 expect(screen.getByLabelText('Identity').textContent).toBe('pending');expect(pageBootstrap('/')).toBeNull();
 await act(async()=>answer(Response.json(none)));
 await waitFor(()=>expect(screen.getByLabelText('Identity').textContent).toBe('none'));
});

it('bounds a hung session request and shows a working retry rather than an indefinite loader',async()=>{
 vi.resetModules();vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn(()=>new Promise(()=>{})));
 const {SessionProvider,useSession}=await import('../session');
 function Probe(){const {error,reload}=useSession();return <><p aria-label="Session error">{error}</p><button aria-label="Retry" onClick={()=>void reload()}/></>;}
 render(<SessionProvider><Probe/></SessionProvider>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(15_001);});expect(screen.getByLabelText('Session error').textContent).toContain('too long');
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json(none)));fireEvent.click(screen.getByLabelText('Retry'));
 await act(async()=>{});expect(screen.getByLabelText('Session error').textContent).toBe('');
});

it('refuses a startup session for a different path and never rereads a later replacement',async()=>{
 vi.resetModules();seed(account,'/account');vi.stubGlobal('fetch',vi.fn(()=>new Promise(()=>{})));
 const {pageBootstrap}=await import('../bootstrap');expect(pageBootstrap('/account')).toBeNull();
 document.getElementById('mx-page-data')!.textContent=JSON.stringify({path:'/',session:account});expect(pageBootstrap('/')).toBeNull();
});

it('offers retry for a failed Trash response instead of an empty permanent table',async()=>{
 vi.resetModules();seed();vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:503})));
 const {SessionProvider}=await import('../session');const {TrashPage}=await import('../pages/Trash');
 render(<MemoryRouter><SessionProvider><TrashPage/></SessionProvider></MemoryRouter>);
 expect(await screen.findByLabelText('Retry loading trash')).toBeEnabled();
});

it('does not expose asset management or dataset editing while session resolution is pending',async()=>{
 vi.resetModules();vi.stubGlobal('fetch',vi.fn(()=>new Promise(()=>{})));
 const {SessionProvider}=await import('../session');const {AssetsPage}=await import('../pages/Assets');const {DatasetEditorPage}=await import('../pages/DatasetEditor');
 render(<MemoryRouter><SessionProvider><AssetsPage/><DatasetEditorPage/></SessionProvider></MemoryRouter>);
 expect(screen.getByLabelText('Loading assets')).toBeInTheDocument();
 expect(screen.getByLabelText('Loading dataset editor')).toBeInTheDocument();
 expect(screen.queryByLabelText('Create dataset')).toBeNull();
});

it('renders the same resolved public body for SSR and client without a data fetch',async()=>{
 vi.resetModules();vi.stubGlobal('fetch',vi.fn(()=>new Promise(()=>{})));
 const {HomeView}=await import('../pages/Home');
 const element=<MemoryRouter><HomeView home={{signedIn:false}} session={none as never}/></MemoryRouter>;
 const html=renderToStaticMarkup(element);expect(html).toContain('What artifactbin is');
 render(element);expect(screen.getByLabelText('What artifactbin is')).toBeInTheDocument();
});

it('keeps profile loading failures recoverable rather than reporting an outage as missing',async()=>{
 vi.resetModules();seed();vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:503})));
 const {SessionProvider}=await import('../session');const {ProfilePage}=await import('../pages/Profile');
 render(<MemoryRouter initialEntries={['/@someone']}><SessionProvider><Routes><Route path="/:user/*" element={<ProfilePage/>}/></Routes></SessionProvider></MemoryRouter>);
 expect(await screen.findByLabelText('Retry loading profile')).toBeEnabled();
});

it('uses a Home projection only for its first visit, not when returning to the route',async()=>{
 vi.resetModules();seed(none);const script=document.getElementById('mx-page-data')!;
 const payload=JSON.parse(script.textContent!);payload.home={signedIn:false,drafts:[{id:'draft1',url:'/a/draft1',title:'Captured draft',format:'markup',version:1,visibility:'public',updated_at:'2026-09-01T00:00:00Z'}]};script.textContent=JSON.stringify(payload);
 vi.stubGlobal('fetch',vi.fn(()=>new Promise(()=>{})));
 const {SessionProvider}=await import('../session');const {HomePage}=await import('../pages/Home');
 const first=render(<MemoryRouter><SessionProvider><HomePage/></SessionProvider></MemoryRouter>);expect(first.container.textContent).toContain('Captured draft');first.unmount();
 const second=render(<MemoryRouter><SessionProvider><HomePage/></SessionProvider></MemoryRouter>);expect(second.container.textContent).not.toContain('Captured draft');
});
