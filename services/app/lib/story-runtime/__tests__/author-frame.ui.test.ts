import {describe,it,expect,vi} from 'vitest';
import {AUTHOR_FRAME_DOCUMENT} from '../author-frame';
import {startAuthorScript} from '../author-script';
import {createDataflowStore} from '../store';
import {runInNewContext} from 'node:vm';
describe('fixed HTTP author wrapper',()=>{
 it('accepts one parent-only document/port then revokes a navigated inner frame',()=>{
  const source=new DOMParser().parseFromString(AUTHOR_FRAME_DOCUMENT,'text/html').querySelector('script')!.textContent!;
  let receive:(event:unknown)=>void=()=>{};
  const parent={postMessage:vi.fn()},frame={title:'',setAttribute:vi.fn(),contentWindow:{postMessage:vi.fn()},remove:vi.fn(),onload:null as null|(()=>void),srcdoc:''};
  const append=vi.fn();
  runInNewContext(source,{parent,document:{createElement:()=>frame,body:{append}},addEventListener:(_name:string,fn:typeof receive)=>{receive=fn;}});
  const port={close:vi.fn()},data={type:'mx:author:init',document:'<p>inside</p>'};
  receive({source:{},data,ports:[port]});expect(append).not.toHaveBeenCalled();
  receive({source:parent,data:{type:'mx:author:init',document:12},ports:[port]});expect(append).not.toHaveBeenCalled();
  receive({source:parent,data,ports:[port]});
  expect(append).toHaveBeenCalledOnce();expect(frame.srcdoc).toBe('<p>inside</p>');
  expect(frame.setAttribute).toHaveBeenCalledWith('sandbox','allow-scripts');
  receive({source:parent,data:{...data,document:'replacement'},ports:[{}]});
  expect(frame.srcdoc).toBe('<p>inside</p>');
  frame.onload!();expect(frame.contentWindow.postMessage).toHaveBeenCalledExactlyOnceWith('mx:author:init','*',[port]);
  frame.onload!();expect(frame.remove).toHaveBeenCalledOnce();expect(parent.postMessage).toHaveBeenCalledWith('mx:author:navigated','*');
 });
 it('mounts HTTP wrapper, not inherited srcdoc, and transfers content as data',()=>{
  const port={postMessage:vi.fn(),start:vi.fn(),close:vi.fn(),onmessage:null};
  vi.stubGlobal('MessageChannel',class {port1=port;port2={};});
  const host=document.createElement('div');document.body.append(host);
  const store=createDataflowStore({flow:{values:[],queries:[]}});
  const stop=startAuthorScript('',store,document,{host,title:'Visible',html:'<p>inside</p>',document:'<script>inner only</script>'});
  const frame=host.querySelector('iframe')!,post=vi.spyOn(frame.contentWindow!,'postMessage');
  expect(new URL(frame.src).pathname).toBe('/story/author-frame');expect(frame.srcdoc).toBe('');
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  frame.dispatchEvent(new Event('load'));
  expect(post).toHaveBeenCalledWith({type:'mx:author:init',document:'<script>inner only</script>'},'*',[{}]);
  stop();expect(host.querySelector('iframe')).toBeNull();host.remove();vi.unstubAllGlobals();
 });
 it('shows a visible startup timeout and removes the failed frame',()=>{
  vi.useFakeTimers();const host=document.createElement('div');document.body.append(host);
  const store=createDataflowStore({flow:{values:[],queries:[]}});
  const stop=startAuthorScript('',store,document,{host,title:'Slow',html:'',document:'<p>never booted</p>'});
  vi.advanceTimersByTime(15000);expect(host.querySelector('iframe')).toBeNull();expect(host.querySelector('[role="alert"]')?.textContent).toContain('did not start');
  stop();host.remove();vi.useRealTimers();
 });
});
