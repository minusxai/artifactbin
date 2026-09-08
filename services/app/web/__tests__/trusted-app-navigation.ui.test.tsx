import {createContext,useContext} from 'react';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,useLocation,useNavigate} from 'react-router';
import {expect,it,vi} from 'vitest';
import {TrustedChrome,TrustedUiHost,useTrustedPortalContainer} from '@/components/TrustedUi';
import WorkspaceCreate from '@/components/WorkspaceCreate';
import {AppNavigationBinding,trustedAnchorNavigation} from '../AppNavigation';
import {appNavigate,isClientAppUrl} from '../api-origin';

it('keeps route contexts in chrome and light-page dialogs outside the persistent boundary',async()=>{
 const Value=createContext('missing');let root:ShadowRoot,privateTarget:HTMLElement|null=null,lightTarget:HTMLElement|null|undefined;let go:ReturnType<typeof useNavigate>;
 function Private(){const value=useContext(Value),location=useLocation();privateTarget=useTrustedPortalContainer();return <button aria-label="Context" ref={el=>{if(el)root=el.getRootNode() as ShadowRoot;}}>{value}:{location.pathname}</button>;}
 function Page(){const location=useLocation();go=useNavigate();lightTarget=useTrustedPortalContainer();return <Value.Provider value="source"><p aria-label="Light page">{location.pathname}</p><TrustedChrome><Private/></TrustedChrome></Value.Provider>;}
 const view=render(<MemoryRouter><TrustedUiHost styles="" mode="light"><Page/></TrustedUiHost></MemoryRouter>);
 await waitFor(()=>expect(privateTarget).not.toBeNull());const host=root!.host,target=privateTarget;
 expect(lightTarget).toBeNull();expect(screen.getByLabelText('Light page').getRootNode()).toBe(document);expect(root!.textContent).toContain('source:/');
 await act(async()=>{await go!('/terms');});expect(root!.host).toBe(host);expect(privateTarget).toBe(target);expect(root!.textContent).toContain('source:/terms');view.unmount();
});

it('binds every trusted-chrome link to Router with replace and back support',async()=>{
 let root:ShadowRoot;let go:ReturnType<typeof useNavigate>;
 function Probe(){const location=useLocation();go=useNavigate();return <><p aria-label="Address">{location.pathname+location.search+location.hash}</p><TrustedChrome><a href="/terms?lang=en#policy" aria-label="Terms link" ref={el=>{if(el)root=el.getRootNode() as ShadowRoot;}}>Terms</a></TrustedChrome></>;}
 render(<MemoryRouter initialEntries={['/privacy']}><AppNavigationBinding/><TrustedUiHost styles="" mode="light"><Probe/></TrustedUiHost></MemoryRouter>);
 fireEvent.click(root!.querySelector('[aria-label="Terms link"]')!);await waitFor(()=>expect(screen.getByLabelText('Address').textContent).toBe('/terms?lang=en#policy'));
 act(()=>appNavigate('/account',true));await waitFor(()=>expect(screen.getByLabelText('Address').textContent).toBe('/account'));
 await act(async()=>{await go!(-1);});expect(screen.getByLabelText('Address').textContent).toBe('/privacy');
});

it('leaves machine/auth/raw URLs and external origins outside client routing',()=>{
 const origin=window.location.origin;
 for(const path of ['/privacy','/account','/tokens/new','/datasets/abc123/edit','/a/abc123','/@someone/abc123-title','/@someone/folder/abc123-title'])expect(isClientAppUrl(new URL(path,origin),origin),path).toBe(true);
 for(const path of ['/api/page/session','/api/auth/callback/google','/oauth/authorize','/docs','/docs/human','/docs/artifactbin/SKILL.md','/a/abc123/raw','/a/abc123/export','/assets/ref/abc123','/a/abc123?key=capture'])expect(isClientAppUrl(new URL(path,origin),origin),path).toBe(false);
 expect(isClientAppUrl(new URL('https://external.example/account'),origin)).toBe(false);
});

it('preserves native modified, target, download and untrusted-page link behavior',()=>{
 let go:ReturnType<typeof useNavigate>;
 function Probe(){const location=useLocation();go=useNavigate();return <p aria-label="Native address">{location.pathname}</p>;}
 render(<MemoryRouter initialEntries={['/privacy']}><AppNavigationBinding/><Probe/></MemoryRouter>);
 const anchor=document.createElement('a');anchor.href='/account';
 anchor.addEventListener('click',trustedAnchorNavigation);
 for(const init of [{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{button:1}]){
  const event=new MouseEvent('click',{cancelable:true,...init});anchor.dispatchEvent(event);expect(event.defaultPrevented).toBe(false);
 }
 for(const [name,value] of [['target','_blank'],['download','account'],['rel','external']]){
  anchor.setAttribute(name,value);const event=new MouseEvent('click',{cancelable:true});anchor.dispatchEvent(event);expect(event.defaultPrevented).toBe(false);anchor.removeAttribute(name);
 }
 expect(screen.getByLabelText('Native address').textContent).toBe('/privacy');
 expect(go!).toBeTypeOf('function');
 const plain=document.createElement('a');plain.href='/account';const event=new MouseEvent('click',{cancelable:true});plain.dispatchEvent(event);expect(event.defaultPrevented).toBe(false);
});

it('keeps a closed-root dropdown open for inside pointer events and closes it outside',()=>{
 let root:ShadowRoot;
 render(<TrustedUiHost styles="" mode="light"><button aria-label="Outside">Outside</button><TrustedChrome><button aria-label="Probe" ref={el=>{if(el)root=el.getRootNode() as ShadowRoot;}}/><WorkspaceCreate onCreated={vi.fn()}/></TrustedChrome></TrustedUiHost>);
 fireEvent.click(root!.querySelector('[aria-label="Create"]')!);
 const menu=root!.querySelector('[aria-label="Create menu"]')!;expect(menu).not.toBeNull();
 fireEvent.mouseDown(menu,{composed:true});expect(root!.querySelector('[aria-label="Create menu"]')).not.toBeNull();
 fireEvent.mouseDown(root!.querySelector('[aria-label="Probe"]')!,{composed:true});expect(root!.querySelector('[aria-label="Create menu"]')).toBeNull();
 fireEvent.click(root!.querySelector('[aria-label="Create"]')!);
 fireEvent.mouseDown(screen.getByLabelText('Outside'),{composed:true});expect(root!.querySelector('[aria-label="Create menu"]')).toBeNull();
});
