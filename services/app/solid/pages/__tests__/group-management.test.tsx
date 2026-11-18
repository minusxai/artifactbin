/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route } from '@solidjs/router';
import { SessionProvider } from '../../lib/session';
import { GroupManagement, GroupSettingsPage } from '../Group';
import { stubFetch } from '@/test/helpers/fetch-stub';
const detail = {group:{id:'g1',handle:'team',name:'Team',description:'',role:'admin' as const},members:[{user_id:'u1',username:'alice',name:'Alice',role:'admin' as const}],linked_groups:[],invitations:[],parent:null,subgroups:[],subgroup_audience:[]};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it.each(['member','editor'] as const)('%s can search people without management controls',(role)=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({members:[]})));
 render(()=> <GroupManagement detail={{...detail,group:{...detail.group,role}}} refresh={()=>{}} />);
 expect(screen.getByRole('link',{name:'Alice'})).toHaveAttribute('href','/@alice');
 fireEvent.input(screen.getByRole('searchbox',{name:'Search people'}),{target:{value:'missing'}});
 expect(screen.queryByRole('link',{name:'Alice'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Invite person'})).not.toBeInTheDocument();
});
it('keeps last-admin refusal visible and preserves member role',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'last_admin'},{status:409})));
 render(()=> <GroupManagement detail={detail} refresh={()=>{}} />);
 fireEvent.click(screen.getByRole('button',{name:'Role for Alice'}));
 fireEvent.click(screen.getByRole('option',{name:'Member'}));
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Keep at least one admin'));
 expect(screen.getByRole('button',{name:'Role for Alice'})).toHaveTextContent('Admin');
 expect(fetch).toHaveBeenCalledWith('/api/groups/g1/members/u1',expect.objectContaining({method:'PUT',body:JSON.stringify({role:'member'})}));
});

it('an admin through a parent group manages people and is told where the authority comes from, without being listed',()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({members:[]})));
 render(()=> <GroupManagement detail={{...detail,admin_via:{id:'g0',handle:'company',name:'Company'}}} refresh={()=>{}} />);
 expect(screen.getByText(/You are an admin here through/)).toHaveTextContent('You are an admin here through Company, a parent group. You are not a member of Team.');
 expect(screen.getByRole('link',{name:'Company'})).toHaveAttribute('href','/@company');
 expect(screen.getByRole('button',{name:'Invite person'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Role for Alice'})).toBeInTheDocument();
});
it('says nothing about a parent group to a direct admin',()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({members:[]})));
 render(()=> <GroupManagement detail={detail} refresh={()=>{}} />);
 expect(screen.queryByText(/through/)).not.toBeInTheDocument();
});

it('finds a server search result outside the initially loaded people',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({members:[{user_id:'u200',username:'zoe',name:'Zoe',role:'member'}]})));
 render(()=> <GroupManagement detail={detail} refresh={()=>{}}/>);
 fireEvent.input(screen.getByRole('searchbox',{name:'Search people'}),{target:{value:'Zoe'}});
 expect(await screen.findByRole('link',{name:'Zoe'})).toHaveAttribute('href','/@zoe');
 expect(screen.getByRole('button',{name:'Role for Zoe'})).toHaveTextContent('Member');
 expect(fetch).toHaveBeenCalledWith('/api/groups/g1/members?query=Zoe',expect.objectContaining({credentials:'same-origin'}));
});

it('loads group settings without requesting the artifact shelf',async()=>{
 const fetcher=stubFetch({'*/session*':{kind:'account',user:{id:'u1',email:'viewer@example.com'},onboarded:true},'*/allowed-addresses':{addresses:[]}},{fallback:()=>Response.json(detail)});
 render(()=> <MemoryRouter><Route path="*" component={()=> <SessionProvider><GroupSettingsPage identity="team"/></SessionProvider>}/></MemoryRouter>);
 expect(await screen.findByRole('heading',{name:'Group settings'})).toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Back to Team'})).toHaveAttribute('href','/@team');
 expect(screen.getByRole('searchbox',{name:'Search people'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Invite person'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Link group'})).toBeInTheDocument();
 // The group itself and its allowed addresses: never the artifact shelf.
 expect(fetcher.mock.calls.map(([url])=>url).filter(url=>!url.includes('/session')).sort()).toEqual(['/api/groups/g1/allowed-addresses','/api/groups/team']);
 expect(fetcher).toHaveBeenCalledWith('/api/groups/team',expect.anything());
});

it('lists the group\'s allowed addresses, lets an editor remove one, and draws nothing when approvals are off',async()=>{
 const address={directive:'connect',host:'https://api.example.com',approved_by:{id:'u1',username:'alice',name:'Alice'},approved_at:'2026-11-11T10:00:00.000Z'};
 let held=[address];
 const fetcher=stubFetch({'DELETE *':()=>{held=[];return Response.json({changed:{connect:['https://api.example.com']},addresses:[]});}},{fallback:()=>Response.json({addresses:held})});
 const {GroupAddresses}=await import('../GroupAddresses');
 const view=render(()=> <GroupAddresses group={{id:'g1',name:'Team',role:'admin'}}/>);
 const panel=await screen.findByRole('region',{name:'Allowed addresses'});
 await waitFor(()=>expect(panel).toHaveTextContent('api.example.com'));
 expect(panel).toHaveTextContent('Data');expect(panel).toHaveTextContent('Approved by Alice');
 fireEvent.click(screen.getByRole('button',{name:'Remove https://api.example.com (Data)'}));
 await waitFor(()=>expect(panel).toHaveTextContent('No addresses approved yet'));
 expect(fetcher).toHaveBeenCalledWith('/api/groups/g1/allowed-addresses',expect.objectContaining({method:'DELETE',body:JSON.stringify({connect:['https://api.example.com']})}));
 view.unmount();
 const disabled=vi.fn(async(_url:string,_init?:RequestInit)=>Response.json({error:'group_approvals_disabled'},{status:403}));
 vi.stubGlobal('fetch',disabled);
 const off=render(()=> <GroupAddresses group={{id:'g8',name:'Off',role:'admin'}}/>);
 // Wait for the refusal to be answered and handled before saying nothing was drawn.
 await waitFor(()=>expect(disabled).toHaveBeenCalledWith('/api/groups/g8/allowed-addresses',expect.anything()));
 await new Promise(resolve=>setTimeout(resolve,0));
 expect(off.queryByRole('region',{name:'Allowed addresses'})).toBeNull();
});
