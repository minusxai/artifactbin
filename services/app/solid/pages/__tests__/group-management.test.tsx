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
it.each([true,false])('shows the current tenancy and allows edits only for manual groups (host %s)',async host=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({})));
 render(()=> <GroupManagement detail={{...detail,group:{...detail.group,host_provisioned:host,tenancy_id:'tenant-a'}}} refresh={()=>{}}/>);
 if(host){
  expect(screen.getByText(/tenant-a · Managed by/)).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Save tenancy ID'})).not.toBeInTheDocument();
 }else{
  const field=screen.getByRole('textbox',{name:'Tenancy ID'});
  expect(field).toHaveValue('tenant-a');
  fireEvent.input(field,{target:{value:'tenant-b'}});
  fireEvent.click(screen.getByRole('button',{name:'Save tenancy ID'}));
  await waitFor(()=>expect(fetch).toHaveBeenCalledWith('/api/groups/g1',expect.objectContaining({method:'PATCH',body:JSON.stringify({tenancy_id:'tenant-b'})})));
 }
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
 const fetcher=stubFetch({'*/session*':{kind:'account',user:{id:'u1',email:'viewer@example.com'},onboarded:true},'*/allowed-addresses':{addresses:[]},'*/service-sign-ins':{approvals:[],services:[]},'*/sign-ins':{sign_ins:[]}},{fallback:()=>Response.json(detail)});
 render(()=> <MemoryRouter><Route path="*" component={()=> <SessionProvider><GroupSettingsPage identity="team"/></SessionProvider>}/></MemoryRouter>);
 expect(await screen.findByRole('heading',{name:'Group settings'})).toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Back to Team'})).toHaveAttribute('href','/@team');
 expect(screen.getByRole('searchbox',{name:'Search people'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Invite person'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Link group'})).toBeInTheDocument();
 // The group itself, its allowed addresses and (for an Admin) the agents and services signed in as it: never the shelf.
 expect(fetcher.mock.calls.map(([url])=>url).filter(url=>!url.includes('/session')).sort()).toEqual(['/api/groups/g1/allowed-addresses','/api/groups/g1/service-sign-ins','/api/groups/g1/sign-ins','/api/groups/team']);
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

it('shows an Admin the agents signed in as the group, with level and who signed each in, and revokes one after confirming; nothing for others',async()=>{
 const signIn={id:'tok_g1',name:'group-editor',role:'editor',issued_by:{id:'u2',username:'eve',name:'Eve'},created_at:'2026-11-11T10:00:00.000Z',expires_at:null,last_used_at:null,live:true};
 let held=[signIn];
 const fetcher=stubFetch({'DELETE *':()=>{held=[];return new Response(null,{status:204});}},{fallback:()=>Response.json({sign_ins:held})});
 const {GroupSignIns}=await import('../GroupSignIns');
 const view=render(()=> <GroupSignIns group={{id:'g1',name:'Team',role:'admin'}}/>);
 const panel=await screen.findByRole('region',{name:'Agents signed in as this group'});
 await waitFor(()=>expect(panel).toHaveTextContent('Signed in by Eve'));
 expect(panel).toHaveTextContent('editor');expect(panel).toHaveTextContent('Live');
 fireEvent.click(screen.getByRole('button',{name:'Revoke the sign-in by Eve (editor)'}));
 fireEvent.click(await screen.findByRole('button',{name:'Confirm revoke'}));
 await waitFor(()=>expect(panel).toHaveTextContent('No agent is signed in as this group.'));
 expect(fetcher).toHaveBeenCalledWith('/api/groups/g1/sign-ins/tok_g1',expect.objectContaining({method:'DELETE'}));
 view.unmount();
 const quiet=vi.fn(async()=>Response.json({sign_ins:[]}));
 vi.stubGlobal('fetch',quiet);
 for(const role of ['member','editor'] as const){
  const other=render(()=> <GroupSignIns group={{id:'g1',name:'Team',role}}/>);
  expect(other.queryByRole('region',{name:'Agents signed in as this group'})).toBeNull();
  other.unmount();
 }
 expect(quiet).not.toHaveBeenCalled();
});

it('shows a service\'s sign-ins as one row per approval with their count, revoking the approval, and people\'s a page at a time',async()=>{
 const person=(id:string,name:string)=>({id,name:'group-editor',role:'editor',issued_by:{id:'u_'+id,username:name.toLowerCase(),name},created_at:'2026-11-11T10:00:00.000Z',expires_at:null,last_used_at:null,live:true});
 let services=[{grant_id:'sgg_1',service_id:'warehouse',role:'member',count:40,last_issued_at:'2026-11-12T10:00:00.000Z',approved_at:'2026-11-01T10:00:00.000Z'}];
 const fetcher=stubFetch({'DELETE *':()=>{services=[];return new Response(null,{status:204});},
  '*/sign-ins?cursor=c2':{sign_ins:[person('tok_3','Cy')],next_cursor:null,services}},
  {fallback:()=>Response.json({sign_ins:[person('tok_1','Ann'),person('tok_2','Bo')],next_cursor:'c2',services})});
 const {GroupSignIns}=await import('../GroupSignIns');
 const view=render(()=> <GroupSignIns group={{id:'g1',name:'Team',role:'admin'}}/>);
 const panel=await screen.findByRole('region',{name:'Agents signed in as this group'});
 await waitFor(()=>expect(panel).toHaveTextContent('Signed in by service warehouse'));
 expect(panel).toHaveTextContent('40 sign-ins');expect(panel).toHaveTextContent('Signed in by Bo');
 expect(panel).not.toHaveTextContent('Signed in by Cy');
 fireEvent.click(screen.getByRole('button',{name:'Show more sign-ins'}));
 await waitFor(()=>expect(panel).toHaveTextContent('Signed in by Cy'));
 expect(fetcher).toHaveBeenCalledWith('/api/groups/g1/sign-ins?cursor=c2',expect.anything());
 expect(screen.queryByRole('button',{name:'Show more sign-ins'})).toBeNull();
 // Revoking the service's row revokes its approval, which ends all of them.
 fireEvent.click(screen.getByRole('button',{name:'Revoke the approval of warehouse (member)'}));
 expect(await screen.findByRole('dialog')).toHaveTextContent('all 40 of its sign-ins (member) stop on their next request');
 fireEvent.click(screen.getByRole('button',{name:'Confirm revoke'}));
 await waitFor(()=>expect(fetcher).toHaveBeenCalledWith('/api/groups/g1/service-sign-ins/sgg_1',expect.objectContaining({method:'DELETE'})));
 await waitFor(()=>expect(panel).not.toHaveTextContent('Signed in by service warehouse'));
 view.unmount();
});

it('shows an Admin the services approved to act as the group, says plainly what approving one allows, and revokes',async()=>{
 let approvals=[{id:'sgg_1',service_id:'warehouse',role:'member',approved_by:{id:'u1',username:'ada',name:'Ada'},created_at:'2026-11-11T10:00:00.000Z'}];
 const fetcher=stubFetch({'POST *':()=>{approvals=[...approvals,{id:'sgg_2',service_id:'crm',role:'editor',approved_by:{id:'u1',username:'ada',name:'Ada'},created_at:'2026-11-12T10:00:00.000Z'}];return Response.json({id:'sgg_2'},{status:201});},
  'DELETE *':()=>{approvals=approvals.filter(a=>a.id!=='sgg_1');return new Response(null,{status:204});}},
  {fallback:()=>Response.json({approvals,services:[{id:'crm',origin:'https://crm.example.com'},{id:'warehouse',origin:'https://warehouse.example.com'}]})});
 const {GroupServiceSignIns}=await import('../GroupServiceSignIns');
 const view=render(()=> <GroupServiceSignIns group={{id:'g1',name:'Team',role:'admin'}}/>);
 const panel=await screen.findByRole('region',{name:'Services that may act as this group'});
 await waitFor(()=>expect(panel).toHaveTextContent('warehouse'));
 expect(panel).toHaveTextContent('Approved by Ada');
 // Approving says what the service will be able to do, before anything is sent.
 fireEvent.click(screen.getByRole('button',{name:'Approve service'}));
 const dialog=await screen.findByRole('dialog');
 expect(dialog).toHaveTextContent('crm will be able to sign an agent in as Team at member level, with nobody present');
 expect(dialog).toHaveTextContent("cannot reach anyone's personal pages");
 fireEvent.click(screen.getByRole('button',{name:'Confirm approve'}));
 await waitFor(()=>expect(fetcher).toHaveBeenCalledWith('/api/groups/g1/service-sign-ins',expect.objectContaining({method:'POST',body:JSON.stringify({service_id:'crm',role:'member'})})));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 await waitFor(()=>expect(screen.getByRole('button',{name:'Revoke warehouse (member)'})).not.toBeDisabled());
 fireEvent.click(screen.getByRole('button',{name:'Revoke warehouse (member)'}));
 fireEvent.click(await screen.findByRole('button',{name:'Confirm revoke'}));
 await waitFor(()=>expect(fetcher).toHaveBeenCalledWith('/api/groups/g1/service-sign-ins/sgg_1',expect.objectContaining({method:'DELETE'})));
 view.unmount();
 const quiet=vi.fn(async()=>Response.json({approvals:[],services:[]}));
 vi.stubGlobal('fetch',quiet);
 const other=render(()=> <GroupServiceSignIns group={{id:'g1',name:'Team',role:'editor'}}/>);
 expect(other.queryByRole('region',{name:'Services that may act as this group'})).toBeNull();
 expect(quiet).not.toHaveBeenCalled();
});

it.each(['admin','member'] as const)('explains issuer-managed membership to a %s and omits the invite form',(role)=>{
 render(()=> <GroupManagement detail={{...detail,group:{...detail.group,role,host_provisioned:true}}} refresh={()=>{}} />);
 expect(screen.getByText('The sign-in provider decides who can join this group.')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Invite person'})).not.toBeInTheDocument();
});
