import {describe,it,expect} from 'vitest';
import {protectedAuthorDocument} from '../author-frame';
import {startAuthorScript} from '../author-script';
import {createDataflowStore} from '../store';
import {runInNewContext} from 'node:vm';
import {vi} from 'vitest';
describe('protected author frame contract',()=>{
 it('transfers once only from its parent and revokes a navigated inner frame',()=>{
  const html=protectedAuthorDocument('<p>inside</p>');
  const source=new DOMParser().parseFromString(html,'text/html').querySelector('script')!.textContent!;
  let receive:(event:unknown)=>void=()=>{};
  const parent={postMessage:vi.fn()},frame={title:'',setAttribute:vi.fn(),contentWindow:{postMessage:vi.fn()},remove:vi.fn(),onload:null as null|(()=>void),srcdoc:''};
  runInNewContext(source,{parent,document:{createElement:()=>frame,body:{append:vi.fn()}},addEventListener:(_name:string,fn:typeof receive)=>{receive=fn;}});
  const port={};receive({source:{},data:'mx:author:init',ports:[port]});frame.onload!();expect(frame.contentWindow.postMessage).not.toHaveBeenCalled();
  receive({source:parent,data:'mx:author:init',ports:[port]});receive({source:parent,data:'mx:author:init',ports:[{}]});
  expect(frame.contentWindow.postMessage).toHaveBeenCalledExactlyOnceWith('mx:author:init','*',[port]);
  frame.onload!();expect(frame.remove).toHaveBeenCalledOnce();expect(parent.postMessage).toHaveBeenCalledWith('mx:author:navigated','*');
 });
 it('keeps inner document inert within a trusted navigation-restricting wrapper',()=>{
  const doc=new DOMParser().parseFromString(protectedAuthorDocument('<script>window.innerAuthor=true</script>'),'text/html');
  expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain("frame-src 'none'");
  expect(doc.querySelectorAll('script')).toHaveLength(1);
  expect(doc.querySelector('script')?.textContent).not.toContain('<script>window.innerAuthor');
 });
 it('mounts the actual session through the wrapper, preserving opaque sandboxing',()=>{
  const store=createDataflowStore({flow:{values:[],queries:[]}});
  const stop=startAuthorScript('void 0',store);
  const frame=document.querySelector('iframe')!;
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  expect(frame.srcdoc).toContain('data-mx-author-wrapper');
  stop();expect(document.querySelector('iframe')).toBeNull();
 });
 it('shows a visible startup timeout and removes the failed frame',()=>{
  vi.useFakeTimers();const host=document.createElement('div');document.body.append(host);
  const store=createDataflowStore({flow:{values:[],queries:[]}});
  const stop=startAuthorScript('',store,document,{host,title:'Slow',html:'',document:'<p>never booted</p>'});
  vi.advanceTimersByTime(15000);expect(host.querySelector('iframe')).toBeNull();expect(host.querySelector('[role="alert"]')?.textContent).toContain('did not start');
  stop();host.remove();vi.useRealTimers();
 });
});
