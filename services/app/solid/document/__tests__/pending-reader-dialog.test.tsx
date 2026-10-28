/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@solidjs/testing-library';
import {createSignal,lazy,Show,Suspense} from 'solid-js';
import {afterEach,expect,it} from 'vitest';
import {PendingReaderDialog} from '../PendingReaderDialog';
import {Dialog} from '../../ui/Dialog';
afterEach(cleanup);
function fixture(){
 let resolve!:()=>void;
 const Ready=lazy(()=>new Promise<{default:()=>ReturnType<typeof Dialog>}>(done=>{resolve=()=>done({default:()=> <Dialog title="Loaded sharing" onClose={()=>setOpen(false)}><input aria-label="Invite"/></Dialog>});}));
 const [open,setOpen]=createSignal(false);
 render(()=><><button onClick={()=>setOpen(true)}>Share</button><Show when={open()}><Suspense fallback={<PendingReaderDialog title="Share artifact" onClose={()=>setOpen(false)}/>}><Ready/></Suspense></Show></>);
 const opener=screen.getByRole('button',{name:'Share'});opener.focus();fireEvent.click(opener);
 return {opener,resolve:()=>resolve()};
}
it('shows loading and lets Escape cancel before download finishes without reopening on late completion',async()=>{
 const {opener,resolve}=fixture();
 const dialog=await screen.findByRole('dialog',{name:'Share artifact'});
 expect(within(dialog).getByRole('status')).toHaveTextContent('Loading');
 expect(within(dialog).getByRole('button',{name:'Cancel'})).toHaveFocus();
 fireEvent.keyDown(window,{key:'Escape'});
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(opener).toHaveFocus();
 resolve();await Promise.resolve();await Promise.resolve();
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('hands focus to the loaded dialog and preserves cancellation there',async()=>{
 const {resolve,opener}=fixture();await screen.findByRole('dialog',{name:'Share artifact'});resolve();
 await screen.findByRole('dialog',{name:'Loaded sharing'});
 await waitFor(()=>expect(screen.getByRole('textbox',{name:'Invite'})).toHaveFocus());
 fireEvent.keyDown(window,{key:'Escape'});expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(opener).toHaveFocus();
});
