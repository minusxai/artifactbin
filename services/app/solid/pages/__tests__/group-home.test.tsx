/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { MemoryRouter, Route } from '@solidjs/router';
import { afterEach, expect, it, vi } from 'vitest';
import { HomePage } from '../Home';
import { CompanySetup } from '../CompanySetup';
import { SessionProvider } from '../../lib/session';
const session={kind:'account',user:{id:'u1',email:'viewer@example.com'},onboarded:true};
const group={id:'g1',handle:'team',name:'Team',description:'',role:'viewer'};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function open(){render(()=> <MemoryRouter><Route path="*" component={()=> <SessionProvider><HomePage/></SessionProvider>}/></MemoryRouter>);}
function stub(unavailable=false){vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
 if(url.includes('/session'))return Response.json(session);
 if(url==='/api/deployment')return Response.json({mode:'public',setup_complete:true,is_owner:false,default_group:null});
 if(url==='/api/me/preferences')return Response.json({default_destination:{type:'group',id:'g1'}});
 if(url==='/api/groups/g1')return unavailable?Response.json({error:'not_found'},{status:404}):Response.json({group,members:[],linked_groups:[]});
 return Response.json({signedIn:true,accountId:'u1',artifacts:[],shared:[]});
}));}
it('uses the default group shelf and hides write controls for viewers',async()=>{stub();open();expect(await screen.findByRole('heading',{name:'Team'})).toBeInTheDocument();await waitFor(()=>expect(fetch).toHaveBeenCalledWith('/api/page/home?part=core&groupId=g1',expect.anything()));expect(screen.queryByRole('button',{name:'Create'})).toBeNull();expect(screen.queryByRole('button',{name:'Invite person'})).toBeNull();});
it('shows explicit Personal recovery for an inaccessible default',async()=>{stub(true);open();expect(await screen.findByRole('alert')).toHaveTextContent('This group is unavailable');expect(screen.getByRole('link',{name:'Open Personal'})).toHaveAttribute('href','/?personal=1');expect(screen.queryByRole('heading',{name:'Artifacts'})).toBeNull();});
it('requires explicit confirmation after selecting a company group',async()=>{
 const fetcher=vi.fn(async(url:string)=>Response.json(url==='/api/groups'?{groups:[{...group,role:'editor'}]}:{}));vi.stubGlobal('fetch',fetcher);const complete=vi.fn();
 render(()=> <CompanySetup deployment={{mode:'company',setup_complete:false,is_owner:true,default_group:null}} complete={complete}/>);
 await screen.findByRole('option',{name:'Team'});fireEvent.change(screen.getByRole('combobox',{name:'Company group'}),{target:{value:'g1'}});expect(fetcher.mock.calls.filter(([url])=>url.includes('/setup'))).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'Confirm company setup'}));await waitFor(()=>expect(complete).toHaveBeenCalledOnce());expect(fetcher).toHaveBeenCalledWith('/api/deployment/setup',expect.objectContaining({method:'POST',body:JSON.stringify({group_id:'g1'})}));
});
