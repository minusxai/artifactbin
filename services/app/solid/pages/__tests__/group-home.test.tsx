/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createMemoryHistory, MemoryRouter, Route } from '@solidjs/router';
import { afterEach, expect, it, vi } from 'vitest';
import { DefaultDestinationControl } from '../../components/DefaultDestinationControl';
import { HomePage } from '../Home';
import { CompanySetup } from '../CompanySetup';
import { SessionProvider } from '../../lib/session';
const session={kind:'account',user:{id:'u1',email:'viewer@example.com'},onboarded:true};
const group={id:'g1',handle:'team',name:'Team',description:'',role:'viewer'};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function open(){render(()=> <MemoryRouter><Route path="*" component={()=> <SessionProvider><HomePage/></SessionProvider>}/></MemoryRouter>);}
const publicDeployment={mode:'public',setup_complete:true,is_owner:false,default_group:null};
const emptyShelf={artifacts:[],shared:[]};
const insights={signedIn:true,accountId:'u1',stats:{assets:0},views:{},viewsOverTime:[],likes:0,likesOverTime:[],followers:0,forks:0};
/** Home's one request answers for the saved group (or its absence); everything else a group homepage must not ask for is a failure. */
function bootstrapOf(destination:unknown,preferences:unknown={default_destination:{type:'group',id:'g1'}},accountId='u1'){return Response.json({signedIn:true,accountId,deployment:publicDeployment,preferences,destination});}
const groupDestination={kind:'group',groupId:'g1',detail:{group,members:[],linked_groups:[]},core:emptyShelf};
const personalDestination={kind:'personal',core:emptyShelf};
function stub(unavailable=false){const fetcher=vi.fn(async(url:string)=>{
 if(url.includes('/session'))return Response.json(session);
 if(url.startsWith('/api/page/home?part=bootstrap'))return bootstrapOf(url.includes('personal=1')?personalDestination:unavailable?{kind:'unavailable',groupId:'g1'}:groupDestination);
 if(url.includes('part=insights'))return Response.json(insights);
 return Response.json({error:'not_found'},{status:404});
});vi.stubGlobal('fetch',fetcher);return fetcher;}
const requested=(fetcher:ReturnType<typeof stub>)=>fetcher.mock.calls.map(([url])=>String(url));
const deferred=()=>{let resolve!:(value:Response)=>void;const promise=new Promise<Response>(done=>{resolve=done;});return {promise,resolve};};
it('uses the default group shelf, links its handle to the group page, and hides write controls for viewers',async()=>{stub();open();expect(await screen.findByRole('heading',{name:'Team'})).toBeInTheDocument();expect(screen.getByRole('link',{name:'@team'})).toHaveAttribute('href','/@team');expect(screen.queryByRole('button',{name:'Create'})).toBeNull();expect(screen.queryByRole('button',{name:'Invite person'})).toBeNull();});
it('reaches the default group from one initial request: no preference, details or shelf waterfall, and no personal shelf',async()=>{
 const fetcher=stub();open();expect(await screen.findByRole('heading',{name:'Team'})).toBeInTheDocument();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Remove default'})).toBeEnabled());
 const urls=requested(fetcher).filter(url=>!url.includes('/session'));
 expect(urls).toEqual(['/api/page/home?part=bootstrap']);
});
it('shows one workspace skeleton, never a separate Home preference or group loading screen, until the bootstrap lands',async()=>{
 const pending=deferred();vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.includes('/session')?Response.json(session):pending.promise));
 open();
 expect(await screen.findByRole('status',{name:'Loading workspace'})).toHaveAttribute('aria-busy','true');
 expect(screen.getAllByRole('status')).toHaveLength(1);
 expect(screen.queryByText(/Loading Home preference/)).toBeNull();expect(screen.queryByText(/Loading group/)).toBeNull();
 pending.resolve(bootstrapOf(groupDestination));
 expect(await screen.findByRole('heading',{name:'Team'})).toBeInTheDocument();
 expect(screen.queryByRole('status',{name:'Loading workspace'})).toBeNull();
});
it('shows explicit Personal recovery for an inaccessible default and recovers when the group returns',async()=>{
 let available=false;
 const fetcher=vi.fn(async(url:string)=>url.includes('/session')?Response.json(session):bootstrapOf(available?groupDestination:{kind:'unavailable',groupId:'g1'}));vi.stubGlobal('fetch',fetcher);
 open();expect(await screen.findByRole('alert')).toHaveTextContent('This group is unavailable');
 expect(screen.getByRole('link',{name:'Open Personal'})).toHaveAttribute('href','/?personal=1');expect(screen.queryByRole('heading',{name:'Artifacts'})).toBeNull();
 expect(screen.queryByRole('heading',{name:'Team'})).toBeNull();
 available=true;fireEvent.click(screen.getByRole('button',{name:'Retry group'}));
 expect(await screen.findByRole('heading',{name:'Team'})).toBeInTheDocument();
});
it('recovers Personal with ?personal=1 in one request even though the saved group is unavailable',async()=>{
 const fetcher=stub(true);const history=createMemoryHistory();history.set({value:'/?personal=1',replace:true});
 render(()=> <MemoryRouter history={history}><Route path="*" component={()=> <SessionProvider><HomePage/></SessionProvider>}/></MemoryRouter>);
 expect(await screen.findByRole('heading',{name:/create your first artifact/i})).toBeInTheDocument();
 expect(screen.queryByText(/group is unavailable/i)).toBeNull();
 const choose=await screen.findByRole('button',{name:'Set Personal as default'});expect(choose).toBeEnabled();
 expect(requested(fetcher).filter(url=>/part=(bootstrap|core)|api\/me\/preferences|api\/groups/.test(url))).toEqual(['/api/page/home?part=bootstrap&personal=1']);
});
it('retries a failed bootstrap without exposing group details',async()=>{
 let fail=true;
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.includes('/session')?Response.json(session):fail?Response.json({},{status:503}):bootstrapOf(groupDestination)));
 open();const retry=await screen.findByRole('button',{name:'Retry workspace'});
 expect(screen.queryByRole('heading',{name:'Team'})).toBeNull();
 fail=false;fireEvent.click(retry);expect(await screen.findByRole('heading',{name:'Team'})).toBeInTheDocument();
});
it('never shows a group workspace resolved for another account',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.includes('/session')?Response.json(session):bootstrapOf(groupDestination,undefined,'someone-else')));
 open();expect(await screen.findByRole('button',{name:'Retry workspace'})).toBeInTheDocument();
 expect(screen.queryByRole('heading',{name:'Team'})).toBeNull();expect(screen.queryByText('Team')).toBeNull();
});
it('moves Home to Personal after the default group is removed, reading the destination again',async()=>{
 let saved=false;
 const fetcher=vi.fn(async(url:string,options?:RequestInit)=>{
  if(url.includes('/session'))return Response.json(session);
  if(url==='/api/me/preferences'&&options?.method==='PUT'){saved=true;return Response.json({default_destination:{type:'personal'}});}
  if(url.startsWith('/api/page/home?part=bootstrap'))return saved?bootstrapOf(personalDestination,{default_destination:{type:'personal'}}):bootstrapOf(groupDestination);
  if(url.includes('part=insights'))return Response.json(insights);
  return Response.json({error:'not_found'},{status:404});
 });vi.stubGlobal('fetch',fetcher);
 open();fireEvent.click(await screen.findByRole('button',{name:'Remove default'}));
 expect(await screen.findByRole('heading',{name:/create your first artifact/i})).toBeInTheDocument();
 expect(screen.queryByRole('heading',{name:'Team'})).toBeNull();
 expect(fetcher.mock.calls.filter(([url])=>String(url).startsWith('/api/page/home?part=bootstrap'))).toHaveLength(2);
});
it('requires explicit confirmation after selecting a company group',async()=>{
 const fetcher=vi.fn(async(url:string)=>Response.json(url==='/api/groups'?{groups:[{...group,role:'editor'}]}:{}));vi.stubGlobal('fetch',fetcher);const complete=vi.fn();
 render(()=> <CompanySetup deployment={{mode:'company',setup_complete:false,is_owner:true,default_group:null}} complete={complete}/>);
 await waitFor(()=>expect(fetcher).toHaveBeenCalledWith('/api/groups',expect.anything()));fireEvent.click(screen.getByRole('button',{name:'Company group'}));fireEvent.click(await screen.findByRole('option',{name:'Team'}));expect(screen.getByRole('button',{name:'Company group'})).toHaveTextContent('Team');expect(fetcher.mock.calls.filter(([url])=>url.includes('/setup'))).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'Confirm company setup'}));await waitFor(()=>expect(complete).toHaveBeenCalledOnce());expect(fetcher).toHaveBeenCalledWith('/api/deployment/setup',expect.objectContaining({method:'POST',body:JSON.stringify({group_id:'g1'})}));
});

it('shows the newly created company group when its option arrives after creation',async()=>{
 let release!:()=>void;
 const refreshed=new Promise<void>(resolve=>{release=resolve;});
 let reads=0;
 const fetcher=vi.fn(async(url:string,options?:RequestInit)=>{
  if(url==='/api/groups'&&options?.method==='POST')return Response.json({...group,role:'editor'},{status:201});
  if(url==='/api/groups'){
   if(++reads===1)return Response.json({groups:[]});
   await refreshed;
   return Response.json({groups:[{...group,role:'editor'}]});
  }
  return Response.json({});
 });
 vi.stubGlobal('fetch',fetcher);const complete=vi.fn();
 render(()=> <CompanySetup deployment={{mode:'company',setup_complete:false,is_owner:true,default_group:null}} complete={complete}/>);
 await waitFor(()=>expect(reads).toBe(1));
 fireEvent.input(screen.getByLabelText('Group name'),{target:{value:'Team'}});
 fireEvent.input(screen.getByLabelText('Group handle'),{target:{value:'team'}});
 fireEvent.submit(screen.getByRole('button',{name:'Create group'}).closest('form')!);
 await waitFor(()=>expect(reads).toBe(2));
 release();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Company group'})).toHaveTextContent('Team'));
 fireEvent.click(screen.getByRole('button',{name:'Company group'}));
 expect(screen.getByRole('option',{name:'Team'})).toHaveAttribute('aria-selected','true');
 fireEvent.keyDown(screen.getByRole('listbox'),{key:'Escape'});
 expect(complete).not.toHaveBeenCalled();
 expect(fetcher.mock.calls.filter(([url])=>url.includes('/setup'))).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'Confirm company setup'}));
 await waitFor(()=>expect(complete).toHaveBeenCalledOnce());
 expect(fetcher).toHaveBeenCalledWith('/api/deployment/setup',expect.objectContaining({body:JSON.stringify({group_id:'g1'})}));
});

it('retains explicit Personal recovery for an admitted account when the company default is deleted',async()=>{
 const company={mode:'company',setup_complete:false,is_owner:false,default_group:null};
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.includes('/session')?Response.json(session):url.includes('part=insights')?Response.json(insights):Response.json({signedIn:true,accountId:'u1',deployment:company,preferences:{default_destination:{type:'inherit'}},destination:url.includes('personal=1')?personalDestination:{kind:'setup'}})));
 const history=createMemoryHistory();history.set({value:'/?personal=1',replace:true});
 render(()=> <MemoryRouter history={history}><Route path="*" component={()=> <SessionProvider><HomePage/></SessionProvider>}/></MemoryRouter>);
 expect(await screen.findByRole('heading',{name:/create your first artifact/i})).toBeInTheDocument();
 expect(screen.queryByText('Your deployment owner needs to finish setup before you can continue.')).toBeNull();
 expect(screen.getByRole('link',{name:'Personal'})).toHaveAttribute('aria-current','page');
 expect(screen.getByRole('link',{name:'Artifacts'})).not.toHaveAttribute('aria-current');
});
it('keeps company setup for the owner and the recovery message for everyone else without a shelf',async()=>{
 for(const owner of [true,false]){
  const fetcher=vi.fn(async(url:string)=>url.includes('/session')?Response.json(session):Response.json({signedIn:true,accountId:'u1',deployment:{mode:'company',setup_complete:false,is_owner:owner,default_group:null},preferences:{default_destination:{type:'inherit'}},destination:{kind:'setup'}}));vi.stubGlobal('fetch',fetcher);
  const view=render(()=> <MemoryRouter><Route path="*" component={()=> <SessionProvider><HomePage/></SessionProvider>}/></MemoryRouter>);
  if(owner)expect(await screen.findByRole('button',{name:'Company group'})).toBeInTheDocument();
  else{expect(await screen.findByRole('alert')).toHaveTextContent('The company default group is unavailable');expect(screen.getByRole('link',{name:'Open Personal'})).toHaveAttribute('href','/?personal=1');}
  expect(fetcher.mock.calls.map(([url])=>String(url)).some(url=>url.includes('part=core'))).toBe(false);
  view.unmount();cleanup();
 }
});
it('sets a group default, shows the saved state, and lets the account return to Personal',async()=>{
 let destination:unknown={type:'personal'};
 const fetcher=vi.fn(async(url:string,options?:RequestInit)=>{
  if(url.includes('/session'))return Response.json(session);
  if(url==='/api/deployment')return Response.json({mode:'public',setup_complete:true,is_owner:false,default_group:null});
  if(url==='/api/me/preferences'){
   if(options?.method==='PUT')destination=JSON.parse(String(options.body)).default_destination;
   return Response.json({default_destination:destination});
  }
  return Response.json({});
 });vi.stubGlobal('fetch',fetcher);
 render(()=> <SessionProvider><DefaultDestinationControl group={{id:'g1',name:'Team'}}/></SessionProvider>);
 const setDefault=await screen.findByRole('button',{name:'Set as default'});
 await waitFor(()=>expect(setDefault).toBeEnabled());
 fireEvent.click(setDefault);
 expect(await screen.findByRole('button',{name:'Remove default'})).toBeInTheDocument();
 expect(destination).toEqual({type:'group',id:'g1'});
 fireEvent.click(screen.getByRole('button',{name:'Remove default'}));
 expect(await screen.findByRole('button',{name:'Set as default'})).toBeInTheDocument();
 expect(destination).toEqual({type:'personal'});
 expect(screen.getByRole('status')).toHaveTextContent('Personal is now your default');
});
it('lets an account override an inherited company default with Personal',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>Response.json(url.includes('/session')?session:url==='/api/deployment'?{mode:'company',setup_complete:true,is_owner:false,default_group:group}:options?.method==='PUT'?{default_destination:{type:'personal'}}:{default_destination:{type:'inherit'}})));
 render(()=> <SessionProvider><DefaultDestinationControl group={{id:'g1',name:'Team'}}/></SessionProvider>);
 fireEvent.click(await screen.findByRole('button',{name:'Remove default'}));
 await waitFor(()=>expect(fetch).toHaveBeenCalledWith('/api/me/preferences',expect.objectContaining({method:'PUT',body:JSON.stringify({default_destination:{type:'personal'}})})));
 expect(await screen.findByRole('button',{name:'Set as default'})).toBeInTheDocument();
});
it('keeps the saved default visible when removing it fails and permits retry',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>options?.method==='PUT'?Response.json({error:'Could not save preference'},{status:503}):Response.json(url.includes('/session')?session:url==='/api/deployment'?{mode:'public',setup_complete:true,is_owner:false,default_group:null}:{default_destination:{type:'group',id:'g1'}})));
 render(()=> <SessionProvider><DefaultDestinationControl group={{id:'g1',name:'Team'}}/></SessionProvider>);
 fireEvent.click(await screen.findByRole('button',{name:'Remove default'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
 expect(screen.getByRole('button',{name:'Remove default'})).toBeEnabled();
 expect(screen.queryByRole('button',{name:'Set as default'})).toBeNull();
});

it('lets phone users expand and close the workspace navigation',async()=>{
 stub();open();await screen.findByRole('heading',{name:'Team'});
 const toggle=screen.getByRole('button',{name:'Toggle navigation'});
 expect(toggle).toHaveAttribute('aria-expanded','false');
 fireEvent.click(toggle);expect(toggle).toHaveAttribute('aria-expanded','true');
 fireEvent.click(toggle);expect(toggle).toHaveAttribute('aria-expanded','false');
});

it('shows tokenless company setup to a signed-out visitor without private workspace data',async()=>{
 const visitor={kind:'none',user:null,onboarded:false};
 const deployment={mode:'company',setup_complete:true,is_owner:false,default_group:{...group,role:null}};
 const fetcher=vi.fn(async(url:string)=>url.includes('/session')?Response.json(visitor):Response.json({signedIn:false,deployment}));
 vi.stubGlobal('fetch',fetcher);open();
 expect(await screen.findByRole('heading',{name:'Set up this workspace'})).toBeInTheDocument();
 const command=screen.getByRole('button',{name:'Copy agent setup instructions'}).parentElement!.textContent!;
 expect(command).toContain(`${window.location.origin}/llms.txt`);
 expect(command).toContain(`${window.location.origin}/skills/artifactbin.zip`);
 expect(command).toContain('GET /api/groups/team');
 expect(command).toContain('PUT /api/me/preferences');
 expect(command).toContain('default_destination');
 expect(command).not.toMatch(/afbin |--set-default/);
 expect(screen.getByRole('link',{name:'Sign in'})).toHaveAttribute('href','/login');
 expect(screen.queryByRole('region',{name:'Group artifacts'})).toBeNull();
 expect(requested(fetcher).filter(url=>!url.includes('/session'))).toEqual(['/api/page/home?part=bootstrap']);
});
it('sets the deployment server before a company default group is confirmed',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.includes('/session')?Response.json({kind:'none',user:null,onboarded:false}):Response.json({signedIn:false,deployment:{mode:'company',setup_complete:false,is_owner:false,default_group:null}})));
 open();expect(await screen.findByRole('heading',{name:'Set up this workspace'})).toBeInTheDocument();
 const command=screen.getByRole('button',{name:'Copy agent setup instructions'}).parentElement!.textContent!;
 expect(command).toContain(`${window.location.origin}/llms.txt`);
 expect(command).toContain('GET /api/me/preferences');
 expect(command).not.toContain('GET /api/groups/');
 expect(screen.getByText(/owner must sign in and confirm/i)).toBeInTheDocument();
});
