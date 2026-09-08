import {render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router';
import {afterEach,expect,it,vi} from 'vitest';
import {RegionPage} from '@/web/RegionPage';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();delete document.documentElement.dataset.theme;});
it('replays the trusted stored appearance when a public parent finishes booting',()=>{
  document.documentElement.dataset.theme='dark';const post=vi.spyOn(window.parent,'postMessage');
  render(<MemoryRouter><RegionPage kind="chrome" page="/" main="https://example.test"/></MemoryRouter>);
  window.dispatchEvent(new MessageEvent('message',{source:window.parent,origin:'https://example.test',data:{type:'mx:region:measure'}}));
  expect(post).toHaveBeenCalledWith({type:'mx:region:appearance',mode:'dark'},'https://example.test');
});
it('resolves a trailing-slash public profile at the same authoritative profile API',async()=>{
  const fetch=vi.fn(async()=>Response.json({kind:'public-profile',handle:'alice',owner:{id:'alice-id'},follow:{following:false,count:3},files:[],authed:false}));
  vi.stubGlobal('fetch',fetch);vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
  render(<MemoryRouter initialEntries={['/@alice/?tab=docs#second']}><RegionPage kind="follow" page="/@alice/" main="https://example.test"/></MemoryRouter>);
  await screen.findByLabelText('Follow');
  expect(fetch).toHaveBeenCalledWith('/api/page/profile/%40alice',expect.anything());
  expect(new URL(screen.getByLabelText('Follow').getAttribute('href')!,location.origin).searchParams.get('callbackUrl')).toBe('/@alice/?tab=docs#second');
});
it('reports a failed profile read so the parent can offer retry immediately',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:503})));
  const post=vi.spyOn(window.parent,'postMessage');
  render(<MemoryRouter><RegionPage kind="follow" page="/@alice" main="https://example.test"/></MemoryRouter>);
  await waitFor(()=>expect(post).toHaveBeenCalledWith({type:'mx:region:failed'},'https://example.test'));
});
