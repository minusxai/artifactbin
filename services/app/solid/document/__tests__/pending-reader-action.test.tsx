/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@solidjs/testing-library';
import {createSignal,lazy,Show,Suspense,type Component} from 'solid-js';
import {afterEach,expect,it,vi} from 'vitest';
import {PendingReaderAction} from '../PendingReaderAction';
afterEach(cleanup);
it('keeps the action visible while loading and transfers focused keyboard intent without copying early',async()=>{
 let resolve!:()=>void; const copy=vi.fn();
 const Ready=lazy(()=>new Promise<{default:Component}>(done=>{resolve=()=>done({default:()=> <button aria-label="Copy for agent" onClick={copy}>Copy</button>});}));
 render(()=><Suspense fallback={<PendingReaderAction label="Loading agent handoff" readyLabel="Copy for agent"/>}><Ready/></Suspense>);
 const pending=screen.getByRole('button',{name:'Loading agent handoff'});
 expect(pending).toHaveAttribute('aria-busy','true');pending.focus();fireEvent.click(pending);expect(copy).not.toHaveBeenCalled();
 resolve();const ready=await screen.findByRole('button',{name:'Copy for agent'});
 await waitFor(()=>expect(ready).toHaveFocus());fireEvent.click(ready);expect(copy).toHaveBeenCalledOnce();
});
it('does not take focus away when the reader moved to another control',async()=>{
 let resolve!:()=>void;
 const Ready=lazy(()=>new Promise<{default:Component}>(done=>{resolve=()=>done({default:()=> <button aria-label="Copy for agent">Copy</button>});}));
 render(()=><><button>Another action</button><Suspense fallback={<PendingReaderAction label="Loading agent handoff" readyLabel="Copy for agent"/>}><Ready/></Suspense></>);
 const other=screen.getByRole('button',{name:'Another action'});other.focus();resolve();await screen.findByRole('button',{name:'Copy for agent'});expect(other).toHaveFocus();
});
it('does not override a newer focus choice queued during the loading handoff',async()=>{
 let resolve!:()=>void;
 const Ready=lazy(()=>new Promise<{default:Component}>(done=>{resolve=()=>done({default:()=> <button aria-label="Copy for agent">Copy</button>});}));
 render(()=><><button>Another action</button><Suspense fallback={<PendingReaderAction label="Loading agent handoff" readyLabel="Copy for agent"/>}><Ready/></Suspense></>);
 const pending=screen.getByRole('button',{name:'Loading agent handoff'});pending.focus();
 const other=screen.getByRole('button',{name:'Another action'});
 // Resolving the chunk queues its render; the reader's subsequent focus must win over cleanup handoff.
 resolve();queueMicrotask(()=>other.focus());await screen.findByRole('button',{name:'Copy for agent'});
 await waitFor(()=>expect(other).toHaveFocus());
});
it('respects newer focus outside the trusted shadow root during handoff',async()=>{
 const [ready,setReady]=createSignal(false);
 const host=document.createElement('div');document.body.append(host);
 const shadow=host.attachShadow({mode:'open'}),container=document.createElement('div');shadow.append(container);
 const outside=document.createElement('button');outside.textContent='Outside action';document.body.append(outside);
 const page=render(()=><Show when={ready()} fallback={<PendingReaderAction label="Loading agent handoff" readyLabel="Copy for agent"/>}><button aria-label="Copy for agent">Copy</button></Show>,{container});
 const pending=shadow.querySelector<HTMLButtonElement>('button')!;pending.focus();expect(shadow.activeElement).toBe(pending);
 // Replace the control synchronously, then move focus before its cleanup microtask runs.
 setReady(true);outside.focus();await Promise.resolve();
 expect(outside).toHaveFocus();expect(shadow.activeElement).toBeNull();
 page.unmount();host.remove();outside.remove();
});
