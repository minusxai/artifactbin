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
it('shows account chunk loading, exposes failure, retries, and clears loading on logout while pending',async()=>{
 let finish!:(module:Awaited<ReturnType<InboxControllerLoader>>)=>void;
 let reject!:(error:Error)=>void;let inbox!:InboxContext;
 const create=vi.fn<(owner:()=>string|null)=>InboxContext>(()=>value);
 const load=vi.fn(()=>new Promise<Awaited<ReturnType<InboxControllerLoader>>>((resolve,fail)=>{finish=resolve;reject=fail;}));
 function Child(){inbox=useInbox();return <p>{inbox.loading()?'Loading':inbox.error()||'Idle'}</p>;}
 setSession({kind:'account',user:{id:'owner'}});
 render(()=><InboxProvider loadController={load}><Child/></InboxProvider>);
 expect(screen.getByText('Loading')).toBeTruthy();reject(new Error('chunk unavailable'));
 await screen.findByText('Could not load notifications. Try again.');expect(inbox.loading()).toBe(false);
 const retry=inbox.load();expect(load).toHaveBeenCalledTimes(2);expect(inbox.loading()).toBe(true);
 setSession({kind:'none',user:null});expect(inbox.loading()).toBe(false);
 finish({createInboxController:create});await retry;
 expect(create.mock.calls[0][0]()).toBeNull();expect(inbox.state()).toBeNull();expect(inbox.loading()).toBe(false);
});
