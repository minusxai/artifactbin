/* @jsxImportSource solid-js */
import {render,screen,fireEvent,waitFor} from '@solidjs/testing-library';
import {MemoryRouter,Route} from '@solidjs/router';
import {expect,it,vi} from 'vitest';
import {LocalDocumentPage} from '../LocalDocument';
const broker=vi.hoisted(()=>({authorize:vi.fn(),signIn:vi.fn(),resize:vi.fn(),post:vi.fn(),disconnect:vi.fn(),retry:vi.fn(),dispose:vi.fn()}));
vi.mock('@/lib/local-connection/broker',()=>({installLocalConnectionBroker(options:any){options.onIdentity?.({platformOrigin:'https://platform.example',artifactId:'p',baseRevision:'1',sourceDigest:'a'.repeat(64)});options.onState('permission-required');return broker;}}));
it('uses platform chrome and asks explicit permission without a destination editor',async()=>{
 render(()=><MemoryRouter><Route path="/" component={LocalDocumentPage}/></MemoryRouter>);
 fireEvent.click(await screen.findByRole('button',{name:'Connect this file'}));
 expect(broker.authorize).toHaveBeenCalledOnce();
 expect(screen.queryByRole('textbox')).toBeNull();
 expect(screen.getByRole('button',{name:'Save linked HTML'})).toBeTruthy();
 await waitFor(()=>expect(broker.resize).toHaveBeenCalled());
});
