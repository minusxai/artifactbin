/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,within} from '@solidjs/testing-library';
import {afterEach,expect,it,vi} from 'vitest';
import ReaderGroupNotice from '../ReaderGroupNotice';
import {ReaderNotice} from '../ReaderNotice';
afterEach(cleanup);
it('shows loading, handles failed downloads explicitly, and retries to the real notice',async()=>{
 const load=vi.fn<()=>Promise<typeof import('../ScriptFailureNotice')>>().mockRejectedValueOnce(new Error('download failed')).mockImplementation(()=>import('../ScriptFailureNotice'));
 render(()=><ReaderNotice label="Page script error" load={load}>{module=><module.ScriptFailureNotice errors={['A stored diagnostic']}/>}</ReaderNotice>);
 expect(screen.getByRole('status')).toHaveTextContent('Loading page script error');
 expect(await screen.findByRole('alert')).toHaveTextContent('Could not load page script error');
 fireEvent.click(screen.getByRole('button',{name:'Retry'}));
 expect(await screen.findByText('A stored diagnostic')).toBeInTheDocument();expect(load).toHaveBeenCalledTimes(2);
});
it('does not render a late notice after the requested notice unmounts',async()=>{
 let resolve!:(module:typeof import('../ScriptFailureNotice'))=>void;
 const load=()=>new Promise<typeof import('../ScriptFailureNotice')>(done=>{resolve=done;});
 const page=render(()=><ReaderNotice label="Page script error" load={load}>{module=><module.ScriptFailureNotice errors={['Late diagnostic']}/>}</ReaderNotice>);
 page.unmount();resolve(await import('../ScriptFailureNotice'));await Promise.resolve();expect(screen.queryByText('Late diagnostic')).toBeNull();
});

it.each([false,true])('labels the explicit group action according to eligibility (request only %s)', requestAccess => {
 const switchGroup=vi.fn();
 render(()=><ReaderGroupNotice slot={document.body} scope={{requestAccess,user:'reader',group:'a',name:'Analytics',choices:[{id:'b',name:'Operations'}]}} switchGroup={switchGroup}/>);
 const notice=within(document.querySelector('[data-trusted-ui]')!.shadowRoot!.querySelector<HTMLElement>('[data-trusted-ui-root]')!);
 expect(notice.getByText('Viewing as Analytics')).toBeInTheDocument();
 expect(switchGroup).not.toHaveBeenCalled();
 fireEvent.click(notice.getByRole('button',{name:requestAccess ? 'Request access as Operations' : 'Switch to Operations'}));
 expect(switchGroup.mock.calls).toEqual([['b']]);
});
