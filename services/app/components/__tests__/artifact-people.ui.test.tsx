import {PeopleInbox} from '../PeopleInbox';
import MarkdownLite from '../MarkdownLite';
import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {ArtifactPeople} from '../ArtifactPeople';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('shows a pending request without suggesting comment access is blocked',async()=>{
 const state={members:[],pending:[],self:null,canManage:false,canInvite:true};
 const fetch=vi.fn(async(_url:string,opts?:RequestInit)=>new Response(JSON.stringify(opts?.method==='POST'?{...state,self:{status:'pending',direction:'request',user_id:'reader'}}:state)));
 vi.stubGlobal('fetch',fetch);render(<ArtifactPeople artifactId="abc123"/>);
 fireEvent.click(screen.getByRole('button',{name:'People'}));
 fireEvent.click(await screen.findByRole('button',{name:'Request to join'}));
 await screen.findByText('Waiting for an owner or editor to approve.');
 expect(screen.getByText('Comment access does not depend on joining.')).toBeInTheDocument();
 await waitFor(()=>expect(fetch.mock.calls.some(([,o])=>o?.body===JSON.stringify({action:'join'}))).toBe(true));
});
it('offers explicit access sharing and unrestricted invitation lookup',async()=>{
 const state={members:[],pending:[],self:null,canManage:true,canInvite:true};
 const fetch=vi.fn(async(url:string,_opts?:RequestInit)=>new Response(JSON.stringify(url.includes('?')?{people:[{user_id:'u1',username:'alex',name:'Alex'}]}:state)));
 vi.stubGlobal('fetch',fetch);render(<ArtifactPeople artifactId="abc123"/>);
 fireEvent.click(screen.getByRole('button',{name:'People'}));
 fireEvent.click(await screen.findByRole('button',{name:'Invite @alex'}));
 fireEvent.click(screen.getByLabelText('Include viewing access'));
 fireEvent.click(screen.getByRole('button',{name:'Invite 1 people'}));
 await waitFor(()=>expect(fetch.mock.calls.some(([,o])=>o?.body===JSON.stringify({action:'invite',usernames:['@alex'],includeAccess:true}))).toBe(true));
 expect(fetch.mock.calls.some(([url])=>url.includes('purpose=invite'))).toBe(true);
});

it('accepts an invitation directly from its notification',async()=>{
 const inbox={autoAccept:true,blocks:[],notifications:[{id:'n1',artifact_id:'abc123',user_id:'alex',sender_id:'sam',username:'sam',kind:'invitation',status:'pending',direction:'invitation',title:'Tasks',read_at:null,source:null}]};
 const fetch=vi.fn(async(url:string,_options?:RequestInit)=>{if(url.includes('/members'))inbox.notifications[0].status='accepted';return new Response(JSON.stringify(url.includes('/members')?{}:inbox));});
 vi.stubGlobal('fetch',fetch);render(<PeopleInbox/>);
 fireEvent.click(await screen.findByRole('button',{name:'Accept invitation'}));
 await waitFor(()=>expect(fetch.mock.calls.some(([url,o])=>url.endsWith('/abc123/members')&&o?.body===JSON.stringify({action:'accept'}))).toBe(true));
 expect(await screen.findByText('Accepted — you’ve joined this artefact.')).toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Open artefact'}).getAttribute('href')).toBe('/a/abc123');
 expect(screen.getByRole('button',{name:'Block @sam'})).not.toBeVisible();
});
it('shows a pending mention next to its stable person link',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({mentions:{usr_alex:'pending'}}))));
 render(<MarkdownLite artifactId="abc123" text="[@alex](/people/usr_alex)"/>);
 expect(await screen.findByText('· Pending')).toBeInTheDocument();
 expect(screen.getByRole('link',{name:/@alex/}).getAttribute('href')).toBe('/people/usr_alex');
});

it('does not crash on a malformed membership response',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({visibility:'public'}))));
 render(<ArtifactPeople artifactId="abc123"/>);
 fireEvent.click(screen.getByRole('button',{name:'People'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Could not load people');
});

it('opens a pending invitation at its destination without an extra People click',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({members:[],pending:[],self:{status:'pending',direction:'invitation'},canManage:false,canInvite:false}))));
 render(<ArtifactPeople artifactId="abc123" initialOpen/>);
 expect(await screen.findByRole('button',{name:'Accept invitation'})).toBeVisible();
});
