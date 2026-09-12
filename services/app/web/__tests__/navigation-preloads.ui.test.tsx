import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, createMemoryRouter, Outlet, RouterProvider, useLocation, useNavigate } from 'react-router';
import { useContext } from 'react';
import { createPageDataStore, type PageDataStore } from '../page-data-store';
import { NavigationPreloads, NavigationPreloadContext } from '../navigation-preloads';
import { NavigationBoundary, useNavigationGuard } from '../NavigationBoundary';
import { usePageData } from '../use-page-data';
import { routePages } from '../route-pages';
import { routeLoading } from '../route-loading';

const context=vi.hoisted(()=>({pages:null as PageDataStore|null}));
vi.mock('../session',()=>({useSession:()=>({pages:context.pages,session:{kind:'account',user:{id:'A',email:null},mixpanel:{token:null,host:''}},sessionError:null,reload:()=>{}})}));
const deferred=<T,>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};};
function Account(){const {data}=usePageData<{label:string}>('/api/page/account');return <main aria-label="Account result">{data?.label??'pending'}</main>;}
function Harness({show=false}:{show?:boolean}){
  const navigate=useNavigate();
  return <NavigationPreloads><button aria-label="Go account" onClick={()=>void navigate('/account')}/><button aria-label="Go privacy" onClick={()=>void navigate('/privacy')}/>{show&&<Account/>}</NavigationPreloads>;
}
const ui=(show=false)=><MemoryRouter initialEntries={['/privacy']}><Harness show={show}/></MemoryRouter>;
beforeEach(()=>{vi.restoreAllMocks();context.pages=createPageDataStore();context.pages.setScope('A');});

it('starts data while code is pending, adopts a completed preload once, and revalidates a later visit',async()=>{
  const code=deferred<void>();
  const preload=vi.spyOn(routePages.AccountPage,'preload').mockImplementation(()=>code.promise);
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({label:'ready'})));
  vi.stubGlobal('fetch',fetcher);
  const view=render(ui());
  await act(async()=>fireEvent.click(screen.getByLabelText('Go account')));
  expect(preload).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(context.pages!.resource('/api/page/account').snapshot().data).toEqual({label:'ready'});
  await act(async()=>{code.resolve();view.rerender(ui(true));});
  expect(screen.getByLabelText('Account result')).toHaveTextContent('ready');
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async()=>view.rerender(ui(false)));
  await act(async()=>fireEvent.click(screen.getByLabelText('Go privacy')));
  await act(async()=>fireEvent.click(screen.getByLabelText('Go account')));
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('adopts a pending preload without a second mount request',async()=>{
  vi.spyOn(routePages.AccountPage,'preload').mockResolvedValue();
  const network=deferred<Response>(),fetcher=vi.fn(()=>network.promise);
  vi.stubGlobal('fetch',fetcher);const view=render(ui());
  await act(async()=>fireEvent.click(screen.getByLabelText('Go account')));
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async()=>view.rerender(ui(true)));
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async()=>network.resolve(new Response(JSON.stringify({label:'arrived'}))));
  expect(screen.getByLabelText('Account result')).toHaveTextContent('arrived');
});

it('cancels unadopted data when superseded by a route with no page request',async()=>{
  vi.spyOn(routePages.AccountPage,'preload').mockResolvedValue();
  const network=deferred<Response>();let signal:AbortSignal|undefined;
  const fetcher=vi.fn((_url:unknown,init?:RequestInit)=>{signal=init?.signal??undefined;return network.promise;});
  vi.stubGlobal('fetch',fetcher);render(ui());
  await act(async()=>fireEvent.click(screen.getByLabelText('Go account')));
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async()=>fireEvent.click(screen.getByLabelText('Go privacy')));
  expect(signal?.aborted).toBe(true);
  await act(async()=>network.resolve(new Response(JSON.stringify({label:'obsolete'}))));
  expect(context.pages!.resource('/api/page/account').snapshot().data).toBeNull();
});

it('warm destination mounting in the coordinator commit adopts ownership before its passive load',async()=>{
  vi.spyOn(routePages.AccountPage,'preload').mockResolvedValue();
  const network=deferred<Response>();let signal:AbortSignal|undefined;
  const fetcher=vi.fn((_url:unknown,init?:RequestInit)=>{signal=init?.signal??undefined;return network.promise;});
  vi.stubGlobal('fetch',fetcher);
  let navigationId:string|null=null;
  function Capture(){navigationId=useContext(NavigationPreloadContext);return <Account/>;}
  function Warm(){const location=useLocation(),navigate=useNavigate();return <NavigationPreloads><button aria-label="Warm account" onClick={()=>void navigate('/account')}/><button aria-label="Warm privacy" onClick={()=>void navigate('/privacy')}/>{location.pathname==='/account'&&<Capture/>}</NavigationPreloads>;}
  render(<MemoryRouter initialEntries={['/privacy']}><Warm/></MemoryRouter>);
  await act(async()=>fireEvent.click(screen.getByLabelText('Warm account')));
  expect(routePages.AccountPage.preload).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
  // A late coordinator must not leave a marker that aborts an active consumer.
  context.pages!.cancelPreloads(navigationId!);
  expect(signal?.aborted).toBe(false);
  await act(async()=>network.resolve(new Response(JSON.stringify({label:'warm arrived'}))));
  expect(screen.getByLabelText('Account result')).toHaveTextContent('warm arrived');
});

it('hover/focus preloads code once, never data, and ignores external/download/blank targets',async()=>{
  const code=deferred<void>(),preload=vi.spyOn(routePages.AccountPage,'preload').mockImplementation(()=>code.promise);
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  render(<MemoryRouter initialEntries={['/privacy']}><NavigationPreloads><a aria-label="Intent" href="/account">Account</a><a aria-label="External" href="https://example.com/account"/><a aria-label="Download" href="/account" download/><a aria-label="Blank" href="/account" target="_blank"/></NavigationPreloads></MemoryRouter>);
  for(const name of ['External','Download','Blank']) fireEvent.mouseOver(screen.getByLabelText(name));
  expect(preload).not.toHaveBeenCalled();
  fireEvent.mouseOver(screen.getByLabelText('Intent'));fireEvent.focusIn(screen.getByLabelText('Intent'));
  expect(preload).toHaveBeenCalledTimes(1);expect(fetcher).not.toHaveBeenCalled();
  await act(async()=>code.resolve());
});

it('a denied dirty-editor navigation starts no destination data or code',async()=>{
  vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
  const preload=vi.spyOn(routePages.AccountPage,'preload').mockResolvedValue(),fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  const denied=vi.fn(async()=>false);
  function Guard(){useNavigationGuard(denied);return <a aria-label="Denied account" href="/account"/>;}
  const router=createMemoryRouter([{element:<NavigationBoundary><NavigationPreloads><Outlet/></NavigationPreloads></NavigationBoundary>,children:[{path:'/privacy',element:<Guard/>},{path:'/account',element:<Account/>}]}],{initialEntries:['/privacy']});
  render(<RouterProvider router={router}/>);
  await act(async()=>fireEvent.click(screen.getByLabelText('Denied account')));
  expect(denied).toHaveBeenCalledTimes(1);expect(fetcher).not.toHaveBeenCalled();expect(preload).not.toHaveBeenCalled();
});

it('initial seeded content needs neither a preload nor a mount request',async()=>{
  const preload=vi.spyOn(routePages.AccountPage,'preload').mockResolvedValue();
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  function Seeded(){const {data}=usePageData('/api/page/account',{seed:()=>({label:'bootstrap'})});return <main aria-label="Seeded">{data?.label}</main>;}
  await act(async()=>{render(<MemoryRouter initialEntries={['/account']}><NavigationPreloads><Seeded/></NavigationPreloads></MemoryRouter>);});
  expect(screen.getByLabelText('Seeded')).toHaveTextContent('bootstrap');
  expect(preload).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
});

it('canonical alias healing and signal/hash updates retain one artifact request',async()=>{
  vi.spyOn(routePages.ProfilePage,'preload').mockResolvedValue();vi.spyOn(routePages.ArtifactPage,'preload').mockResolvedValue();
  const fetcher=vi.fn(async(_url:string)=>new Response(JSON.stringify({label:'artifact'})));vi.stubGlobal('fetch',fetcher);
  function Moves(){const navigate=useNavigate();return <NavigationPreloads><button aria-label="Artifact" onClick={()=>void navigate('/a/ABC123?$pick=1')}/><button aria-label="Alias" onClick={()=>void navigate('/@alice/ABC123-title?$pick=2#section',{replace:true})}/></NavigationPreloads>;}
  render(<MemoryRouter initialEntries={['/privacy']}><Moves/></MemoryRouter>);
  await act(async()=>fireEvent.click(screen.getByLabelText('Artifact')));
  await act(async()=>fireEvent.click(screen.getByLabelText('Alias')));
  expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0]?.[0]).toBe('/api/page/artifact/ABC123?$pick=1');
});

it('logout revokes pending preload',async()=>{
  vi.spyOn(routePages.AccountPage,'preload').mockResolvedValue();
  const old=deferred<Response>();const fetcher=vi.fn(()=>old.promise);vi.stubGlobal('fetch',fetcher);
  render(ui());await act(async()=>fireEvent.click(screen.getByLabelText('Go account')));
  await act(async()=>{context.pages!.setScope('B');old.resolve(new Response(JSON.stringify({label:'A secret'})));});
  expect(context.pages!.resource('/api/page/account').snapshot().data).toBeNull();
});

it('entering cached editing state does not start a preload that bypasses its pause',async()=>{
  vi.spyOn(routePages.ProfilePage,'preload').mockResolvedValue();vi.spyOn(routePages.ArtifactPage,'preload').mockResolvedValue();
  context.pages!.resource('/api/page/artifact/ABC123').seed({label:'cached draft basis'});
  const fetcher=vi.fn(async()=>new Response('{}'));vi.stubGlobal('fetch',fetcher);
  function Editing(){const navigate=useNavigate();return <NavigationPreloads><button aria-label="Enter editing" onClick={()=>void navigate('/a/ABC123#edit')}/></NavigationPreloads>;}
  render(<MemoryRouter initialEntries={['/privacy']}><Editing/></MemoryRouter>);
  await act(async()=>fireEvent.click(screen.getByLabelText('Enter editing')));
  expect(fetcher).not.toHaveBeenCalled();
});

it('route mapping shares artifact/folder keys, keeps static routes data-free, and preserves custom page loaders',()=>{
  const map=(path:string)=>routeLoading(new URL(path,'http://localhost'));
  expect(map('/@alice/ABC123-folder?key=x')?.key).toBe('/api/page/artifact/ABC123?key=x');
  expect(map('/@alice')?.key).toBe('/api/page/profile/%40alice');
  expect(map('/')?.key).toBe('/api/page/home?part=core');
  expect(map('/trash')?.key).toBe('/api/page/trash');
  for(const path of ['/chat','/assets','/privacy','/login']) expect(map(path)?.key).toBeUndefined();
  for(const path of ['/a/ABC123/raw','/api/query','/docs','/api/auth/callback','/not-an-app']) expect(map(path)).toBeNull();
});

it('starts initial home data while Home code is still pending and adopts it once on mount', async () => {
  const code = deferred<void>();
  vi.spyOn(routePages.HomePage, 'preload').mockImplementation(() => code.promise);
  const fetcher = vi.fn(async (_url: string) => new Response(JSON.stringify({ label: 'library' })));
  vi.stubGlobal('fetch', fetcher);
  function Home() { const { data } = usePageData<{ label: string }>('/api/page/home?part=core'); return <main aria-label="Initial library">{data?.label ?? 'pending'}</main>; }
  const ui = (show: boolean) => <MemoryRouter initialEntries={['/']}><NavigationPreloads>{show && <Home />}</NavigationPreloads></MemoryRouter>;
  const view = render(ui(false));
  await act(async () => {});
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/page/home?part=core');
  await act(async () => { code.resolve(); view.rerender(ui(true)); });
  expect(screen.getByLabelText('Initial library')).toHaveTextContent('library');
  expect(fetcher).toHaveBeenCalledOnce();
});
