/* @jsxImportSource solid-js */
import {cleanup,render,screen,waitFor} from '@solidjs/testing-library';
import {createSignal} from 'solid-js';
import {afterEach,expect,it,vi} from 'vitest';
import {InboxProvider,useInbox,type InboxContext,type InboxControllerLoader} from '../notifications';
const [session,setSession]=createSignal<{kind:'account'|'none';user:{id:string}|null}>({kind:'none',user:null});
vi.mock('../session',()=>({useSession:()=>({session})}));
afterEach(()=>{cleanup();setSession({kind:'none',user:null});});
const value:InboxContext={state:()=>null,error:()=>'',failedAt:()=>null,loading:()=>false,reconnecting:()=>false,load:async()=>{},loadMore:async()=>{}};
it('keeps anonymous readers out of the account inbox and preserves the mounted child on identity changes',async()=>{
 const create=vi.fn<(owner:()=>string|null)=>InboxContext>(()=>value),load=vi.fn(async()=>({createInboxController:create}));let mounted=0;
 function Child(){mounted++;const inbox=useInbox();return <p>{inbox.loading()?'Loading':'Reader'}</p>;}
 render(()=><InboxProvider loadController={load}><Child/></InboxProvider>);
 expect(screen.getByText('Reader')).toBeTruthy();expect(load).not.toHaveBeenCalled();
 setSession({kind:'account',user:{id:'owner'}});
 await waitFor(()=>expect(create).toHaveBeenCalledTimes(1));
 const owner=create.mock.calls[0][0];expect(owner()).toBe('owner');
 setSession({kind:'account',user:{id:'other'}});expect(owner()).toBe('other');
 setSession({kind:'none',user:null});expect(owner()).toBeNull();
 expect(load).toHaveBeenCalledTimes(1);expect(mounted).toBe(1);
});
it('does not create live subscriptions after the provider was disposed while its chunk loaded',async()=>{
 let finish!:(module:Awaited<ReturnType<InboxControllerLoader>>)=>void;
 const create=vi.fn(()=>value);const load=()=>new Promise<Awaited<ReturnType<InboxControllerLoader>>>(resolve=>{finish=resolve;});
 setSession({kind:'account',user:{id:'owner'}});
 const page=render(()=><InboxProvider loadController={load}><p>Reader</p></InboxProvider>);
 page.unmount();finish({createInboxController:create});await Promise.resolve();
 expect(create).not.toHaveBeenCalled();
});
