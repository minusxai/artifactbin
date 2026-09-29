import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, useNavigate } from 'react-router';
import { createPageDataStore, type PageDataStore } from '../page-data-store';
import { NavigationPreloads } from '../navigation-preloads';
import { routePages } from '../route-pages';
import { routeLoading } from '../route-loading';

const context=vi.hoisted(()=>({pages:null as PageDataStore|null}));
vi.mock('../session',()=>({useSession:()=>({pages:context.pages,session:{kind:'account',user:{id:'A',email:null}},sessionError:null,reload:()=>{}})}));
beforeEach(()=>{vi.restoreAllMocks();context.pages=createPageDataStore();context.pages.setScope('A');});
it('canonical alias healing and signal/hash updates retain one artifact request',async()=>{
  vi.spyOn(routePages.ProfilePage,'preload').mockResolvedValue();vi.spyOn(routePages.ArtifactPage,'preload').mockResolvedValue();
  const fetcher=vi.fn(async(_url:string)=>new Response(JSON.stringify({label:'artifact'})));vi.stubGlobal('fetch',fetcher);
  function Moves(){const navigate=useNavigate();return <NavigationPreloads><button aria-label="Artifact" onClick={()=>void navigate('/a/ABC123?$pick=1')}/><button aria-label="Alias" onClick={()=>void navigate('/@alice/ABC123-title?$pick=2#section',{replace:true})}/></NavigationPreloads>;}
  render(<MemoryRouter initialEntries={['/login']}><Moves/></MemoryRouter>);
  await act(async()=>fireEvent.click(screen.getByLabelText('Artifact')));
  await act(async()=>fireEvent.click(screen.getByLabelText('Alias')));
  expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0]?.[0]).toBe('/api/page/artifact/ABC123?$pick=1');
});

it('entering cached editing state does not start a preload that bypasses its pause',async()=>{
  vi.spyOn(routePages.ProfilePage,'preload').mockResolvedValue();vi.spyOn(routePages.ArtifactPage,'preload').mockResolvedValue();
  context.pages!.resource('/api/page/artifact/ABC123').seed({label:'cached draft basis'});
  const fetcher=vi.fn(async()=>new Response('{}'));vi.stubGlobal('fetch',fetcher);
  function Editing(){const navigate=useNavigate();return <NavigationPreloads><button aria-label="Enter editing" onClick={()=>void navigate('/a/ABC123#edit')}/></NavigationPreloads>;}
  render(<MemoryRouter initialEntries={['/login']}><Editing/></MemoryRouter>);
  await act(async()=>fireEvent.click(screen.getByLabelText('Enter editing')));
  expect(fetcher).not.toHaveBeenCalled();
});

it('route mapping shares artifact/folder keys, keeps static routes data-free, and preserves custom page loaders',()=>{
  const map=(path:string)=>routeLoading(new URL(path,'http://localhost'));
  expect(map('/@alice/ABC123-folder?key=x')?.key).toBe('/api/page/artifact/ABC123?key=x');
  expect(map('/@alice')?.key).toBe('/api/page/profile/%40alice');
  for(const path of ['/','/assets','/datasets/new','/files/new','/trash','/login','/start','/welcome','/notifications','/account']) expect(map(path)).toBeNull();
  expect(map('/chat')?.key).toBeUndefined();
  for(const path of ['/a/ABC123/raw','/api/query','/docs','/api/auth/callback','/not-an-app']) expect(map(path)).toBeNull();
});
