/* @jsxImportSource solid-js */
import {render,screen,fireEvent,waitFor,cleanup} from '@solidjs/testing-library';
import {afterEach,it,expect,vi} from 'vitest';
import {FileConnectReceiver,type ConnectAdapter} from '../components/FileConnectReceiver';
import {PREVIEW_CONNECT_CHANNEL} from '@artifactbin/contracts';
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();window.history.replaceState(null,'','/');Object.defineProperty(window,'opener',{value:null,configurable:true});});
it('keeps an old-runtime offer through inline authentication and partial-error retry without remounting it',async()=>{
 window.history.replaceState(null,'','/connect?request=old-file-request');
 const opener={postMessage:vi.fn()};Object.defineProperty(window,'opener',{value:opener,configurable:true});
 const adapter:ConnectAdapter={hosted:true,inspect:vi.fn().mockResolvedValueOnce({title:'Report',comments:1,target:'',requiresAuth:true}).mockResolvedValue({title:'Report',comments:1,target:'Ab12Cd',kind:'update'}),apply:vi.fn().mockRejectedValue(Error('The document was saved; comments pending. Retry this same file.'))};
 render(()=> <FileConnectReceiver adapter={adapter} authentication={done=><button onClick={done}>Complete email login</button>}/>);
 expect(opener.postMessage).toHaveBeenCalledWith({channel:PREVIEW_CONNECT_CHANNEL,type:'ready',requestId:'old-file-request'},'*');
 const offer={channel:PREVIEW_CONNECT_CHANNEL,requestId:'old-file-request',type:'offer',html:'private edited HTML',filename:'Report.jsx.html'};
 window.dispatchEvent(new MessageEvent('message',{source:window,origin:'null',data:offer}));expect(adapter.inspect).not.toHaveBeenCalled();
 window.dispatchEvent(new MessageEvent('message',{source:opener as unknown as Window,origin:'null',data:{...offer,requestId:'wrong'}}));expect(adapter.inspect).not.toHaveBeenCalled();
 window.dispatchEvent(new MessageEvent('message',{source:opener as unknown as Window,origin:'null',data:offer}));
 expect(await screen.findByText('Report.jsx.html')).toBeVisible();
 fireEvent.click(await screen.findByRole('button',{name:'Complete email login'}));
 const apply=await screen.findByRole('button',{name:'Apply to original'});expect(adapter.apply).not.toHaveBeenCalled();
 fireEvent.click(apply);expect(await screen.findByRole('alert')).toHaveTextContent('comments pending');
 await waitFor(()=>expect(apply).not.toBeDisabled());fireEvent.click(apply);
 await waitFor(()=>expect(adapter.apply).toHaveBeenCalledTimes(2));
 const calls=vi.mocked(adapter.apply).mock.calls;expect(calls[0]).toEqual(calls[1]);expect(calls[0]![0]).toEqual({html:offer.html,filename:offer.filename});
 expect(opener.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({type:'opened'}),expect.anything());
});

it('opens on ordinary HTTP without requiring the secure-context randomUUID API',()=>{
 const random=crypto.getRandomValues.bind(crypto);vi.stubGlobal('crypto',{getRandomValues:random});
 const adapter:ConnectAdapter={inspect:vi.fn(),apply:vi.fn()};
 expect(()=>render(()=> <FileConnectReceiver adapter={adapter}/>)).not.toThrow();
 expect(screen.getByRole('heading',{name:'Import an HTML file'})).toBeVisible();
});
