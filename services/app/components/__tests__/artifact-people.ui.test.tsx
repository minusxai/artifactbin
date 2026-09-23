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
