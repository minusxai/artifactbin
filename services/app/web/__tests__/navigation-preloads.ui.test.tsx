import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, useNavigate } from 'react-router';
import { createPageDataStore, type PageDataStore } from '../page-data-store';
import { NavigationPreloads } from '../navigation-preloads';
import { usePageData } from '../use-page-data';
import { routePages } from '../route-pages';

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
