import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {MemoryRouter,useLocation} from 'react-router';
const account={kind:'account',user:{id:'qa_account',email:null},mixpanel:{token:null,host:''}};
const none={kind:'none',user:null,mixpanel:{token:null,host:''}};
afterEach(()=>{cleanup();document.getElementById('mx-page-data')?.remove();vi.unstubAllGlobals();vi.resetModules();});

it('guards repeated form submits throughout pending session verification and permits retry after failure',async()=>{
 vi.resetModules();let signedIn=false,signIns=0,checks=0;
 let settle!:(response:Response)=>void;
 const pending=new Promise<Response>(resolve=>{settle=resolve;});
 vi.stubGlobal('fetch',vi.fn(async(url)=>{
  if(String(url).includes('/sign-in/')){signedIn=true;signIns++;}
  if(String(url).endsWith('/session')){if(signedIn){checks++;return checks===1?pending:Response.json(account);}return Response.json(none);}
  return Response.json({});
 }));
 const {SessionProvider,useSession}=await import('../session');const {default:LoginForm}=await import('@/components/LoginForm');const {AppNavigationBinding}=await import('../AppNavigation');
 function Probe(){return <><p aria-label="Identity">{useSession().session?.kind??'pending'}</p><p aria-label="Route">{useLocation().pathname}</p><LoginForm/></>;}
 render(<MemoryRouter initialEntries={['/login']}><AppNavigationBinding/><SessionProvider><Probe/></SessionProvider></MemoryRouter>);
 await waitFor(()=>expect(screen.getByLabelText('Identity').textContent).toBe('none'));
 fireEvent.change(screen.getByLabelText('Email'),{target:{value:'qa@example.com'}});fireEvent.click(screen.getByLabelText('Log in with email'));
 fireEvent.change(await screen.findByLabelText('Login code'),{target:{value:'123456'}});
 const form=screen.getByLabelText('Verify code').closest('form')!;
 fireEvent.submit(form);fireEvent.submit(form);
 await waitFor(()=>expect(checks).toBeGreaterThan(0));
 fireEvent.submit(form);
 expect(signIns).toBe(1);expect(checks).toBe(1);
 expect(screen.getByLabelText('Retry loading session')).toBeDisabled();
 expect(screen.getByLabelText('Route').textContent).toBe('/login');
 await act(async()=>{settle(new Response('{}',{status:503}));});
 const retry=screen.getByLabelText('Retry loading session');expect(retry).toBeEnabled();
 fireEvent.click(retry);await waitFor(()=>expect(screen.getByLabelText('Route').textContent).toBe('/'));
 expect(signIns).toBe(1);expect(checks).toBe(2);
});

it('updates the shared session after OTP success before navigating to the local callback',async()=>{
 vi.resetModules();let signedIn=false;
 vi.stubGlobal('fetch',vi.fn(async(url)=>{
  if(String(url).includes('/sign-in/'))signedIn=true;
  return Response.json(String(url).endsWith('/session')?(signedIn?account:none):{});
 }));
 const {SessionProvider,useSession}=await import('../session');const {default:LoginForm}=await import('@/components/LoginForm');const {AppNavigationBinding}=await import('../AppNavigation');
 function Probe(){const {session}=useSession(),location=useLocation();return <><p aria-label="Identity">{session?.kind??'pending'}</p><p aria-label="Route">{location.pathname}</p><LoginForm/></>;}
 render(<MemoryRouter initialEntries={['/login']}><AppNavigationBinding/><SessionProvider><Probe/></SessionProvider></MemoryRouter>);
 await waitFor(()=>expect(screen.getByLabelText('Identity').textContent).toBe('none'));
 fireEvent.change(screen.getByLabelText('Email'),{target:{value:'qa@example.com'}});fireEvent.click(screen.getByLabelText('Log in with email'));
 fireEvent.change(await screen.findByLabelText('Login code'),{target:{value:'123456'}});fireEvent.click(screen.getByLabelText('Verify code'));
 await waitFor(()=>expect(screen.getByLabelText('Route').textContent).toBe('/'));
 expect(screen.getByLabelText('Identity').textContent).toBe('account');
});

it('revalidates logout and clears the old account before SPA home navigation',async()=>{
 vi.resetModules();let signedIn=true;
 vi.stubGlobal('fetch',vi.fn(async(url)=>{if(String(url).endsWith('/sign-out'))signedIn=false;return Response.json(String(url).endsWith('/session')?(signedIn?account:none):{});}));
 const {SessionProvider,useSession}=await import('../session');const {PageMenu}=await import('@/components/PageChrome');const {AppNavigationBinding}=await import('../AppNavigation');
 function Probe(){const {session}=useSession(),location=useLocation();return <><p aria-label="Identity">{session?.kind??'pending'}</p><p aria-label="Route">{location.pathname}</p><PageMenu authed={!!session?.user}/></>;}
 render(<MemoryRouter initialEntries={['/account']}><AppNavigationBinding/><SessionProvider><Probe/></SessionProvider></MemoryRouter>);
 await waitFor(()=>expect(screen.getByLabelText('Identity').textContent).toBe('account'));
 fireEvent.click(screen.getByLabelText('Open menu'));fireEvent.click(screen.getByLabelText('Sign out'));
 await waitFor(()=>expect(screen.getByLabelText('Route').textContent).toBe('/'));expect(screen.getByLabelText('Identity').textContent).toBe('none');
});

it('refreshes the account token list after claiming without reloading or losing the success message',async()=>{
 vi.resetModules();let claimed=false;
 const token={id:'tok_claimed',name:'Claimed agent',status:'active',created_at:'2026-09-01T00:00:00Z',deleted_at:null,expires_at:null,last_used_at:null};
 vi.stubGlobal('fetch',vi.fn(async(url)=>{
  if(String(url).endsWith('/claim')){claimed=true;return Response.json({claimedArtifacts:1});}
  if(String(url).endsWith('/api/my/tokens'))return Response.json({tokens:claimed?[token]:[]});
  return Response.json(account);
 }));
 const {SessionProvider}=await import('../session');const {default:ClaimForm}=await import('@/components/ClaimForm');const {default:TokensPanel}=await import('@/components/TokensPanel');
 render(<MemoryRouter><SessionProvider><ClaimForm/><TokensPanel/></SessionProvider></MemoryRouter>);
 fireEvent.change(screen.getByLabelText('Token to claim'),{target:{value:'mx_'+'a'.repeat(43)}});fireEvent.click(screen.getByLabelText('Claim token'));
 expect(await screen.findByLabelText('Token row Claimed agent')).toBeInTheDocument();
 expect(screen.getByLabelText('Claim token').closest('form')).toHaveTextContent('Claimed — 1 artifact(s)');
});

it('retries session verification after successful OTP without reusing the consumed code',async()=>{
 vi.resetModules();let signedIn=false,verified=false,signIns=0;
 vi.stubGlobal('fetch',vi.fn(async(url)=>{
  if(String(url).includes('/sign-in/')){signedIn=true;signIns++;}
  if(String(url).endsWith('/session'))return signedIn&&!verified?new Response('{}',{status:503}):Response.json(signedIn?account:none);
  return Response.json({});
 }));
 const {SessionProvider}=await import('../session');const {default:LoginForm}=await import('@/components/LoginForm');const {AppNavigationBinding}=await import('../AppNavigation');
 function Probe(){return <><p aria-label="Route">{useLocation().pathname}</p><LoginForm/></>;}
 render(<MemoryRouter initialEntries={['/login']}><AppNavigationBinding/><SessionProvider><Probe/></SessionProvider></MemoryRouter>);
 fireEvent.change(screen.getByLabelText('Email'),{target:{value:'qa@example.com'}});fireEvent.click(screen.getByLabelText('Log in with email'));
 fireEvent.change(await screen.findByLabelText('Login code'),{target:{value:'123456'}});fireEvent.click(screen.getByLabelText('Verify code'));
 const retry=await screen.findByLabelText('Retry loading session');expect(screen.getByLabelText('Route').textContent).toBe('/login');
 verified=true;fireEvent.click(retry);await waitFor(()=>expect(screen.getByLabelText('Route').textContent).toBe('/'));expect(signIns).toBe(1);
});

it('keeps failed signout authorized, but clears authority after successful signout even if verification fails',async()=>{
 vi.resetModules();let signedIn=true,allowSignout=false,verify=false;
 vi.stubGlobal('fetch',vi.fn(async(url)=>{
  if(String(url).endsWith('/sign-out')){if(!allowSignout)return new Response('{}',{status:503});signedIn=false;return Response.json({});}
  if(String(url).endsWith('/session'))return !signedIn&&!verify?new Response('{}',{status:503}):Response.json(signedIn?account:none);
  return Response.json({});
 }));
 const {SessionProvider,useSession}=await import('../session');const {PageMenu}=await import('@/components/PageChrome');const {AppNavigationBinding}=await import('../AppNavigation');
 function Probe(){const {session}=useSession();return <><p aria-label="Identity">{session?.kind??'pending'}</p><p aria-label="Route">{useLocation().pathname}</p><PageMenu authed={!!session?.user}/></>;}
 render(<MemoryRouter initialEntries={['/account']}><AppNavigationBinding/><SessionProvider><Probe/></SessionProvider></MemoryRouter>);
 await waitFor(()=>expect(screen.getByLabelText('Identity').textContent).toBe('account'));fireEvent.click(screen.getByLabelText('Open menu'));fireEvent.click(screen.getByLabelText('Sign out'));
 expect(await screen.findByLabelText('Session change failed')).toHaveTextContent('Could not sign out');expect(screen.getByLabelText('Identity').textContent).toBe('account');
 allowSignout=true;fireEvent.click(screen.getByLabelText('Sign out'));const retry=await screen.findByLabelText('Retry loading session');expect(screen.getByLabelText('Identity').textContent).toBe('pending');
 verify=true;fireEvent.click(retry);await waitFor(()=>expect(screen.getByLabelText('Route').textContent).toBe('/'));expect(screen.getByLabelText('Identity').textContent).toBe('none');
});
